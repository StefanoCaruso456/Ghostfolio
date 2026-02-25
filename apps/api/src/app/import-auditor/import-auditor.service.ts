import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import {
  PROPERTY_API_KEY_OPENROUTER,
  PROPERTY_OPENROUTER_MODEL,
  PROPERTY_OPENROUTER_MODEL_LIGHT
} from '@ghostfolio/common/config';

import { Injectable, Logger } from '@nestjs/common';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, tool } from 'ai';
import type { ZodType } from 'zod';

import { CircuitBreaker } from './guardrails/circuit-breaker';
import { CostLimiter } from './guardrails/cost-limiter';
import { checkPayloadLimits } from './guardrails/payload-limiter';
import { ToolFailureTracker } from './guardrails/tool-failure-tracker';
import {
  AgentMetrics,
  createAgentMetrics,
  estimateCost,
  finalizeMetrics
} from './schemas/agent-metrics.schema';
import {
  DetectBrokerFormatInputSchema,
  DetectBrokerFormatOutputSchema
} from './schemas/detect-broker-format.schema';
import {
  GenerateImportPreviewInputSchema,
  GenerateImportPreviewOutputSchema
} from './schemas/generate-import-preview.schema';
import {
  MapBrokerFieldsInputSchema,
  MapBrokerFieldsOutputSchema
} from './schemas/map-broker-fields.schema';
import {
  NormalizeActivitiesInputSchema,
  NormalizeActivitiesOutputSchema
} from './schemas/normalize-activities.schema';
import {
  ParseCsvInputSchema,
  ParseCsvOutputSchema
} from './schemas/parse-csv.schema';
import { TOOL_RESULT_SCHEMA_VERSION } from './schemas/tool-result.schema';
import {
  ValidateTransactionsInputSchema,
  ValidateTransactionsOutputSchema
} from './schemas/validate-transactions.schema';
import {
  createVerificationResult,
  type VerificationResult
} from './schemas/verification.schema';
import { detectBrokerFormat } from './tools/detect-broker-format.tool';
import { generateImportPreview } from './tools/generate-import-preview.tool';
import { mapBrokerFields } from './tools/map-broker-fields.tool';
import { normalizeToActivityDTO } from './tools/normalize-to-activity-dto.tool';
import { parseCsv } from './tools/parse-csv.tool';
import { validateTransactions } from './tools/validate-transactions.tool';
import { enforceVerificationGate } from './verification/enforce';

// ─── Types ──────────────────────────────────────────────────────────

/**
 * Zod 3.25's z.infer can produce types where fields appear optional to TS
 * even when the schema marks them required. This helper forces the required
 * shape that executeWithGuardrails expects.
 */
type ToolOutput<T> = T & {
  status: string;
  verification: VerificationResult;
};

interface ToolCallRecord {
  tool: string;
  args?: Record<string, unknown>;
  status: string;
  verification: VerificationResult;
  durationMs: number;
}

export interface ChatRequest {
  csvContent?: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  message: string;
  sessionId: string;
  userId: string;
}

export interface ChatResponse {
  sessionId: string;
  response: string;
  toolCalls: ToolCallRecord[];
  canCommit: boolean;
  metrics: AgentMetrics;
}

// ─── Production Guardrails (Non-Negotiable) ──────────────────────────

/** MAX_ITERATIONS: 10-15 — prevent infinite loops + runaway cost */
const MAX_ITERATIONS = 10;

/** TIMEOUT: 30-45s — matches user patience + gateway timeouts */
const TIMEOUT_MS = 45_000;

/** COST_LIMIT: $1/query — prevent bill explosions */
const COST_LIMIT_USD = 1.0;

/** CIRCUIT_BREAKER: same action 3x → abort */
const CIRCUIT_BREAKER_MAX_REPETITIONS = 3;

// ─── Output Schema Registry (prevents schema drift) ──────────────────

/**
 * Maps tool names to their Zod output schemas.
 * Used by executeWithGuardrails to validate tool outputs at runtime.
 * If a tool's output doesn't match its schema, it's converted to an error.
 */
