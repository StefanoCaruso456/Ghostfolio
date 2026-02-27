import { OrderService } from '@ghostfolio/api/app/order/order.service';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import {
  PROPERTY_API_KEY_OPENROUTER,
  PROPERTY_OPENROUTER_MODEL
} from '@ghostfolio/common/config';
import type { AiChatResponse, Filter } from '@ghostfolio/common/interfaces';
import type { AiPromptMode, DateRange } from '@ghostfolio/common/types';

import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
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
import { AiConversationService } from './conversation/conversation.service';
import { McpClientService } from './mcp/mcp-client.service';
import { ReasoningTraceService } from './reasoning/reasoning-trace.service';
import { TraceContext } from './reasoning/trace-context';
import { BraintrustTelemetryService } from './telemetry/braintrust-telemetry.service';
import { buildRebalanceResult } from './tools/compute-rebalance.tool';
import { buildAllocationsResult } from './tools/get-allocations.tool';
import { buildFundamentalsResult } from './tools/get-fundamentals.tool';
import { buildHistoryResult } from './tools/get-history.tool';
import { buildNewsResult } from './tools/get-news.tool';
import { buildPerformanceResult } from './tools/get-performance.tool';
import { buildPortfolioSummary } from './tools/get-portfolio-summary.tool';
import { buildQuoteResult } from './tools/get-quote.tool';
import { buildActivitiesResult } from './tools/list-activities.tool';
import { buildScenarioImpactResult } from './tools/scenario-impact.tool';
import { GetAllocationsOutputSchema } from './tools/schemas/allocations.schema';
import {
  ComputeRebalanceInputSchema,
  ComputeRebalanceOutputSchema
} from './tools/schemas/compute-rebalance.schema';
import {
  GetFundamentalsInputSchema,
  GetFundamentalsOutputSchema
} from './tools/schemas/get-fundamentals.schema';
import {
  GetHistoryInputSchema,
  GetHistoryOutputSchema
} from './tools/schemas/get-history.schema';
import {
  GetNewsInputSchema,
  GetNewsOutputSchema
} from './tools/schemas/get-news.schema';
import {
  GetQuoteInputSchema,
  GetQuoteOutputSchema
} from './tools/schemas/get-quote.schema';
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
import {
  ScenarioImpactInputSchema,
  ScenarioImpactOutputSchema
} from './tools/schemas/scenario-impact.schema';

// ─── Production Guardrails (Non-Negotiable) ──────────────────────────

/** MAX_ITERATIONS: 8-10 steps — prevent infinite loops + runaway cost */
const MAX_ITERATIONS = 10;

/** TIMEOUT: 45s base — matches user patience + gateway timeouts */
const TIMEOUT_MS = 45_000;

/** TIMEOUT_MULTIMODAL: 90s — image/vision requests need more time */
const TIMEOUT_MULTIMODAL_MS = 90_000;

/** COST_LIMIT: $1/query — prevent bill explosions */
const COST_LIMIT_USD = 1.0;

/** CIRCUIT_BREAKER: same action 3x → abort */
const CIRCUIT_BREAKER_MAX_REPETITIONS = 3;

// ─── Output Schema Registry ─────────────────────────────────────────

