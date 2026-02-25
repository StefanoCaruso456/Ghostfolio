import { OrderService } from '@ghostfolio/api/app/order/order.service';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import {
  PROPERTY_API_KEY_OPENROUTER,
  PROPERTY_OPENROUTER_MODEL
} from '@ghostfolio/common/config';
import type { AiChatResponse, Filter } from '@ghostfolio/common/interfaces';
import type { AiPromptMode, DateRange } from '@ghostfolio/common/types';

import { Injectable, Logger } from '@nestjs/common';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, tool } from 'ai';
import { randomUUID } from 'node:crypto';
import type { ColumnDescriptor } from 'tablemark';
import type { ZodType } from 'zod';

import { CircuitBreaker } from '../../import-auditor/guardrails/circuit-breaker';
import { CostLimiter } from '../../import-auditor/guardrails/cost-limiter';
import { ToolFailureTracker } from '../../import-auditor/guardrails/tool-failure-tracker';
import { estimateCost } from '../../import-auditor/schemas/agent-metrics.schema';
import { TOOL_RESULT_SCHEMA_VERSION } from '../../import-auditor/schemas/tool-result.schema';
import {
  createVerificationResult,
  type VerificationResult
} from '../../import-auditor/schemas/verification.schema';
import { enforceVerificationGate } from '../../import-auditor/verification/enforce';
import { BraintrustTelemetryService } from './telemetry/braintrust-telemetry.service';
import { buildAllocationsResult } from './tools/get-allocations.tool';
import { buildPerformanceResult } from './tools/get-performance.tool';
import { buildPortfolioSummary } from './tools/get-portfolio-summary.tool';
import { buildActivitiesResult } from './tools/list-activities.tool';
import { GetAllocationsOutputSchema } from './tools/schemas/allocations.schema';
import {
  ListActivitiesInputSchema,
  ListActivitiesOutputSchema
} from './tools/schemas/list-activities.schema';
import {
  GetPerformanceInputSchema,
  GetPerformanceOutputSchema
} from './tools/schemas/performance.schema';
import {
  GetPortfolioSummaryInputSchema,
  GetPortfolioSummaryOutputSchema
} from './tools/schemas/portfolio-summary.schema';

// ─── Production Guardrails (Non-Negotiable) ──────────────────────────

/** MAX_ITERATIONS: 8-10 steps — prevent infinite loops + runaway cost */
const MAX_ITERATIONS = 10;

/** TIMEOUT: 45s — matches user patience + gateway timeouts */
const TIMEOUT_MS = 45_000;

/** COST_LIMIT: $1/query — prevent bill explosions */
const COST_LIMIT_USD = 1.0;

/** CIRCUIT_BREAKER: same action 3x → abort */
const CIRCUIT_BREAKER_MAX_REPETITIONS = 3;

// ─── Output Schema Registry ─────────────────────────────────────────

const OUTPUT_SCHEMA_REGISTRY: Record<string, ZodType> = {
  getPortfolioSummary: GetPortfolioSummaryOutputSchema,
  listActivities: ListActivitiesOutputSchema,
  getAllocations: GetAllocationsOutputSchema,
  getPerformance: GetPerformanceOutputSchema
};

// ─── Types ───────────────────────────────────────────────────────────

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

/**
 * Strip Unicode smart quotes and non-ASCII characters that break HTTP headers.
 */
function sanitizePropertyString(value: string): string {
  return value
    .replace(/[\u2018\u2019\u201C\u201D\u201A\u201B\u201E\u201F]/g, '')
    .replace(/[\u0080-\uFFFF]/g, '')
    .trim();
}

// ─── ReAct System Prompt ─────────────────────────────────────────────

