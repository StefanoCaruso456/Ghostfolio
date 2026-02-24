import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import {
  PROPERTY_API_KEY_OPENROUTER,
  PROPERTY_OPENROUTER_MODEL,
  PROPERTY_OPENROUTER_MODEL_LIGHT
} from '@ghostfolio/common/config';

import { Injectable, Logger } from '@nestjs/common';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, tool } from 'ai';
import { z } from 'zod';

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
import { DetectBrokerFormatInputSchema } from './schemas/detect-broker-format.schema';
import { GenerateImportPreviewInputSchema } from './schemas/generate-import-preview.schema';
import { MappedActivitySchema } from './schemas/validate-transactions.schema';
import type { VerificationResult } from './schemas/verification.schema';
import { detectBrokerFormat } from './tools/detect-broker-format.tool';
import { generateImportPreview } from './tools/generate-import-preview.tool';
import { mapBrokerFields } from './tools/map-broker-fields.tool';
import { parseCsv } from './tools/parse-csv.tool';
import { validateTransactions } from './tools/validate-transactions.tool';
import { enforceVerificationGate } from './verification/enforce';

// ─── Types ──────────────────────────────────────────────────────────

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

      // Create a timeout with proper cleanup
      let timeoutId: ReturnType<typeof setTimeout>;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          metrics.guardrailTriggered = 'timeout';
          reject(
            new Error(
              `Guardrail: Request timed out after ${TIMEOUT_MS / 1000}s`
            )
          );
        }, TIMEOUT_MS);
      });

      /**
       * Helper to wrap tool execution with guardrails:
       * circuit breaker, cost limit, tool failure backoff, verification gate.
       */
      const executeWithGuardrails = <
        T extends { status: string; verification: VerificationResult }
      >(
        toolName: string,
        args: Record<string, unknown>,
        executeFn: () => T
      ): T => {
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
        const result = executeFn();
        const durationMs = Date.now() - start;

        // Log observation
        metrics.observationLog.push(`${toolName} completed in ${durationMs}ms`);
        metrics.toolsCalled.push(toolName);

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

        return result;
      };

      const generatePromise = generateText({
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
                () => detectBrokerFormat(args)
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
            parameters: z.object({
              csvContent: z.string().describe('The raw CSV content to parse'),
              delimiter: z
                .enum([',', ';', '\t', '|'])
                .default(',')
                .describe('CSV delimiter character')
            }),
            execute: async (args) => {
              const start = Date.now();
              const result = executeWithGuardrails(
                'parseCSV',
                args as unknown as Record<string, unknown>,
                () =>
                  parseCsv({
                    csvContent: args.csvContent,
                    delimiter: args.delimiter
                  })
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
            parameters: z.object({
              headers: z
                .array(z.string())
                .describe('CSV column headers to map'),
              sampleRows: z
                .array(z.record(z.unknown()))
                .min(1)
                .max(5)
                .describe('1-5 sample data rows for context'),
              brokerHint: z
                .string()
                .optional()
                .describe(
                  'Optional hint about the broker (e.g., "Interactive Brokers")'
                )
            }),
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
                  })
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
            parameters: z.object({
              activities: z
                .array(MappedActivitySchema)
                .min(1)
                .describe('Array of mapped activities to validate')
            }),
            execute: async (args) => {
              const start = Date.now();
              const result = executeWithGuardrails(
                'validateTransactions',
                args as unknown as Record<string, unknown>,
                () =>
                  validateTransactions({
                    activities: args.activities
                  })
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
          generateImportPreview: tool({
            description:
              'Generate a human-readable preview of what the import will produce. Use this AFTER validateTransactions to show the user a summary before committing. Includes total value, activity breakdown, and commit decision.',
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
                  })
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
      '## Available Tools (5)',
      '1. detectBrokerFormat — Auto-detect which broker produced the CSV (use FIRST)',
      '2. parseCSV — Parse raw CSV content into structured rows',
      '3. mapBrokerFields — Map CSV headers to Ghostfolio fields (date, symbol, quantity, price, fee, currency, type)',
      '4. validateTransactions — Validate activities against financial rules',
      '5. generateImportPreview — Generate a summary preview before committing (use LAST)',
      '',
      '## Standard Workflow for CSV Import',
      'When a user provides a CSV file, follow this exact sequence:',
      '1. detectBrokerFormat — detect the broker from headers/data',
      '2. parseCSV — parse the raw content into rows',
      '3. mapBrokerFields — map headers using the broker hint from step 1',
      '4. validateTransactions — check all activities against financial rules',
      '5. generateImportPreview — show the user a summary before they commit',
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