const OUTPUT_SCHEMA_REGISTRY: Record<string, ZodType> = {
  getPortfolioSummary: GetPortfolioSummaryOutputSchema,
  listActivities: ListActivitiesOutputSchema,
  getAllocations: GetAllocationsOutputSchema,
  getPerformance: GetPerformanceOutputSchema,
  getQuote: GetQuoteOutputSchema,
  getHistory: GetHistoryOutputSchema,
  getFundamentals: GetFundamentalsOutputSchema,
  getNews: GetNewsOutputSchema,
  computeRebalance: ComputeRebalanceOutputSchema,
  scenarioImpact: ScenarioImpactOutputSchema
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
 * Strip quotes (ASCII + Unicode smart quotes) and non-ASCII characters
 * that break HTTP headers or API identifiers.
 *
 * Common cause: admin settings stored with literal "value" wrapping.
 */
function sanitizePropertyString(value: string): string {
  return value
    .replace(/['"]+/g, '') // Strip ASCII single/double quotes
    .replace(/[\u2018\u2019\u201C\u201D\u201A\u201B\u201E\u201F]/g, '') // Smart quotes
    .replace(/[\u0080-\uFFFF]/g, '') // Non-ASCII
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
    'You help users understand their portfolio and markets using ONLY data retrieved from tools.',
    '',
    '# ReAct Protocol (MANDATORY)',
    'For every user question, follow this loop:',
    '1. **THINK**: What data do I need to answer this question?',
    '2. **ACT**: Call the appropriate tool(s) to retrieve that data.',
    '3. **OBSERVE**: Read the tool results carefully.',
    '4. **DECIDE**: If I have enough data, compose my answer. If not, call another tool.',
    '',
    '# Available Tools',
    '',
    '## Portfolio Tools',
    '- **getPortfolioSummary**: Holdings count, top holdings, accounts. Use for overview questions.',
    '- **listActivities**: Trades, dividends, fees with date/type filtering. Use for transaction history.',
    '- **getAllocations**: Allocation by asset class, currency, sector. Use for diversification questions.',
    '- **getPerformance**: Returns, net performance, investment totals. Use for performance questions.',
    '',
    '## Market Tools',
    '- **getQuote**: Real-time quotes for 1–25 symbols. Use for current prices and daily changes.',
    '- **getHistory**: Historical price data with optional returns/volatility/drawdown. Use for trend analysis.',
    '- **getFundamentals**: Valuation ratios (P/E, EPS, dividend yield, market cap). Use for fundamental analysis.',
    '- **getNews**: Recent news items for a symbol. Use for market context.',
    '',
    '## Decision-Support Tools',
    '- **computeRebalance**: Compare current vs target allocation and compute deltas. Use when user asks about rebalancing.',
    '- **scenarioImpact**: Estimate portfolio impact of hypothetical shocks. Use for "what if" questions.',
    '',
    '# Groundedness Contract (ABSOLUTE RULES)',
    '- **NEVER output portfolio or market numbers unless they come from tool results.**',
    '- Every numeric claim (%, $, counts) MUST be traceable to a tool response.',
    '- If a tool returned warnings, mention them to the user.',
    '- If data is unavailable, say so explicitly — do NOT guess or fabricate.',
    '- When showing calculations, reference the exact tool-provided values.',
    '',
    '# Response Guidelines (BREVITY IS MANDATORY)',
    '- **Keep responses SHORT.** 2–4 sentences for simple questions, 5–8 sentences max for complex ones.',
    '- Lead with the direct answer. No preamble ("Sure!", "Great question!", "I\'d be happy to...").',
    '- Use bullet points for lists — never write multi-sentence paragraphs when bullets will do.',
    '- One line per data point. Do NOT repeat or rephrase tool results in multiple ways.',
    '- Do NOT recap what the user asked. They already know.',
    '- Reference specific holdings by name and symbol when discussing them.',
    '- Always end responses with a sources line:',
    '  "Sources: Ghostfolio (portfolio), Yahoo Finance (market quotes)" — listing which data sources were used.',
    `- Respond in: ${languageCode}.`,
    `- User's base currency: ${userCurrency}.`,
    '',
    '# Safety Guardrails',
    '- NEVER give specific buy/sell recommendations or price targets.',
    '- If asked "what to buy/sell":',
    '  1. Do NOT directly recommend. Instead, ask about constraints or offer scenario/rebalance analysis.',
    '  2. Call market tools only after clarifying asset universe, timeframe, and risk.',
    '  3. You may offer: "Would you like me to run a rebalance analysis or a scenario impact?"',
    '- For "trending" or "what is moving" queries:',
    '  Use getQuote/getNews to show factual data about current prices and movements — NOT predictions.',
    '- If asked for predictions/forecasts: refuse politely and offer scenario analysis instead.',
    '  Say: "I cannot predict future prices. I can run a scenario analysis — e.g., what if tech drops 10%?"',
    '- For complex tax/legal questions, recommend a qualified professional.',
    '- Always include risk disclaimers when showing rebalance or scenario results.',
    '',
    '# Anti-Hallucination Rules',
    '- Do NOT invent allocation %, prices, or performance figures.',
    '- Do NOT reference holdings that were not returned by tools.',
    '- If the portfolio is empty, say: "Your portfolio has no holdings."',
    '- When performing calculations, show your work using tool-provided values.',
    '- Always call tools BEFORE stating any numbers.',
    '',
    '# Output Hygiene (MANDATORY)',
    '- If a tool returns status="error": DO NOT include a "Sources:" section in your response.',
    '- When a tool fails, your response MUST explicitly state: "The [toolName] tool was unable to retrieve data: [error message]."',
    '- NEVER say "based on the data" or "according to market data" when a tool returned an error.',
    '- If ALL tools fail, respond with ONLY the error acknowledgment — no market commentary, no speculation.',
    '- If SOME tools succeed and some fail, report the available data AND explicitly note which tools failed.',
    '',
    '# File Attachments',
    '- Users may attach CSV, PDF, or image files to their messages.',
    '- CSV content is provided inline as text — analyze it directly.',
    '- PDF text content is provided inline — analyze it directly.',
    '- Images are provided as visual content — analyze them using vision capabilities.',
    '- When analyzing images: describe what you see, extract any relevant financial data (charts, tables, screenshots), and relate findings to the user question.',
    '- When an attachment is present, acknowledge it and analyze the data it contains thoroughly.'
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
    private readonly conversationService: AiConversationService,
    private readonly orderService: OrderService,
    private readonly portfolioService: PortfolioService,
    private readonly propertyService: PropertyService,
    private readonly reasoningTraceService: ReasoningTraceService,
    private readonly telemetryService: BraintrustTelemetryService
  ) {}

  /**
   * Fetches dashboard configuration from the MCP server.
   * Sends the userId so the MCP server can tailor the response
   * to the authenticated user's portfolio context.
   */
  public async getDashboardConfig({
    mcpClientService,
    userId
  }: {
    mcpClientService: McpClientService;
    userId: string;
  }) {
    try {
      return await mcpClientService.rpc('getDashboardConfig', { userId });
    } catch (error) {
      throw new HttpException(
        {
          message: 'MCP request failed',
          upstreamStatus: (error as any)?.mcpStatus ?? null
        },
        HttpStatus.BAD_GATEWAY
      );
    }
  }

  public async getDiagnostics({
    mcpClientService
  }: {
    mcpClientService: McpClientService;
  }) {
    const resolvedRpcUrl = mcpClientService.getResolvedRpcUrl();

    let mcpProbe: {
      body?: unknown;
      status: string;
      upstreamStatus?: number;
    } = { status: 'skipped' };

    if (mcpClientService.isConfigured()) {
      try {
        const result = await mcpClientService.rpc('getDashboardConfig', {
          userId: 'diagnostic'
        });
        mcpProbe = { status: 'ok', body: result };
      } catch (error) {
        mcpProbe = {
          body: (error as any)?.mcpBody ?? error?.message ?? 'unknown',
          status: 'error',
          upstreamStatus: (error as any)?.mcpStatus ?? null
        };
      }
    }

    return {
      buildSha: process.env.BUILD_SHA ?? null,
      hasMcpApiKey: mcpClientService.hasApiKey(),
      hasMcpServerUrl: mcpClientService.isConfigured(),
      mcpProbe,
      nodeEnv: process.env.NODE_ENV ?? 'unknown',
      resolvedRpcUrl
    };
  }

  public async chat({
    attachments,
    conversationId,
    history,
    languageCode,
    message,
    traceId,
    triggerSource,
    userCurrency,
    userId
  }: {
    attachments?: {
      content: string;
      fileName: string;
      mimeType: string;
      size: number;
    }[];
    conversationId?: string;
    history: { content: string; role: 'assistant' | 'user' }[];
    languageCode: string;
    message: string;
    traceId?: string;
    triggerSource?: string;
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

    // ── Wire trigger source + history message count into telemetry ──
    if (triggerSource) {
      trace.setTriggerSource(triggerSource);
    }

    trace.setHistoryMessageCount(history.length);

    // ── Initialize guardrails ───────────────────────────────────────
    const circuitBreaker = new CircuitBreaker({
      maxRepetitions: CIRCUIT_BREAKER_MAX_REPETITIONS
    });
    const costLimiter = new CostLimiter({ maxCostUsd: COST_LIMIT_USD });
    const failureTracker = new ToolFailureTracker();
    const toolCallRecords: ToolCallRecord[] = [];
    let iterationCount = 0;

    // ── Initialize reasoning trace context (SSE) ─────────────────
    const reasoningTraceId = traceId || randomUUID();
    const reasoningCtx = new TraceContext(reasoningTraceId, (event) => {
      this.reasoningTraceService.emit(event);
    });
    reasoningCtx.addPlanStep('Analyzing your question');

    // ── Build ReAct system prompt ───────────────────────────────────
    const systemMessage = buildReActSystemPrompt(languageCode, userCurrency);

    // ── Build user message with attachment context ──────────────────
    // Separate image attachments (multimodal) from text-based attachments
    const imageAttachments: typeof attachments = [];
    const textAttachments: typeof attachments = [];

    if (attachments?.length > 0) {
      for (const att of attachments) {
        if (att.mimeType.startsWith('image/')) {
          imageAttachments.push(att);
        } else {
          textAttachments.push(att);
        }
      }
    }

    // Build the text portion: user message + inline CSV/PDF content
    // Limit inline text to ~50K chars (~12K tokens) to prevent token explosion
    const MAX_INLINE_TEXT_CHARS = 50_000;
    let textContent = message;

    if (textAttachments.length > 0) {
      const descriptions = textAttachments.map((att) => {
        let content = att.content;

        // Truncate very large text attachments to avoid token overflow
        if (content.length > MAX_INLINE_TEXT_CHARS) {
          const truncatedRows = content
            .slice(0, MAX_INLINE_TEXT_CHARS)
            .split('\n');

          // Remove partial last line
          truncatedRows.pop();
          content =
            truncatedRows.join('\n') +
            `\n\n[... truncated — showing first ${truncatedRows.length} rows of a large file]`;

          Logger.warn(
            `Attachment "${att.fileName}" truncated from ${att.content.length} to ${content.length} chars`,
            'AiService'
          );
        }

        if (att.mimeType === 'text/csv') {
          return `[Attached CSV: ${att.fileName}]\n${content}`;
        }

        if (att.mimeType === 'application/pdf') {
          return `[Attached PDF: ${att.fileName}]\n${content}`;
        }

        return `[Attached file: ${att.fileName}]`;
      });

      textContent += '\n\n--- Attachments ---\n' + descriptions.join('\n\n');
    }

    // Build the user message — multimodal (content parts) if images, plain string otherwise
    type ContentPart =
      | { type: 'text'; text: string }
      | { type: 'image'; image: string; mimeType?: string };

    let userMessage:
      | { content: string; role: 'user' }
      | { content: ContentPart[]; role: 'user' };

    if (imageAttachments.length > 0) {
      const contentParts: ContentPart[] = [{ type: 'text', text: textContent }];

      for (const img of imageAttachments) {
        // Strip data URL prefix "data:image/xxx;base64," to get pure base64
        const base64Data = img.content.includes(',')
          ? img.content.split(',')[1]
          : img.content;

        contentParts.push({
          type: 'image',
          image: base64Data,
          mimeType: img.mimeType
        });
      }

      userMessage = { content: contentParts, role: 'user' };
    } else {
      userMessage = { content: textContent, role: 'user' };
    }

    const messages = [
      { content: systemMessage, role: 'system' as const },
      ...history.map((msg) => ({
        content: msg.content,
        role: msg.role as 'assistant' | 'user'
      })),
      userMessage
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

        // Emit reasoning analysis summary for user-facing transparency
        reasoningCtx.addAnalysisSummary(
          `Retrieving data using ${toolName} tool`
        );

        // Emit reasoning tool call step (starts as "running")
        const reasoningStep = reasoningCtx.startToolCall(toolName, args);

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

        // Record tool span — extract error details when tool fails
        const spanError =
          result.status === 'error'
            ? (((result as Record<string, unknown>).message as string) ??
              result.verification?.errors?.[0] ??
              'Tool returned error without details')
            : undefined;

        trace.addToolSpan(
          spanBuilder.end({
            status: result.status === 'error' ? 'error' : 'success',
            toolOutput: {
              status: result.status,
              message: (result as Record<string, unknown>).message,
              confidence: result.verification?.confidence
            },
            error: spanError
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

        // Complete reasoning tool call step with redacted result
        reasoningCtx.completeToolCall(
          reasoningStep.id,
          {
            status: result.status,
            message: (result as Record<string, unknown>).message,
            confidence: result.verification?.confidence
          },
          result.status === 'error' ? 'error' : 'success',
          durationMs
        );

        return { ...result, schemaVersion: TOOL_RESULT_SCHEMA_VERSION };
      })();
    };

    // ── Timeout with AbortController ────────────────────────────────
    // Use extended timeout for multimodal (image) requests
    const hasImages = imageAttachments.length > 0;
    const effectiveTimeoutMs = hasImages ? TIMEOUT_MULTIMODAL_MS : TIMEOUT_MS;

    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        trace.addGuardrail('timeout');
        abortController.abort();
        reject(
          new Error(
            `Guardrail: Request timed out after ${effectiveTimeoutMs / 1000}s`
          )
        );
      }, effectiveTimeoutMs);
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
          }),

          // ── Market Context Tools ──────────────────────────────────────

          getQuote: tool({
            description:
              'Get real-time quotes for 1–25 symbols: price, daily change, currency. Use for current price lookups and daily movers.',
            parameters: GetQuoteInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'getQuote',
                args as unknown as Record<string, unknown>,
                async () => {
                  const result = await buildQuoteResult(args);
                  return result as ToolOutput<typeof result>;
                }
              );
            }
          }),

          getHistory: tool({
            description:
              'Get historical price data for a symbol with optional returns, volatility, and max drawdown. Use for trend analysis and historical comparisons.',
            parameters: GetHistoryInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'getHistory',
                args as unknown as Record<string, unknown>,
                async () => {
                  const result = await buildHistoryResult(args);
                  return result as ToolOutput<typeof result>;
                }
              );
            }
          }),

          getFundamentals: tool({
            description:
              'Get fundamental data for a symbol: P/E, EPS, market cap, dividend yield, sector, industry. Use for valuation and fundamental analysis.',
            parameters: GetFundamentalsInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'getFundamentals',
                args as unknown as Record<string, unknown>,
                async () => {
                  const result = await buildFundamentalsResult(args);
                  return result as ToolOutput<typeof result>;
                }
              );
            }
          }),

          getNews: tool({
            description:
              'Get recent news items for a symbol. Use for market context and "what is happening with X" questions. Does not summarize — returns raw titles and links.',
            parameters: GetNewsInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'getNews',
                args as unknown as Record<string, unknown>,
                async () => {
                  const result = await buildNewsResult(args);
                  return result as ToolOutput<typeof result>;
                }
              );
            }
          }),

          // ── Decision-Support Tools ────────────────────────────────────

          computeRebalance: tool({
            description:
              'Compare current portfolio allocation against target allocation and compute deltas with suggested moves. Use when user asks about rebalancing. This is math only — not trade advice.',
            parameters: ComputeRebalanceInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'computeRebalance',
                args as unknown as Record<string, unknown>,
                async () => {
                  const details = await this.portfolioService.getDetails({
                    userId,
                    impersonationId: undefined
                  });

                  return buildRebalanceResult(details, args) as ToolOutput<
                    ReturnType<typeof buildRebalanceResult>
                  >;
                }
              );
            }
          }),

          scenarioImpact: tool({
            description:
              'Estimate portfolio impact of hypothetical shocks (e.g. "what if NVDA drops 20%" or "what if tech falls 10%"). Uses current allocations and deterministic arithmetic. No predictions.',
            parameters: ScenarioImpactInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'scenarioImpact',
                args as unknown as Record<string, unknown>,
                async () => {
                  const details = await this.portfolioService.getDetails({
                    userId,
                    impersonationId: undefined
                  });

                  return buildScenarioImpactResult(details, args) as ToolOutput<
                    ReturnType<typeof buildScenarioImpactResult>
                  >;
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
          // Route Sources-despite-failure to domainViolations, rest to hallucinationFlags
          if (flag.includes('Sources cited despite')) {
            trace.addDomainViolation(flag);
          } else {
            trace.addHallucinationFlag(flag);
          }
        }
      } else {
        trace.setConfidence(toolCallRecords.length > 0 ? 0.9 : 0.5);
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

      // ── Complete reasoning trace and persist (non-blocking) ────────
      reasoningCtx.addAnswerStep();
      const reasoningPreview = reasoningCtx.complete();

      this.reasoningTraceService
        .persistTrace({
          traceId: reasoningTraceId,
          userId,
          conversationId: activeConversationId,
          preview: reasoningPreview
        })
        .catch((traceError) => {
          Logger.warn(
            `Reasoning trace persistence failed: ${traceError instanceof Error ? traceError.message : String(traceError)}`,
            'AiService'
          );
        });

      // ── Persist conversation (non-blocking) ────────────────────────
      // Detect new conversation: if no history was sent, this is the first message
      // (the frontend always sends conversationId, so we can't rely on !conversationId)
      this.persistConversation({
        conversationId: activeConversationId,
        isNew: history.length === 0,
        messages: [
          { content: message, role: 'user' },
          { content: result.text, role: 'assistant' }
        ],
        title: message.slice(0, 80) + (message.length > 80 ? '...' : ''),
        userId
      }).catch((persistError) => {
        Logger.warn(
          `Conversation persistence failed: ${persistError instanceof Error ? persistError.message : String(persistError)}`,
          'AiService'
        );
      });

      return {
        conversationId: activeConversationId,
        message: {
          content: result.text,
          role: 'assistant',
          timestamp: new Date().toISOString()
        },
        traceId: reasoningTraceId
      };
    } catch (error) {
      clearTimeout(timeoutId!);
      trace.markLlmEnd();

      // Complete reasoning trace on error path
      reasoningCtx.complete();

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
        const isTimeout = errorMessage.includes('timed out');
        const friendlyMessage = isTimeout
          ? 'Your request took too long to process. This can happen with large files or complex images. Try a smaller file, or ask a more specific question about the content.'
          : 'I had to stop processing your request due to a safety guardrail. Please try rephrasing your question or ask something simpler.';

        return {
          conversationId: activeConversationId,
          message: {
            content: friendlyMessage,
            role: 'assistant',
            timestamp: new Date().toISOString()
          },
          traceId: reasoningTraceId
        };
      }

      // Return the actual error message so the frontend can display it
      return {
        conversationId: activeConversationId,
        message: {
          content: `Something went wrong: ${errorMessage}`,
          role: 'assistant',
          timestamp: new Date().toISOString()
        },
        traceId: reasoningTraceId
      };
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
      !lowerResponse.includes('unable') &&
      !lowerResponse.includes('issue') &&
      !lowerResponse.includes('fail') &&
      !lowerResponse.includes('not available') &&
      !lowerResponse.includes('could not')
    ) {
      flags.push(
        `${failedTools.length} tool(s) failed verification but response doesn't mention errors`
      );
    }

    // Domain violation: response includes "Sources:" despite all tools failing
    const errorToolCalls = toolCalls.filter((tc) => tc.status !== 'success');

    if (
      errorToolCalls.length > 0 &&
      errorToolCalls.length === toolCalls.length &&
      /\bsources?\s*:/i.test(responseText)
    ) {
      flags.push('Sources cited despite all tools failing');
    }

    const passed = flags.length === 0;
    const confidence = passed ? 0.9 : Math.max(0.3, 0.9 - flags.length * 0.2);

    return { passed, confidence, flags };
  }

  /**
   * Persist conversation + messages to the database (non-blocking).
   * Creates a new conversation if `isNew` is true, otherwise appends messages.
   */
  private async persistConversation({
    conversationId,
    isNew,
    messages,
    title,
    userId
  }: {
    conversationId: string;
    isNew: boolean;
    messages: { content: string; role: string }[];
    title: string;
    userId: string;
  }) {
    if (isNew) {
      await this.conversationService.createConversation({
        id: conversationId,
        title,
        userId
      });
    }

    await this.conversationService.addMessages({
      conversationId,
      messages
    });
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

    if (
      /\b(allocat|diversif|rebalanc|weight|scenario|what\s+if|impact)\b/.test(
        lower
      )
    ) {
      return 'allocation';
    }

    if (
      /\b(market|economy|sector|index|s&p|nasdaq|dow|quote|price|fundamentals?|news|trending|movers?)\b/.test(
        lower
      )
    ) {
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