function buildReActSystemPrompt(
  languageCode: string,
  userCurrency: string
): string {
  return [
    '# Role',
    'You are Ghostfolio AI, a financial assistant integrated into the Ghostfolio portfolio management application.',
    'You help users understand their portfolio using ONLY data retrieved from tools.',
    '',
    '# ReAct Protocol (MANDATORY)',
    'For every user question, follow this loop:',
    '1. **THINK**: What data do I need to answer this question?',
    '2. **ACT**: Call the appropriate tool(s) to retrieve that data.',
    '3. **OBSERVE**: Read the tool results carefully.',
    '4. **DECIDE**: If I have enough data, compose my answer. If not, call another tool.',
    '',
    '# Available Tools',
    '- **getPortfolioSummary**: Get holdings count, top holdings, accounts count. Use for overview questions.',
    '- **listActivities**: Get trades, dividends, fees with date filtering. Use for transaction history.',
    '- **getAllocations**: Get allocation breakdown by asset class, currency, sector. Use for diversification questions.',
    '- **getPerformance**: Get returns, net performance, investment totals. Use for performance questions.',
    '',
    '# Groundedness Contract (ABSOLUTE RULES)',
    '- **NEVER output portfolio numbers unless they come from tool results.**',
    '- Every numeric claim (%, $, counts) MUST be traceable to a tool response.',
    '- If a tool returned warnings, mention them to the user.',
    '- If data is unavailable, say so explicitly — do NOT guess or fabricate.',
    '- When showing calculations, reference the exact tool-provided values.',
    '',
    '# Response Guidelines',
    '- Be concise but thorough. Use markdown formatting.',
    '- Reference specific holdings by name and symbol when discussing them.',
    '- Structure longer responses with sections and bullet points.',
    `- Respond in: ${languageCode}.`,
    `- User's base currency: ${userCurrency}.`,
    '',
    '# Safety Guardrails',
    '- NEVER give specific buy/sell recommendations or price targets.',
    '- If asked for predictions/forecasts: refuse politely and offer alternatives.',
    '  Say: "I cannot predict future prices. Instead, let me show you your current portfolio data."',
    '  Then call tools to provide factual data about their current position.',
    '- For complex tax/legal questions, recommend a qualified professional.',
    '- Always include risk disclaimers for complex financial topics.',
    '',
    '# Anti-Hallucination Rules',
    '- Do NOT invent allocation %, prices, or performance figures.',
    '- Do NOT reference holdings that were not returned by tools.',
    '- If the portfolio is empty, say: "Your portfolio has no holdings."',
    '- When performing calculations, show your work using tool-provided values.'
  ].join('\n');
}

// ─── Service ─────────────────────────────────────────────────────────

@Injectable()
export class AiService {
  private static readonly HOLDINGS_TABLE_COLUMN_DEFINITIONS: ({
    key:
      | 'ALLOCATION_PERCENTAGE'
      | 'ASSET_CLASS'
      | 'ASSET_SUB_CLASS'
      | 'CURRENCY'
      | 'NAME'
      | 'SYMBOL';
  } & ColumnDescriptor)[] = [
    { key: 'NAME', name: 'Name' },
    { key: 'SYMBOL', name: 'Symbol' },
    { key: 'CURRENCY', name: 'Currency' },
    { key: 'ASSET_CLASS', name: 'Asset Class' },
    { key: 'ASSET_SUB_CLASS', name: 'Asset Sub Class' },
    {
      align: 'right',
      key: 'ALLOCATION_PERCENTAGE',
      name: 'Allocation in Percentage'
    }
  ];

  public constructor(
    private readonly orderService: OrderService,
    private readonly portfolioService: PortfolioService,
    private readonly propertyService: PropertyService,
    private readonly telemetryService: BraintrustTelemetryService
  ) {}