const OUTPUT_SCHEMA_REGISTRY: Record<string, ZodType> = {
  detectBrokerFormat: DetectBrokerFormatOutputSchema,
  parseCSV: ParseCsvOutputSchema,
  mapBrokerFields: MapBrokerFieldsOutputSchema,
  validateTransactions: ValidateTransactionsOutputSchema,
  normalizeActivities: NormalizeActivitiesOutputSchema,
  generateImportPreview: GenerateImportPreviewOutputSchema
};

// ─── Service ─────────────────────────────────────────────────────────

@Injectable()
export class ImportAuditorService {
  private readonly logger = new Logger(ImportAuditorService.name);

  public constructor(private readonly propertyService: PropertyService) {}

  public getHealth(): { status: string } {
    return { status: 'OK' };
  }

  /**
   * Stateless chat endpoint.
   *
   * The frontend sends the full conversation history + csvContent each call.
   * No in-memory session map — safe for multi-instance / serverless deployments.
   */
  public async chat({
    csvContent,
    history,
    message,
    sessionId
  }: ChatRequest): Promise<ChatResponse> {
    // Initialize metrics for this run
    const metrics = createAgentMetrics(sessionId);

    // ─── Payload limit guardrail (early reject) ───────────────────
    const payloadCheck = checkPayloadLimits(csvContent);

    if (!payloadCheck.ok) {
      metrics.success = false;
      metrics.guardrailTriggered = 'payload_limit';
      metrics.error = payloadCheck.reason;

      return {
        sessionId,
        response: `I cannot process this CSV: ${payloadCheck.reason}. Please reduce the file size and try again.`,
        toolCalls: [],
        canCommit: false,
        metrics: finalizeMetrics(metrics)
      };
    }

    // Build messages from history + current message
    const messages: { role: 'user' | 'assistant'; content: string }[] = [
      ...(history ?? []),
      { role: 'user', content: message }
    ];

    const toolCallRecords: ToolCallRecord[] = [];
    let canCommit = false;

    // Initialize guardrails
    const circuitBreaker = new CircuitBreaker({
      maxRepetitions: CIRCUIT_BREAKER_MAX_REPETITIONS
    });
    const costLimiter = new CostLimiter({ maxCostUsd: COST_LIMIT_USD });
    const failureTracker = new ToolFailureTracker();

    try {
      const openRouterApiKey = await this.propertyService.getByKey<string>(
        PROPERTY_API_KEY_OPENROUTER
      );

      const openRouterModelLight = await this.propertyService.getByKey<string>(
        PROPERTY_OPENROUTER_MODEL_LIGHT
      );

      const openRouterModel =
        openRouterModelLight ??
        (await this.propertyService.getByKey<string>(
          PROPERTY_OPENROUTER_MODEL
        ));

      if (!openRouterApiKey || !openRouterModel) {
        metrics.success = false;
        metrics.error = 'AI service not configured';

        return {
          sessionId,
          response:
            'The AI service is not configured. Please set the OpenRouter API key and model in the admin settings.',
          toolCalls: [],
          canCommit: false,
          metrics: finalizeMetrics(metrics)
        };
      }

      const openRouterService = createOpenRouter({
        apiKey: openRouterApiKey
      });

      const systemPrompt = this.buildSystemPrompt(csvContent);

      // Log thought: starting ReAct loop
      metrics.thoughtLog.push(
        `Starting ReAct loop for session ${sessionId}. CSV present: ${!!csvContent}`
      );

      // Create a timeout with AbortController for proper cancellation.
      // When timeout fires, abortController.abort() cancels the generateText
      // call, preventing orphaned background token consumption.
      const abortController = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout>;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          metrics.guardrailTriggered = 'timeout';
          abortController.abort();
          reject(
            new Error(
              `Guardrail: Request timed out after ${TIMEOUT_MS / 1000}s`
            )
          );
        }, TIMEOUT_MS);
      });

      /**
       * Helper to wrap tool execution with guardrails:
       * circuit breaker, cost limit, tool failure backoff,
       * runtime output schema validation, verification gate, schemaVersion.
       */
      const executeWithGuardrails = <
        T extends { status: string; verification: VerificationResult }
      >(
        toolName: string,
        args: Record<string, unknown>,
        executeFn: () => T
      ): T & { schemaVersion: string } => {
        // Circuit breaker check
        if (circuitBreaker.recordAction(toolName, args)) {
          metrics.guardrailTriggered = 'circuit_breaker';
          const reason = circuitBreaker.getTripReason();
          metrics.error = reason;

          throw new Error(`Guardrail: ${reason}`);
        }

        // Cost limit check
        if (costLimiter.isExceeded()) {
          metrics.guardrailTriggered = 'cost_limit';
          metrics.error = `Cost limit exceeded: $${costLimiter.getAccumulatedCost().toFixed(4)}`;

          throw new Error(`Guardrail: ${metrics.error}`);
        }

        // Tool failure backoff check
        if (failureTracker.isAborted()) {
          metrics.guardrailTriggered = 'tool_failure_backoff';
          metrics.error = failureTracker.getAbortReason();

          throw new Error(`Guardrail: ${metrics.error}`);
        }

        // Log action
        metrics.actionLog.push(
          `${toolName}(${JSON.stringify(args).slice(0, 200)})`
        );
        metrics.iterations++;

        const start = Date.now();
        let result = executeFn();
        const durationMs = Date.now() - start;

        // Log observation
        metrics.observationLog.push(`${toolName} completed in ${durationMs}ms`);
        metrics.toolsCalled.push(toolName);

        // ─── Runtime output schema validation ─────────────────────────
        const outputSchema = OUTPUT_SCHEMA_REGISTRY[toolName];

        if (outputSchema) {
          const validation = outputSchema.safeParse(result);

          if (!validation.success) {
            const zodErrors = validation.error.issues
              .map((i) => i.message)
              .join('; ');
            metrics.observationLog.push(
              `${toolName} OUTPUT SCHEMA VALIDATION FAILED: ${zodErrors}`
            );

            // Replace result with a structured error
            result = {
              status: 'error',
              data: (result as Record<string, unknown>).data,
              verification: createVerificationResult({
                passed: false,
                confidence: 0,
                errors: [`Tool output schema validation failed: ${zodErrors}`],
                sources: [toolName]
              })
            } as unknown as T;
          }
        }

        // Track tool failures for backoff
        if (result.status === 'error') {
          if (failureTracker.recordFailure(toolName)) {
            metrics.guardrailTriggered = 'tool_failure_backoff';
            metrics.error = failureTracker.getAbortReason();

            throw new Error(`Guardrail: ${metrics.error}`);
          }
        }

        // Central verification gate enforcement
        const gate = enforceVerificationGate(result.verification, {
          highStakes: true, // CSV import is always high-stakes (financial data)
          minConfidence: 0.7
        });

        if (gate.decision === 'block') {
          canCommit = false;
          metrics.thoughtLog.push(
            `Verification gate BLOCKED after ${toolName}: ${gate.reason}`
          );
          // Don't throw — the LLM should see the error and report it to the user.
          // The block is informational: it prevents canCommit but lets the agent explain.
        } else if (gate.decision === 'human_review') {
          metrics.thoughtLog.push(
            `Verification gate requires HUMAN REVIEW after ${toolName}: ${gate.reason}`
          );
        }

        // Inject schemaVersion for contract evolution tracking
        return { ...result, schemaVersion: TOOL_RESULT_SCHEMA_VERSION };
      };

      const generatePromise = generateText({
        abortSignal: abortController.signal,
        maxSteps: MAX_ITERATIONS,
        model: openRouterService.chat(openRouterModel),
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        tools: {
          detectBrokerFormat: tool({
            description:
              'Auto-detect which broker produced the CSV file based on header patterns and data shapes. Use this FIRST before parsing to get a broker hint. Returns the detected broker name and confidence score.',
            parameters: DetectBrokerFormatInputSchema,
            execute: async (args) => {
              const start = Date.now();
              const result = executeWithGuardrails(
                'detectBrokerFormat',
                args as unknown as Record<string, unknown>,
                () =>
                  detectBrokerFormat(args) as ToolOutput<
                    ReturnType<typeof detectBrokerFormat>
                  >
              );
              const durationMs = Date.now() - start;

              toolCallRecords.push({
                tool: 'detectBrokerFormat',
                args: args as unknown as Record<string, unknown>,
                status: result.status,
                verification: result.verification,
                durationMs
              });

              return result;
            }
          }),
          parseCSV: tool({
            description:
              'Parse raw CSV content into structured rows with headers. Use this when the user provides a CSV file or asks to import/parse a CSV.',
            parameters: ParseCsvInputSchema,
            execute: async (args) => {
              const start = Date.now();
              const result = executeWithGuardrails(
                'parseCSV',
                args as unknown as Record<string, unknown>,
                () =>
                  parseCsv({
                    csvContent: args.csvContent,
                    delimiter: args.delimiter
                  }) as ToolOutput<ReturnType<typeof parseCsv>>
              );
              const durationMs = Date.now() - start;

              toolCallRecords.push({
                tool: 'parseCSV',
                args: args as unknown as Record<string, unknown>,
                status: result.status,
                verification: result.verification,
                durationMs
              });

              return result;
            }
          }),
          mapBrokerFields: tool({
            description:
              'Map CSV column headers to Ghostfolio activity fields using deterministic matching. Use this after parsing CSV to identify which columns correspond to date, symbol, quantity, price, etc.',
            parameters: MapBrokerFieldsInputSchema,
            execute: async (args) => {
              const start = Date.now();
              const result = executeWithGuardrails(
                'mapBrokerFields',
                args as unknown as Record<string, unknown>,
                () =>
                  mapBrokerFields({
                    headers: args.headers,
                    sampleRows: args.sampleRows,
                    brokerHint: args.brokerHint
                  }) as ToolOutput<ReturnType<typeof mapBrokerFields>>
              );
              const durationMs = Date.now() - start;

              toolCallRecords.push({
                tool: 'mapBrokerFields',
                args: args as unknown as Record<string, unknown>,
                status: result.status,
                verification: result.verification,
                durationMs
              });

              return result;
            }
          }),
          validateTransactions: tool({
            description:
              'Validate mapped activities against financial rules: required fields, valid types, numeric invariants (fee >= 0, quantity >= 0), date validity, and currency codes. Use this after mapping broker fields.',
            parameters: ValidateTransactionsInputSchema,
            execute: async (args) => {
              const start = Date.now();
              const result = executeWithGuardrails(
                'validateTransactions',
                args as unknown as Record<string, unknown>,
                () =>
                  validateTransactions({
                    activities: args.activities
                  }) as ToolOutput<ReturnType<typeof validateTransactions>>
              );
              const durationMs = Date.now() - start;

              toolCallRecords.push({
                tool: 'validateTransactions',
                args: { activitiesCount: args.activities.length },
                status: result.status,
                verification: result.verification,
                durationMs
              });

              if (result.status === 'pass' || result.status === 'warnings') {
                canCommit = true;
              }

              return result;
            }
          }),
          normalizeActivities: tool({
            description:
              'Normalize validated activities into Ghostfolio ActivityImportDTO format. Normalizes types (buy→BUY), dates (to YYYY-MM-DD), coerces numerics, uppercases currency, and optionally injects accountId. Use this AFTER validateTransactions and BEFORE generateImportPreview.',
            parameters: NormalizeActivitiesInputSchema,
            execute: async (args) => {
              const start = Date.now();
              const result = executeWithGuardrails(
                'normalizeActivities',
                { activitiesCount: args.activities.length } as Record<
                  string,
                  unknown
                >,
                () =>
                  normalizeToActivityDTO({
                    activities: args.activities,
                    accountId: args.accountId
                  })
              );
              const durationMs = Date.now() - start;

              toolCallRecords.push({
                tool: 'normalizeActivities',
                args: {
                  activitiesCount: args.activities.length,
                  accountId: args.accountId
                },
                status: result.status,
                verification: result.verification,
                durationMs
              });

              return result;
            }
          }),
          generateImportPreview: tool({
            description:
              'Generate a human-readable preview of what the import will produce. Use this AFTER normalizeActivities to show the user a summary before committing. Includes total value, activity breakdown, and commit decision. canCommit is only true when DTO normalization passed.',
            parameters: GenerateImportPreviewInputSchema,
            execute: async (args) => {
              const start = Date.now();
              const result = executeWithGuardrails(
                'generateImportPreview',
                args as unknown as Record<string, unknown>,
                () =>
                  generateImportPreview({
                    validActivities: args.validActivities,
                    totalErrors: args.totalErrors,
                    totalWarnings: args.totalWarnings
                  }) as ToolOutput<ReturnType<typeof generateImportPreview>> & {
                    data: { canCommit: boolean };
                  }
              );
              const durationMs = Date.now() - start;

              toolCallRecords.push({
                tool: 'generateImportPreview',
                args: {
                  validActivitiesCount: args.validActivities.length,
                  totalErrors: args.totalErrors,
                  totalWarnings: args.totalWarnings
                },
                status: result.status,
                verification: result.verification,
                durationMs
              });

              // Update canCommit based on preview
              if (result.data.canCommit) {
                canCommit = true;
              }

              // Check for human-in-the-loop escalation
              if (result.verification.requiresHumanReview) {
                metrics.thoughtLog.push(
                  `Human review required: ${result.verification.escalationReason}`
                );
              }

              return result;
            }
          })
        }
      });

      try {
        const result = await Promise.race([generatePromise, timeoutPromise]);

        // Track token usage and cost
        if (result.usage) {
          metrics.promptTokens = result.usage.promptTokens ?? 0;
          metrics.completionTokens = result.usage.completionTokens ?? 0;
          metrics.totalTokens = metrics.promptTokens + metrics.completionTokens;
          metrics.totalCostUsd = estimateCost(
            openRouterModel,
            metrics.promptTokens,
            metrics.completionTokens
          );

          // Check cost limit after completion
          costLimiter.addCost(metrics.totalCostUsd);

          if (costLimiter.isWarning()) {
            this.logger.warn(
              `Cost warning for session ${sessionId}: $${metrics.totalCostUsd.toFixed(4)} (limit: $${COST_LIMIT_USD})`
            );
          }
        }

        const responseText =
          result.text ||
          'I processed your request. Check the tool results for details.';

        metrics.success = true;
        metrics.toolCallLog = toolCallRecords.map((tc) => ({
          tool: tc.tool,
          args: tc.args,
          status: tc.verification.passed ? 'success' : 'error',
          durationMs: tc.durationMs
        }));

        // Log final metrics
        const finalMetrics = finalizeMetrics(metrics);

        this.logger.log(
          `Agent run completed: session=${sessionId} ` +
            `iterations=${finalMetrics.iterations} ` +
            `tools=[${finalMetrics.toolsCalled.join(',')}] ` +
            `tokens=${finalMetrics.totalTokens} ` +
            `cost=$${finalMetrics.totalCostUsd.toFixed(4)} ` +
            `duration=${finalMetrics.durationMs}ms ` +
            `success=${finalMetrics.success}`
        );

        return {
          sessionId,
          response: responseText,
          toolCalls: toolCallRecords,
          canCommit,
          metrics: finalMetrics
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Chat error for session ${sessionId}: ${errorMessage}`);

      metrics.success = false;
      metrics.error = errorMessage;

      const finalMetrics = finalizeMetrics(metrics);

      // Log failed run metrics
      this.logger.warn(
        `Agent run FAILED: session=${sessionId} ` +
          `guardrail=${finalMetrics.guardrailTriggered ?? 'none'} ` +
          `iterations=${finalMetrics.iterations} ` +
          `error="${finalMetrics.error}" ` +
          `duration=${finalMetrics.durationMs}ms`
      );

      const errorResponse = finalMetrics.guardrailTriggered
        ? `I stopped processing due to a safety guardrail: ${errorMessage}. Please try a simpler request or contact support.`
        : `I encountered an error: ${errorMessage}. Please try again.`;

      return {
        sessionId,
        response: errorResponse,
        toolCalls: toolCallRecords,
        canCommit: false,
        metrics: finalMetrics
      };
    }
  }

  /**
   * Hardened system prompt with AgentForge guardrails.
   */
  private buildSystemPrompt(csvContent?: string): string {
    const parts = [
      'You are the Ghostfolio CSV Import Auditor, a financial data validation assistant.',
      'You help users safely import broker CSV files into their Ghostfolio portfolio.',
      '',
      '## ReAct Workflow',
      'You follow a strict Reason → Action → Observe → Repeat/Answer loop:',
      '1. THINK about what information you need next',
      '2. ACT by calling exactly one tool',
      '3. OBSERVE the tool result and verify it',
      '4. DECIDE whether to call another tool or finalize your answer',
      '',
      '## Available Tools (6)',
      '1. detectBrokerFormat — Auto-detect which broker produced the CSV (use FIRST)',
      '2. parseCSV — Parse raw CSV content into structured rows',
      '3. mapBrokerFields — Map CSV headers to Ghostfolio fields (date, symbol, quantity, price, fee, currency, type)',
      '4. validateTransactions — Validate activities against financial rules',
      '5. normalizeActivities — Normalize validated activities into Ghostfolio DTO format (types, dates, numerics, currency)',
      '6. generateImportPreview — Generate a summary preview before committing (use LAST)',
      '',
      '## Standard Workflow for CSV Import',
      'When a user provides a CSV file, follow this exact sequence:',
      '1. detectBrokerFormat — detect the broker from headers/data',
      '2. parseCSV — parse the raw content into rows',
      '3. mapBrokerFields — map headers using the broker hint from step 1',
      '4. validateTransactions — check all activities against financial rules',
      '5. normalizeActivities — normalize valid activities to import DTO format',
      '6. generateImportPreview — show the user a summary before they commit',
      '',
      '## Safety Guardrails (MUST FOLLOW)',
      '- NEVER fabricate or guess financial data. Only report what the tools return.',
      '- NEVER display raw CSV data in full. Only show summaries and specific issues.',
      '- If a tool returns low confidence (< 0.7), explicitly warn the user.',
      '- If verification.requiresHumanReview is true, tell the user they must review before committing.',
      '- If you cannot determine something, say "I\'m not sure" — do NOT guess.',
      '- Always cite which tool produced each finding (e.g., "The validator found...").',
      '- Do not call the same tool with the same arguments more than twice.',
      '',
      '## Anti-Hallucination Rules',
      '- Only reference data that came from tool results.',
      '- Do not invent ticker symbols, prices, or dates.',
      '- If asked about data not in the CSV, respond: "That information is not available in the uploaded file."',
      '',
      '## Confidence & Escalation',
      '- Report overall confidence after validation (from verification.confidence).',
      '- If confidence < 0.5: "Warning: Low confidence — I recommend manual review before importing."',
      '- If there are validation errors: clearly list them with row numbers.',
      '- For large imports (50+ rows) or high-value imports: recommend the user reviews the preview carefully.',
      '',
      '## Response Format',
      '- Be concise but thorough.',
      '- Use markdown for readability.',
      '- Structure results with clear sections: Summary, Issues, Recommendation.',
      '- Report validation errors and warnings clearly with row numbers.'
    ];

    if (csvContent) {
      parts.push(
        '',
        `## Context`,
        `The user has uploaded a CSV file (${csvContent.length} characters).`,
        'When you need to parse it, pass the CSV content to the parseCSV tool.',
        'Start with detectBrokerFormat to identify the broker, then proceed through the standard workflow.'
      );
    }

    return parts.join('\n');
  }
}