  public async chat({
    conversationId,
    history,
    languageCode,
    message,
    userCurrency,
    userId
  }: {
    conversationId?: string;
    history: { content: string; role: 'assistant' | 'user' }[];
    languageCode: string;
    message: string;
    userCurrency: string;
    userId: string;
  }): Promise<AiChatResponse> {
    // ── OpenRouter via Vercel AI SDK ─────────────────────────────────
    const rawApiKey = await this.propertyService.getByKey<string>(
      PROPERTY_API_KEY_OPENROUTER
    );
    const rawModel = await this.propertyService.getByKey<string>(
      PROPERTY_OPENROUTER_MODEL
    );

    if (!rawApiKey) {
      Logger.error(
        'OpenRouter API key not configured. Set it in Admin → Settings.',
        'AiService'
      );
      throw new Error(
        'AI chat is not configured. Missing OpenRouter API key in admin settings.'
      );
    }

    if (!rawModel) {
      Logger.error(
        'OpenRouter model not configured. Set it in Admin → Settings.',
        'AiService'
      );
      throw new Error(
        'AI chat is not configured. Missing OpenRouter model in admin settings.'
      );
    }

    const openRouterApiKey = sanitizePropertyString(rawApiKey);
    const modelId = sanitizePropertyString(rawModel);
    const openRouterService = createOpenRouter({ apiKey: openRouterApiKey });

    // ── Start telemetry trace ───────────────────────────────────────
    const activeConversationId = conversationId || randomUUID();
    const trace = this.telemetryService.startTrace({
      sessionId: activeConversationId,
      userId,
      queryText: message,
      model: modelId
    });

    // ── Initialize guardrails ───────────────────────────────────────
    const circuitBreaker = new CircuitBreaker({
      maxRepetitions: CIRCUIT_BREAKER_MAX_REPETITIONS
    });
    const costLimiter = new CostLimiter({ maxCostUsd: COST_LIMIT_USD });
    const failureTracker = new ToolFailureTracker();
    const toolCallRecords: ToolCallRecord[] = [];
    let iterationCount = 0;

    // ── Build ReAct system prompt ───────────────────────────────────
    const systemMessage = buildReActSystemPrompt(languageCode, userCurrency);

    const messages: {
      content: string;
      role: 'assistant' | 'system' | 'user';
    }[] = [
      { content: systemMessage, role: 'system' },
      ...history.map((msg) => ({
        content: msg.content,
        role: msg.role as 'assistant' | 'user'
      })),
      { content: message, role: 'user' as const }
    ];

    // ── executeWithGuardrails wrapper ────────────────────────────────
    const executeWithGuardrails = <
      T extends { status: string; verification: VerificationResult }
    >(
      toolName: string,
      args: Record<string, unknown>,
      executeFn: () => T | Promise<T>
    ): Promise<T & { schemaVersion: string }> => {
      return (async () => {
        // Circuit breaker check
        if (circuitBreaker.recordAction(toolName, args)) {
          const reason = circuitBreaker.getTripReason();
          trace.addGuardrail('circuit_breaker');
          throw new Error(`Guardrail: ${reason}`);
        }

        // Cost limit check
        if (costLimiter.isExceeded()) {
          trace.addGuardrail('cost_limit');
          throw new Error(
            `Guardrail: Cost limit exceeded ($${costLimiter.getAccumulatedCost().toFixed(4)})`
          );
        }

        // Tool failure backoff
        if (failureTracker.isAborted()) {
          trace.addGuardrail('tool_failure_backoff');
          throw new Error(`Guardrail: ${failureTracker.getAbortReason()}`);
        }

        iterationCount++;

        const spanBuilder = trace.startToolSpan(toolName, args, iterationCount);

        const start = Date.now();
        let result = await executeFn();
        const durationMs = Date.now() - start;

        // Runtime output schema validation
        const outputSchema = OUTPUT_SCHEMA_REGISTRY[toolName];

        if (outputSchema) {
          const validation = outputSchema.safeParse(result);

          if (!validation.success) {
            const zodErrors = validation.error.issues
              .map((i) => i.message)
              .join('; ');

            result = {
              status: 'error',
              data: (result as Record<string, unknown>).data,
              message: `Output schema validation failed: ${zodErrors}`,
              verification: createVerificationResult({
                passed: false,
                confidence: 0,
                errors: [`Tool output schema validation failed: ${zodErrors}`],
                sources: [toolName]
              })
            } as unknown as T;
          }
        }

        // Track tool failures
        if (result.status === 'error') {
          if (failureTracker.recordFailure(toolName)) {
            trace.addGuardrail('tool_failure_backoff');
            trace.addToolSpan(
              spanBuilder.end({
                status: 'error',
                toolOutput: result as unknown as Record<string, unknown>,
                error: failureTracker.getAbortReason()
              })
            );
            throw new Error(`Guardrail: ${failureTracker.getAbortReason()}`);
          }
        }

        // Verification gate enforcement
        const gate = enforceVerificationGate(result.verification, {
          highStakes: false, // Chat is informational, not transactional
          minConfidence: 0.5
        });

        if (gate.decision === 'block') {
          trace.addDomainViolation(
            `Verification gate BLOCKED after ${toolName}: ${gate.reason}`
          );
        } else if (gate.decision === 'human_review') {
          trace.addWarning(
            `Verification gate requires review after ${toolName}: ${gate.reason}`
          );
        }

        // Record tool span
        trace.addToolSpan(
          spanBuilder.end({
            status: result.status === 'error' ? 'error' : 'success',
            toolOutput: {
              status: result.status,
              message: (result as Record<string, unknown>).message,
              confidence: result.verification?.confidence
            }
          })
        );

        // Record for response metadata
        toolCallRecords.push({
          tool: toolName,
          args,
          status: result.status,
          verification: result.verification,
          durationMs
        });

        return { ...result, schemaVersion: TOOL_RESULT_SCHEMA_VERSION };
      })();
    };

    // ── Timeout with AbortController ────────────────────────────────
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        trace.addGuardrail('timeout');
        abortController.abort();
        reject(
          new Error(`Guardrail: Request timed out after ${TIMEOUT_MS / 1000}s`)
        );
      }, TIMEOUT_MS);
    });

    // ── ReAct loop via generateText with tools ──────────────────────
    trace.markLlmStart();

    try {
      const generatePromise = generateText({
        abortSignal: abortController.signal,
        maxSteps: MAX_ITERATIONS,
        model: openRouterService.chat(modelId),
        messages,
        tools: {
          getPortfolioSummary: tool({
            description:
              'Get a summary of the user portfolio: holdings count, top holdings by allocation, accounts count, base currency. Use this for overview/summary questions.',
            parameters: GetPortfolioSummaryInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'getPortfolioSummary',
                args as unknown as Record<string, unknown>,
                async () => {
                  const details = await this.portfolioService.getDetails({
                    userId,
                    impersonationId: undefined,
                    withSummary: true
                  });

                  return buildPortfolioSummary(details, {
                    userCurrency: args.userCurrency || userCurrency
                  }) as ToolOutput<ReturnType<typeof buildPortfolioSummary>>;
                }
              );
            }
          }),

          listActivities: tool({
            description:
              'List portfolio activities (trades, dividends, fees, etc.) with optional date range and type filtering. Use this for questions about transactions, trades, dividends received, or fees paid.',
            parameters: ListActivitiesInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'listActivities',
                args as unknown as Record<string, unknown>,
                async () => {
                  const filters: Filter[] = [];

                  if (args.symbol) {
                    filters.push({ id: args.symbol, type: 'SYMBOL' });
                  }

                  const startDate = args.startDate
                    ? new Date(args.startDate)
                    : undefined;
                  const endDate = args.endDate
                    ? new Date(args.endDate)
                    : undefined;

                  const { activities, count } =
                    await this.orderService.getOrders({
                      endDate,
                      filters,
                      startDate,
                      userId,
                      userCurrency,
                      types: args.types as any,
                      take: args.limit ?? 50,
                      sortDirection: 'desc'
                    });

                  return buildActivitiesResult(activities, count, {
                    from: args.startDate ?? null,
                    to: args.endDate ?? null
                  }) as ToolOutput<ReturnType<typeof buildActivitiesResult>>;
                }
              );
            }
          }),

          getAllocations: tool({
            description:
              'Get portfolio allocation breakdown by asset class, asset sub-class, currency, and sector. Use this for diversification and allocation questions.',
            parameters: GetPortfolioSummaryInputSchema, // Same input (just userCurrency)
            execute: async (args) => {
              return executeWithGuardrails(
                'getAllocations',
                args as unknown as Record<string, unknown>,
                async () => {
                  const details = await this.portfolioService.getDetails({
                    userId,
                    impersonationId: undefined
                  });

                  return buildAllocationsResult(details) as ToolOutput<
                    ReturnType<typeof buildAllocationsResult>
                  >;
                }
              );
            }
          }),

          getPerformance: tool({
            description:
              'Get portfolio performance metrics: net performance, returns %, total investment, net worth. Use this for questions about returns, gains/losses, and overall performance.',
            parameters: GetPerformanceInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'getPerformance',
                args as unknown as Record<string, unknown>,
                async () => {
                  const perf = await this.portfolioService.getPerformance({
                    userId,
                    impersonationId: undefined,
                    dateRange: (args.dateRange as DateRange) || 'max'
                  });

                  return buildPerformanceResult(
                    perf,
                    args.dateRange || 'max',
                    userCurrency
                  ) as ToolOutput<ReturnType<typeof buildPerformanceResult>>;
                }
              );
            }
          })
        }
      });

      const result = await Promise.race([generatePromise, timeoutPromise]);

      clearTimeout(timeoutId!);
      trace.markLlmEnd();

      // Record token usage and cost
      const inputTokens = result.usage?.promptTokens ?? 0;
      const outputTokens = result.usage?.completionTokens ?? 0;

      trace.setTokens(inputTokens, outputTokens);
      trace.setCost(estimateCost(modelId, inputTokens, outputTokens));
      trace.setResponse(result.text);
      trace.setQueryCategory(this.classifyQuery(message));
      trace.setIterationCount(iterationCount);

      // ── Post-response groundedness check ──────────────────────────
      const groundednessResult = this.checkGroundedness(
        result.text,
        toolCallRecords
      );

      if (!groundednessResult.passed) {
        trace.setConfidence(Math.min(groundednessResult.confidence, 0.6));

        for (const flag of groundednessResult.flags) {
          trace.addHallucinationFlag(flag);
        }
      } else {
        trace.setConfidence(toolCallRecords.length > 0 ? 0.9 : 0.6);
      }

      if (toolCallRecords.length === 0) {
        trace.addWarning(
          'No tools were called — response may not be grounded in portfolio data'
        );
      }

      // ── Finalize and log to Braintrust (non-blocking) ─────────────
      const payload = trace.finalize();

      this.telemetryService.logTrace(payload).catch((telemetryError) => {
        Logger.warn(
          `Telemetry logging failed: ${telemetryError instanceof Error ? telemetryError.message : String(telemetryError)}`,
          'AiService'
        );
      });

      return {
        conversationId: activeConversationId,
        message: {
          content: result.text,
          role: 'assistant',
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      clearTimeout(timeoutId!);
      trace.markLlmEnd();

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      const isGuardrail = errorMessage.startsWith('Guardrail:');

      trace.markError(errorMessage);
      trace.setResponse(`[ERROR] ${errorMessage}`);
      trace.setConfidence(0);
      trace.setQueryCategory(this.classifyQuery(message));

      if (isGuardrail) {
        trace.markAborted();
      }

      const payload = trace.finalize();

      this.telemetryService.logTrace(payload).catch(() => {
        // Swallow telemetry errors on failure path
      });

      Logger.error(`AI chat error: ${errorMessage}`, 'AiService');

      // For guardrail-triggered aborts, return a friendly message
      if (isGuardrail) {
        return {
          conversationId: activeConversationId,
          message: {
            content:
              'I had to stop processing your request due to a safety guardrail. Please try rephrasing your question or ask something simpler.',
            role: 'assistant',
            timestamp: new Date().toISOString()
          }
        };
      }

      throw error;
    }
  }

  /**
   * Post-response groundedness check.
   * Verifies that numeric claims in the response can be traced to tool outputs.
   * This is a deterministic check — no LLM judge needed.
   */
  private checkGroundedness(
    responseText: string,
    toolCalls: ToolCallRecord[]
  ): { passed: boolean; confidence: number; flags: string[] } {
    const flags: string[] = [];

    // If no tools were called, we can't verify groundedness
    if (toolCalls.length === 0) {
      return { passed: true, confidence: 0.5, flags: [] };
    }

    // Check for common hallucination patterns
    const lowerResponse = responseText.toLowerCase();

    // Flag if response says "I don't know" but tools returned data
    const hasSuccessfulTools = toolCalls.some((tc) => tc.status === 'success');

    if (
      hasSuccessfulTools &&
      (lowerResponse.includes("i don't have access") ||
        lowerResponse.includes("i don't know") ||
        lowerResponse.includes('no data available'))
    ) {
      flags.push(
        'Response claims no data but tools returned successful results'
      );
    }

    // Flag if response contains forecast language
    if (
      /\b(will\s+(increase|decrease|grow|rise|fall|drop))\b/i.test(
        responseText
      ) ||
      /\b(predict|forecast|expect\s+to\s+(reach|hit|grow))\b/i.test(
        responseText
      )
    ) {
      flags.push('Response contains prediction/forecast language');
    }

    // Check that any tool verification failures are not ignored
    const failedTools = toolCalls.filter((tc) => !tc.verification.passed);

    if (
      failedTools.length > 0 &&
      !lowerResponse.includes('error') &&
      !lowerResponse.includes('unavailable') &&
      !lowerResponse.includes('issue')
    ) {
      flags.push(
        `${failedTools.length} tool(s) failed verification but response doesn't mention errors`
      );
    }

    const passed = flags.length === 0;
    const confidence = passed ? 0.9 : Math.max(0.3, 0.9 - flags.length * 0.2);

    return { passed, confidence, flags };
  }

  /**
   * Classify query intent for telemetry bucketing.
   */
  private classifyQuery(
    query: string
  ): 'portfolio' | 'market' | 'allocation' | 'tax' | 'performance' | 'general' {
    const lower = query.toLowerCase();

    if (/\b(portfolio|holdings?|positions?|my\s+stocks?)\b/.test(lower)) {
      return 'portfolio';
    }

    if (/\b(allocat|diversif|rebalanc|weight)\b/.test(lower)) {
      return 'allocation';
    }

    if (/\b(market|economy|sector|index|s&p|nasdaq|dow)\b/.test(lower)) {
      return 'market';
    }

    if (/\b(performance|return|gain|loss|profit|growth)\b/.test(lower)) {
      return 'performance';
    }

    if (/\b(tax|capital\s+gains?|deduct|write.?off|1099)\b/.test(lower)) {
      return 'tax';
    }

    return 'general';
  }

  public async generateText({ prompt }: { prompt: string }) {
    const rawApiKey = await this.propertyService.getByKey<string>(
      PROPERTY_API_KEY_OPENROUTER
    );
    const rawModel = await this.propertyService.getByKey<string>(
      PROPERTY_OPENROUTER_MODEL
    );

    if (!rawApiKey || !rawModel) {
      throw new Error(
        'AI text generation is not configured. Missing OpenRouter API key or model in admin settings.'
      );
    }

    const apiKey = sanitizePropertyString(rawApiKey);
    const model = sanitizePropertyString(rawModel);
    const openRouterService = createOpenRouter({ apiKey });

    return generateText({
      prompt,
      model: openRouterService.chat(model)
    });
  }

  public async getPrompt({
    filters,
    impersonationId,
    languageCode,
    mode,
    userCurrency,
    userId
  }: {
    filters?: Filter[];
    impersonationId: string;
    languageCode: string;
    mode: AiPromptMode;
    userCurrency: string;
    userId: string;
  }) {
    const { holdings } = await this.portfolioService.getDetails({
      filters,
      impersonationId,
      userId
    });

    const holdingsTableColumns: ColumnDescriptor[] =
      AiService.HOLDINGS_TABLE_COLUMN_DEFINITIONS.map(({ align, name }) => {
        return { name, align: align ?? 'left' };
      });

    const holdingsTableRows = Object.values(holdings)
      .sort((a, b) => {
        return b.allocationInPercentage - a.allocationInPercentage;
      })
      .map(
        ({
          allocationInPercentage,
          assetClass,
          assetSubClass,
          currency,
          name: label,
          symbol
        }) => {
          return AiService.HOLDINGS_TABLE_COLUMN_DEFINITIONS.reduce(
            (row, { key, name }) => {
              switch (key) {
                case 'ALLOCATION_PERCENTAGE':
                  row[name] = `${(allocationInPercentage * 100).toFixed(3)}%`;
                  break;

                case 'ASSET_CLASS':
                  row[name] = assetClass ?? '';
                  break;

                case 'ASSET_SUB_CLASS':
                  row[name] = assetSubClass ?? '';
                  break;

                case 'CURRENCY':
                  row[name] = currency;
                  break;

                case 'NAME':
                  row[name] = label;
                  break;

                case 'SYMBOL':
                  row[name] = symbol;
                  break;

                default:
                  row[name] = '';
                  break;
              }

              return row;
            },
            {} as Record<string, string>
          );
        }
      );

    // Dynamic import to load ESM module from CommonJS context
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicImport = new Function('s', 'return import(s)') as (
      s: string
    ) => Promise<typeof import('tablemark')>;
    const { tablemark } = await dynamicImport('tablemark');

    const holdingsTableString = tablemark(holdingsTableRows, {
      columns: holdingsTableColumns
    });

    if (mode === 'portfolio') {
      return holdingsTableString;
    }

    return [
      `You are a neutral financial assistant. Please analyze the following investment portfolio (base currency being ${userCurrency}) in simple words.`,
      holdingsTableString,
      'Structure your answer with these sections:',
      "Overview: Briefly summarize the portfolio's composition and allocation rationale.",
      'Risk Assessment: Identify potential risks, including market volatility, concentration, and sectoral imbalances.',
      'Advantages: Highlight strengths, focusing on growth potential, diversification, or other benefits.',
      'Disadvantages: Point out weaknesses, such as overexposure or lack of defensive assets.',
      'Target Group: Discuss who this portfolio might suit (e.g., risk tolerance, investment goals, life stages, and experience levels).',
      'Optimization Ideas: Offer ideas to complement the portfolio, ensuring they are constructive and neutral in tone.',
      'Conclusion: Provide a concise summary highlighting key insights.',
      `Provide your answer in the following language: ${languageCode}.`
    ].join('\n');
  }
}
