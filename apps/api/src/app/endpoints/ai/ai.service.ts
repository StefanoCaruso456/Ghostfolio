import { OrderService } from '@ghostfolio/api/app/order/order.service';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { TaxService } from '@ghostfolio/api/app/tax/tax.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import {
  PROPERTY_API_KEY_OPENROUTER,
  PROPERTY_OPENROUTER_MODEL
} from '@ghostfolio/common/config';
import type { AiChatResponse, Filter } from '@ghostfolio/common/interfaces';
import type { AiPromptMode, DateRange } from '@ghostfolio/common/types';

import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { DataSource } from '@prisma/client';
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
import {
  ToolDispatcherService,
  type DispatchResult
} from './mcp/tool-dispatcher.service';
import { ReasoningTraceService } from './reasoning/reasoning-trace.service';
import { TraceContext } from './reasoning/trace-context';
import { BraintrustTelemetryService } from './telemetry/braintrust-telemetry.service';
import { buildRebalanceResult } from './tools/compute-rebalance.tool';
import { buildCreateAdjustmentResult } from './tools/create-adjustment.tool';
import { buildDeleteAdjustmentResult } from './tools/delete-adjustment.tool';
import { buildAllocationsResult } from './tools/get-allocations.tool';
import { buildDividendSummaryResult } from './tools/get-dividend-summary.tool';
import { buildFundamentalsResult } from './tools/get-fundamentals.tool';
import { buildHistoryResult } from './tools/get-history.tool';
import { buildHoldingDetailResult } from './tools/get-holding-detail.tool';
import { buildNewsResult } from './tools/get-news.tool';
import { buildPerformanceResult } from './tools/get-performance.tool';
import { buildPortfolioChartResult } from './tools/get-portfolio-chart.tool';
import { buildPortfolioSummary } from './tools/get-portfolio-summary.tool';
import { buildQuoteResult } from './tools/get-quote.tool';
import { buildTaxHoldingsResult } from './tools/get-tax-holdings.tool';
import { buildTaxLotsResult } from './tools/get-tax-lots.tool';
import { buildTaxTransactionsResult } from './tools/get-tax-transactions.tool';
import { buildActivitiesResult } from './tools/list-activities.tool';
import { buildListConnectedAccountsResult } from './tools/list-connected-accounts.tool';
import { buildPortfolioLiquidationResult } from './tools/portfolio-liquidation.tool';
import { buildScenarioImpactResult } from './tools/scenario-impact.tool';
import { GetAllocationsOutputSchema } from './tools/schemas/allocations.schema';
import {
  ComputeRebalanceInputSchema,
  ComputeRebalanceOutputSchema
} from './tools/schemas/compute-rebalance.schema';
import {
  CreateAdjustmentInputSchema,
  CreateAdjustmentOutputSchema
} from './tools/schemas/create-adjustment.schema';
import {
  DeleteAdjustmentInputSchema,
  DeleteAdjustmentOutputSchema
} from './tools/schemas/delete-adjustment.schema';
import {
  GetDividendSummaryInputSchema,
  GetDividendSummaryOutputSchema
} from './tools/schemas/get-dividend-summary.schema';
import {
  GetFundamentalsInputSchema,
  GetFundamentalsOutputSchema
} from './tools/schemas/get-fundamentals.schema';
import {
  GetHistoryInputSchema,
  GetHistoryOutputSchema
} from './tools/schemas/get-history.schema';
import {
  GetHoldingDetailInputSchema,
  GetHoldingDetailOutputSchema
} from './tools/schemas/get-holding-detail.schema';
import {
  GetNewsInputSchema,
  GetNewsOutputSchema
} from './tools/schemas/get-news.schema';
import {
  GetPortfolioChartInputSchema,
  GetPortfolioChartOutputSchema
} from './tools/schemas/get-portfolio-chart.schema';
import {
  GetQuoteInputSchema,
  GetQuoteOutputSchema
} from './tools/schemas/get-quote.schema';
import {
  GetTaxHoldingsInputSchema,
  GetTaxHoldingsOutputSchema
} from './tools/schemas/get-tax-holdings.schema';
import {
  GetTaxLotsInputSchema,
  GetTaxLotsOutputSchema
} from './tools/schemas/get-tax-lots.schema';
import {
  GetTaxTransactionsInputSchema,
  GetTaxTransactionsOutputSchema
} from './tools/schemas/get-tax-transactions.schema';
import {
  ListActivitiesInputSchema,
  ListActivitiesOutputSchema
} from './tools/schemas/list-activities.schema';
import {
  ListConnectedAccountsInputSchema,
  ListConnectedAccountsOutputSchema
} from './tools/schemas/list-connected-accounts.schema';
import {
  GetPerformanceInputSchema,
  GetPerformanceOutputSchema
} from './tools/schemas/performance.schema';
import {
  PortfolioLiquidationInputSchema,
  PortfolioLiquidationOutputSchema
} from './tools/schemas/portfolio-liquidation.schema';
import {
  GetPortfolioSummaryInputSchema,
  GetPortfolioSummaryOutputSchema
} from './tools/schemas/portfolio-summary.schema';
import {
  ScenarioImpactInputSchema,
  ScenarioImpactOutputSchema
} from './tools/schemas/scenario-impact.schema';
import {
  SimulateSaleInputSchema,
  SimulateSaleOutputSchema
} from './tools/schemas/simulate-sale.schema';
import {
  SyncAccountInputSchema,
  SyncAccountOutputSchema
} from './tools/schemas/sync-account.schema';
import {
  TaxLossHarvestInputSchema,
  TaxLossHarvestOutputSchema
} from './tools/schemas/tax-loss-harvest.schema';
import {
  UpdateAdjustmentInputSchema,
  UpdateAdjustmentOutputSchema
} from './tools/schemas/update-adjustment.schema';
import {
  WashSaleCheckInputSchema,
  WashSaleOutputSchema
} from './tools/schemas/wash-sale-check.schema';
import {
  WebSearchInputSchema,
  WebSearchOutputSchema
} from './tools/schemas/web-search.schema';
import { buildSimulateSaleResult } from './tools/simulate-sale.tool';
import { buildSyncAccountResult } from './tools/sync-account.tool';
import { buildTaxLossHarvestResult } from './tools/tax-loss-harvest.tool';
import { buildUpdateAdjustmentResult } from './tools/update-adjustment.tool';
import { buildWashSaleCheckResult } from './tools/wash-sale-check.tool';
import {
  buildWebSearchResult,
  executeWebSearch
} from './tools/web-search.tool';

// ─── Production Guardrails (Non-Negotiable) ──────────────────────────

/** MAX_ITERATIONS: 8-10 steps — prevent infinite loops + runaway cost */
const MAX_ITERATIONS = 10;

/** TIMEOUT: 90s base — generous budget for multi-step tool chains */
const TIMEOUT_MS = 90_000;

/** TIMEOUT_MULTIMODAL: 180s — image/vision requests need more time */
const TIMEOUT_MULTIMODAL_MS = 180_000;

/** COST_LIMIT: $1/query — prevent bill explosions */
const COST_LIMIT_USD = 1.0;

/** CIRCUIT_BREAKER: same action 3x → abort */
const CIRCUIT_BREAKER_MAX_REPETITIONS = 3;

// ─── Output Schema Registry ─────────────────────────────────────────

const OUTPUT_SCHEMA_REGISTRY: Record<string, ZodType> = {
  getPortfolioSummary: GetPortfolioSummaryOutputSchema,
  getHoldingDetail: GetHoldingDetailOutputSchema,
  getPortfolioChart: GetPortfolioChartOutputSchema,
  getDividendSummary: GetDividendSummaryOutputSchema,
  listActivities: ListActivitiesOutputSchema,
  getAllocations: GetAllocationsOutputSchema,
  getPerformance: GetPerformanceOutputSchema,
  getQuote: GetQuoteOutputSchema,
  getHistory: GetHistoryOutputSchema,
  getFundamentals: GetFundamentalsOutputSchema,
  getNews: GetNewsOutputSchema,
  computeRebalance: ComputeRebalanceOutputSchema,
  scenarioImpact: ScenarioImpactOutputSchema,
  // Tax Intelligence tools
  listConnectedAccounts: ListConnectedAccountsOutputSchema,
  syncAccount: SyncAccountOutputSchema,
  getTaxHoldings: GetTaxHoldingsOutputSchema,
  getTaxTransactions: GetTaxTransactionsOutputSchema,
  getTaxLots: GetTaxLotsOutputSchema,
  simulateSale: SimulateSaleOutputSchema,
  portfolioLiquidation: PortfolioLiquidationOutputSchema,
  taxLossHarvest: TaxLossHarvestOutputSchema,
  washSaleCheck: WashSaleOutputSchema,
  createAdjustment: CreateAdjustmentOutputSchema,
  updateAdjustment: UpdateAdjustmentOutputSchema,
  deleteAdjustment: DeleteAdjustmentOutputSchema,

  // Web Search
  webSearch: WebSearchOutputSchema
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
    '- **getHoldingDetail**: Deep detail for a specific holding — position, performance, dividends, fees, historical data. Use when user asks about a specific holding (e.g. "how is my AAPL doing?").',
    '- **getPortfolioChart**: Portfolio value over time as chart data with peak/trough/change summary. Use for "show my chart", trend analysis, or period comparisons.',
    '- **getDividendSummary**: Dividend income summary — total, by symbol, by period, recent events. Use for dividend-focused questions.',
    '- **listActivities**: Trades, dividends, fees with date/type filtering. Use for transaction history.',
    '- **getAllocations**: Allocation by asset class, currency, sector. Use for diversification questions.',
    '- **getPerformance**: Returns, net performance, investment totals. Use for performance questions.',
    '',
    '## Market Tools',
    '- **getQuote**: Real-time quotes for 1–25 symbols. Use for current prices and daily changes.',
    '- **getHistory**: Historical price data with optional returns/volatility/drawdown. Use for trend analysis.',
    '- **getFundamentals**: Valuation ratios (P/E, EPS, dividend yield, market cap). Use for fundamental analysis.',
    '- **getNews**: Recent news items for a symbol with titles, URLs, thumbnails, and publisher info. Use for market context. Format results with thumbnail images as clickable links (markdown: [![Headline](thumbnail_url)](article_url)), headline, bullet summary, source, and clickable article URL.',
    '',
    '## Decision-Support Tools',
    '- **computeRebalance**: Compare current vs target allocation and compute deltas. Use when user asks about rebalancing.',
    '- **scenarioImpact**: Estimate portfolio impact of hypothetical shocks. Use for "what if" questions.',
    '',
    '## Tax Intelligence Tools',
    '- **listConnectedAccounts**: List connected brokerage/bank accounts (SnapTrade + Plaid).',
    '- **syncAccount**: Trigger a sync for a connected account to refresh data.',
    '- **getTaxHoldings**: Cross-account holdings with cost basis and unrealized gain/loss. Accepts optional symbol filter.',
    '- **getTaxTransactions**: Tax-relevant transaction history with filtering.',
    '- **getTaxLots**: FIFO-derived tax lots with holding periods (short/long term) and status.',
    '- **simulateSale**: Estimate tax impact of selling shares — FIFO lot selection, federal + state tax + NIIT (3.8%). Auto-fetches market price and lots.',
    '- **portfolioLiquidation**: Simulate selling ALL holdings — total tax liability with per-holding breakdown. Auto-fetches everything.',
    '- **taxLossHarvest**: Find holdings with unrealized losses for tax-loss harvesting — shows potential tax savings and wash sale risk. Auto-fetches everything.',
    '- **washSaleCheck**: Detect IRS wash sale violations — scans for repurchases within 30-day window around loss sales. Auto-fetches everything.',
    '- **createAdjustment / updateAdjustment / deleteAdjustment**: Manage cost basis corrections.',
    '',
    'IMPORTANT: Tax simulations are estimates only — not tax advice. Always include a disclaimer.',
    '',
    '# Tax Response Format (MANDATORY for simulateSale and portfolioLiquidation)',
    'When presenting tax simulation results, ALWAYS show the full 4-layer breakdown table:',
    '',
    '| Tax Layer | Gain/Loss | Rate | Estimated Tax |',
    '|-----------|-----------|------|---------------|',
    '| Federal (short-term) | $X | Y% | $Z |',
    '| Federal (long-term) | $X | Y% (0/15/20) | $Z |',
    '| State tax (state name) | $X | Y% | $Z |',
    '| NIIT | $X | 3.8% | $Z |',
    '| **Total** | | **Effective: Y%** | **$Z** |',
    '',
    'Key rules:',
    '- Federal long-term capital gains rates are: 0% (taxable income ≤$47K), 15% (≤$518K), 20% (>$518K) — they do NOT vary by state.',
    '- State tax is a separate additional layer on top of federal — it varies by state (e.g. CA: 13.3%, NY: 8.82%, TX/FL: 0%).',
    '- NIIT (3.8%) applies to investment income for AGI > $200K single / $250K married.',
    '- Always show all 4 layers even if some are $0.',
    '- Use the longTermBracketPct parameter (0, 15, or 20) based on user context. Default is 15% for HNW users.',
    '',
    '# Tool Call Optimization (CRITICAL — reduces timeout risk)',
    '- **simulateSale, portfolioLiquidation, taxLossHarvest, washSaleCheck** are SELF-CONTAINED.',
    '  They fetch market prices, tax lots, and holdings internally. Do NOT call getQuote, getTaxHoldings, or getTaxLots before them.',
    '- For "sell ALL my shares of X": call getTaxHoldings(symbol=X) FIRST to learn the quantity, then call simulateSale.',
    '- For "what is my tax if I sell N shares of X": call simulateSale DIRECTLY with the quantity. No other tool needed.',
    '- For "liquidate everything" / "sell everything": call portfolioLiquidation DIRECTLY. No other tool needed.',
    '- Minimize tool calls to avoid timeouts. Every extra tool call adds 10-30s latency.',
    '',
    '## Web Search Tools',
    '- **webSearch**: Search the web for real-time information — news, analysis, company data, market events, or any general knowledge.',
    '  Use when the user asks about current events, recent news, external data not in the portfolio, or anything beyond portfolio/market tool scope.',
    '  Always cite sources from search results in your response.',
    '  IMPORTANT: webSearch requires the TAVILY_API_KEY to be configured. If the search fails with an API key error, inform the user.',
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
    private readonly taxService: TaxService,
    private readonly telemetryService: BraintrustTelemetryService,
    private readonly toolDispatcher: ToolDispatcherService
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

        // ── Route through ToolDispatcher ───────────────────────────────
        const outputSchema = OUTPUT_SCHEMA_REGISTRY[toolName];
        const dispatched: DispatchResult<T> =
          await this.toolDispatcher.dispatch<T>(toolName, args, executeFn, {
            outputSchema
          });

        let result = dispatched.result;
        const durationMs = Date.now() - start;

        // Estimate per-step cost: each tool call involves ~1K prompt tokens
        // + ~500 completion tokens for the LLM's reasoning step
        costLimiter.addCost(estimateCost(modelId, 1000, 500));

        // Runtime output schema validation (for local path; MCP path
        // validates inside ToolDispatcher, but we double-check here)
        if (dispatched.executor === 'local' && outputSchema) {
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
                error: failureTracker.getAbortReason(),
                executor: dispatched.executor,
                mcpRequestId: dispatched.mcpRequestId,
                mcpLatencyMs: dispatched.mcpLatencyMs
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

          // Replace result with error so the LLM does not use blocked data
          result = {
            status: 'error',
            data: undefined,
            message: `Verification gate blocked: ${gate.reason}`,
            verification: createVerificationResult({
              passed: false,
              confidence: 0,
              errors: [`Blocked by verification gate: ${gate.reason}`],
              sources: result.verification?.sources ?? [toolName]
            })
          } as unknown as T;
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
            error: spanError,
            executor: dispatched.executor,
            mcpRequestId: dispatched.mcpRequestId,
            mcpLatencyMs: dispatched.mcpLatencyMs
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

    // ── Safe portfolio data fetcher ─────────────────────────────────
    // Prefers getDetailsQuick() which computes holdings directly from
    // activities + live quotes — no Redis cache or BullMQ job queue
    // dependency. Falls back to getDetails() if quick path fails.
    // NOTE: Tools MUST check details.hasErrors when holdings is empty to
    // distinguish a genuine empty portfolio from a failed data fetch.
    const safeGetDetails = async (
      opts: { withSummary?: boolean } = {}
    ): Promise<
      Awaited<ReturnType<typeof this.portfolioService.getDetails>> & {
        hasErrors: boolean;
        _degraded?: boolean;
      }
    > => {
      // 1. Try getDetailsQuick — computes holdings in-process from
      //    activities + live quotes. No Redis/BullMQ dependency.
      try {
        const result = await this.portfolioService.getDetailsQuick({
          userId,
          impersonationId: undefined
        });

        const holdingsCount = Object.keys(result.holdings).length;

        Logger.debug(
          `portfolioService.getDetailsQuick() returned ${holdingsCount} holdings, hasErrors=${result.hasErrors} for userId=${userId}`,
          'AiService'
        );

        return result;
      } catch (quickErr) {
        Logger.warn(
          `portfolioService.getDetailsQuick() failed for userId=${userId}, falling back to getDetails(): ${quickErr instanceof Error ? quickErr.message : String(quickErr)}`,
          'AiService'
        );
      }

      // 2. Fallback to getDetails (uses Redis + BullMQ snapshot pipeline)
      try {
        const result = await this.portfolioService.getDetails({
          userId,
          impersonationId: undefined,
          withSummary: opts.withSummary
        });

        const holdingsCount = Object.keys(result.holdings).length;

        Logger.debug(
          `portfolioService.getDetails() fallback returned ${holdingsCount} holdings, hasErrors=${result.hasErrors} for userId=${userId}`,
          'AiService'
        );

        return result;
      } catch (err) {
        Logger.error(
          `portfolioService.getDetails() fallback also failed for userId=${userId}: ${err instanceof Error ? err.stack : String(err)}`,
          'AiService'
        );

        // Return a minimal result so tools can produce a meaningful "unavailable" response
        // instead of crashing the entire tool call.
        // Tools check hasErrors to distinguish this from a genuine empty portfolio.
        return {
          holdings: {},
          accounts: {},
          platforms: {},
          hasErrors: true,
          _degraded: true
        } as any;
      }
    };

    const safeGetPerformance = async (
      dateRange: DateRange
    ): Promise<
      Awaited<ReturnType<typeof this.portfolioService.getPerformance>> & {
        hasErrors: boolean;
        _degraded?: boolean;
      }
    > => {
      // 1. Try getPerformanceQuick — computes in-process, no Redis/BullMQ.
      //    Note: does not support dateRange filtering (always returns full range).
      try {
        const result = await this.portfolioService.getPerformanceQuick({
          userId,
          impersonationId: undefined
        });

        Logger.debug(
          `portfolioService.getPerformanceQuick() succeeded for userId=${userId}`,
          'AiService'
        );

        return result;
      } catch (quickErr) {
        Logger.warn(
          `portfolioService.getPerformanceQuick() failed for userId=${userId}, falling back to getPerformance(): ${quickErr instanceof Error ? quickErr.message : String(quickErr)}`,
          'AiService'
        );
      }

      // 2. Fallback to getPerformance (uses Redis + BullMQ snapshot pipeline)
      try {
        return await this.portfolioService.getPerformance({
          userId,
          impersonationId: undefined,
          dateRange
        });
      } catch (err) {
        Logger.error(
          `portfolioService.getPerformance() fallback also failed for userId=${userId}: ${err instanceof Error ? err.message : String(err)}`,
          'AiService'
        );

        return {
          chart: [],
          hasErrors: true,
          performance: {
            currentNetWorth: 0,
            currentValueInBaseCurrency: 0,
            totalInvestment: 0,
            netPerformance: 0,
            netPerformancePercentage: 0,
            netPerformanceWithCurrencyEffect: 0,
            netPerformancePercentageWithCurrencyEffect: 0,
            annualizedPerformancePercent: null
          },
          firstOrderDate: null,
          _degraded: true
        } as any;
      }
    };

    // ── Safe holding detail fetcher ────────────────────────────────
    // Quick path: synthesize a PortfolioHoldingResponse-like object from
    // the PortfolioPosition already available via safeGetDetails (uses
    // getDetailsQuick → getHoldingsQuick under the hood, no Redis/BullMQ).
    // Falls back to the full portfolioService.getHolding() if quick path
    // fails. This mirrors the pattern used by safeGetDetails/safeGetPerformance.
    const safeGetHolding = async (
      symbol: string,
      dataSource: DataSource
    ): Promise<{
      holding:
        | Awaited<ReturnType<typeof this.portfolioService.getHolding>>
        | undefined;
      hasErrors: boolean;
    }> => {
      // 1. Try quick path: extract from safeGetDetails holdings
      try {
        const details = await safeGetDetails();
        const pos = Object.values(details.holdings).find(
          (h) => h.symbol?.toUpperCase() === symbol.toUpperCase()
        );

        if (pos) {
          // Synthesize a PortfolioHoldingResponse-compatible object from
          // the PortfolioPosition. Fields not available in the quick path
          // are set to null/0/empty — buildHoldingDetailResult handles
          // these gracefully with ?? fallbacks.
          const investmentNum =
            (pos as any).investment ?? (pos as any).valueInBaseCurrency ?? 0;
          const avgPrice = pos.quantity > 0 ? investmentNum / pos.quantity : 0;

          const synthesized = {
            activitiesCount: pos.activitiesCount ?? 0,
            averagePrice: avgPrice,
            dataProviderInfo: undefined,
            dateOfFirstActivity: pos.dateOfFirstActivity
              ? typeof pos.dateOfFirstActivity === 'string'
                ? pos.dateOfFirstActivity
                : new Date(pos.dateOfFirstActivity).toISOString().split('T')[0]
              : null,
            dividendInBaseCurrency: (pos as any).dividend ?? 0,
            dividendYieldPercent: null,
            dividendYieldPercentWithCurrencyEffect: null,
            feeInBaseCurrency: 0, // not available in quick path
            grossPerformance: pos.grossPerformance ?? null,
            grossPerformancePercent: pos.grossPerformancePercent ?? null,
            grossPerformancePercentWithCurrencyEffect:
              pos.grossPerformancePercentWithCurrencyEffect ?? null,
            grossPerformanceWithCurrencyEffect:
              pos.grossPerformanceWithCurrencyEffect ?? null,
            historicalData: [], // not available in quick path
            investmentInBaseCurrencyWithCurrencyEffect: investmentNum,
            marketPrice: pos.marketPrice ?? 0,
            marketPriceMax: null, // not available in quick path
            marketPriceMin: null, // not available in quick path
            netPerformance: pos.netPerformance ?? null,
            netPerformancePercent: pos.netPerformancePercent ?? null,
            netPerformancePercentWithCurrencyEffect:
              pos.netPerformancePercentWithCurrencyEffect ?? null,
            netPerformanceWithCurrencyEffect:
              pos.netPerformanceWithCurrencyEffect ?? null,
            performances: null, // allTimeHigh not available in quick path
            quantity: pos.quantity ?? 0,
            SymbolProfile: {
              symbol: pos.symbol,
              name: pos.name ?? null,
              currency: pos.currency ?? null,
              assetClass: (pos as any).assetClass ?? null,
              assetSubClass: (pos as any).assetSubClass ?? null
            },
            tags: (pos as any).tags ?? [],
            value: (pos as any).valueInBaseCurrency ?? 0
          } as any;

          Logger.debug(
            `safeGetHolding quick path: synthesized holding for ${symbol} from getDetailsQuick`,
            'AiService'
          );

          return {
            holding: synthesized,
            hasErrors: details.hasErrors ?? false
          };
        }

        Logger.debug(
          `safeGetHolding quick path: symbol ${symbol} not found in details holdings`,
          'AiService'
        );
      } catch (quickErr) {
        Logger.warn(
          `safeGetHolding quick path failed for ${symbol}: ${quickErr instanceof Error ? quickErr.message : String(quickErr)}`,
          'AiService'
        );
      }

      // 2. Fallback: full portfolioService.getHolding (uses Redis/BullMQ snapshot pipeline)
      try {
        const holding = await this.portfolioService.getHolding({
          dataSource,
          symbol,
          userId,
          impersonationId: undefined
        });

        Logger.debug(
          `safeGetHolding fallback: portfolioService.getHolding() succeeded for ${symbol}`,
          'AiService'
        );

        return { holding, hasErrors: false };
      } catch (err) {
        Logger.warn(
          `portfolioService.getHolding() fallback also failed for ${symbol}: ${err instanceof Error ? err.message : String(err)}`,
          'AiService'
        );

        return { holding: undefined, hasErrors: true };
      }
    };

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
                  const details = await safeGetDetails({ withSummary: true });

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
                  const details = await safeGetDetails();

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
                  const dateRange = (args.dateRange as DateRange) || 'max';
                  const perf = await safeGetPerformance(dateRange);

                  const result = buildPerformanceResult(
                    perf,
                    dateRange,
                    userCurrency
                  );

                  // Add quoteMetadata for degraded results
                  if ((perf as any)._degraded) {
                    (result as any).quoteMetadata = {
                      quoteStatus: 'unavailable',
                      message:
                        'Performance data is based on last available prices — live market data was unreachable'
                    };
                  }

                  return result as ToolOutput<typeof result>;
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
              'Get recent news items for a symbol. Returns titles, links, thumbnails, and publisher info. Use for market context and "what is happening with X" questions. When presenting results: (1) Make each thumbnail a clickable link to the article using markdown [![Headline](thumbnail_url)](article_url); (2) include headline, bullet-point summary, source, and a separate clickable article URL.',
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
                  const details = await safeGetDetails();

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
                  const details = await safeGetDetails();

                  return buildScenarioImpactResult(details, args) as ToolOutput<
                    ReturnType<typeof buildScenarioImpactResult>
                  >;
                }
              );
            }
          }),

          // ── New Portfolio Detail Tools ──────────────────────────────────

          getHoldingDetail: tool({
            description:
              'Get detailed info for a specific portfolio holding: position size, performance, dividends, fees, historical price data, all-time high. Use when user asks about a specific holding (e.g. "how is my AAPL doing?").',
            parameters: GetHoldingDetailInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'getHoldingDetail',
                args as unknown as Record<string, unknown>,
                async () => {
                  const resolvedDataSource =
                    (args.dataSource as DataSource | undefined) ??
                    DataSource.YAHOO;

                  // safeGetHolding tries quick path (safeGetDetails) first,
                  // then falls back to portfolioService.getHolding().
                  // No need to call safeGetDetails separately for dataSource
                  // resolution — the quick path handles symbol lookup internally.
                  const { holding, hasErrors } = await safeGetHolding(
                    args.symbol,
                    resolvedDataSource
                  );

                  return buildHoldingDetailResult(
                    holding,
                    args.symbol,
                    resolvedDataSource,
                    hasErrors
                  ) as ToolOutput<ReturnType<typeof buildHoldingDetailResult>>;
                }
              );
            }
          }),

          getPortfolioChart: tool({
            description:
              'Get portfolio value over time as chart data points (date, netWorth, totalInvestment, performance %). Includes summary with peak, trough, and total change. Use for "show me my portfolio chart", "how has my portfolio done this year", or trend analysis questions.',
            parameters: GetPortfolioChartInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'getPortfolioChart',
                args as unknown as Record<string, unknown>,
                async () => {
                  const dateRange = (args.dateRange as DateRange) || '1y';
                  const perf = await safeGetPerformance(dateRange);

                  return buildPortfolioChartResult(
                    perf.chart ?? [],
                    perf.hasErrors ?? false,
                    !!(perf as any)._degraded,
                    {
                      dateRange: args.dateRange,
                      maxPoints: args.maxPoints
                    },
                    userCurrency
                  ) as ToolOutput<ReturnType<typeof buildPortfolioChartResult>>;
                }
              );
            }
          }),

          getDividendSummary: tool({
            description:
              'Get dividend income summary: total dividends received, breakdown by symbol, by period (month/year), and recent dividend events. Use for "how much dividend income", "which stocks pay me dividends", or "dividends this year" questions.',
            parameters: GetDividendSummaryInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'getDividendSummary',
                args as unknown as Record<string, unknown>,
                async () => {
                  const { activities } = await this.orderService.getOrders({
                    userId,
                    userCurrency,
                    types: ['DIVIDEND'] as any,
                    take: Number.MAX_SAFE_INTEGER,
                    sortDirection: 'desc'
                  });

                  return buildDividendSummaryResult(
                    activities,
                    args,
                    userCurrency
                  ) as ToolOutput<
                    ReturnType<typeof buildDividendSummaryResult>
                  >;
                }
              );
            }
          }),

          // ── Tax Intelligence Tools ─────────────────────────────────────

          listConnectedAccounts: tool({
            description:
              'List all connected brokerage (SnapTrade) and bank (Plaid) accounts. Use when user asks about connected accounts or account connectivity.',
            parameters: ListConnectedAccountsInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'listConnectedAccounts',
                args as unknown as Record<string, unknown>,
                async () => {
                  const accounts =
                    await this.taxService.listConnectedAccounts(userId);

                  return buildListConnectedAccountsResult(
                    accounts
                  ) as ToolOutput<
                    ReturnType<typeof buildListConnectedAccountsResult>
                  >;
                }
              );
            }
          }),

          syncAccount: tool({
            description:
              'Trigger a sync for a specific connected brokerage or bank account. Use when user asks to refresh or update account data.',
            parameters: SyncAccountInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'syncAccount',
                args as unknown as Record<string, unknown>,
                async () => {
                  const syncResult = await this.taxService.syncAccount(
                    userId,
                    args.connectionId,
                    args.type
                  );

                  return buildSyncAccountResult(syncResult) as ToolOutput<
                    ReturnType<typeof buildSyncAccountResult>
                  >;
                }
              );
            }
          }),

          getTaxHoldings: tool({
            description:
              'Get normalized holdings across all connected accounts with cost basis and unrealized gain/loss. Use for cross-account holdings or cost basis questions.',
            parameters: GetTaxHoldingsInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'getTaxHoldings',
                args as unknown as Record<string, unknown>,
                async () => {
                  const holdings = await this.taxService.getTaxHoldings(
                    userId,
                    {
                      symbol: args.symbol,
                      accountId: args.accountId
                    }
                  );

                  return buildTaxHoldingsResult(holdings) as ToolOutput<
                    ReturnType<typeof buildTaxHoldingsResult>
                  >;
                }
              );
            }
          }),

          getTaxTransactions: tool({
            description:
              'Get tax-relevant transactions with optional date range and symbol filtering. Use for transaction history questions related to tax.',
            parameters: GetTaxTransactionsInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'getTaxTransactions',
                args as unknown as Record<string, unknown>,
                async () => {
                  const { transactions, totalCount } =
                    await this.taxService.getTaxTransactions(userId, {
                      symbol: args.symbol,
                      startDate: args.startDate,
                      endDate: args.endDate,
                      limit: args.limit
                    });

                  return buildTaxTransactionsResult(transactions, totalCount, {
                    from: args.startDate ?? null,
                    to: args.endDate ?? null
                  }) as ToolOutput<
                    ReturnType<typeof buildTaxTransactionsResult>
                  >;
                }
              );
            }
          }),

          getTaxLots: tool({
            description:
              'Get tax lots derived from transactions using FIFO method. Shows cost basis, holding period (short/long term), and status. Use when user asks about cost basis, tax lots, or holding periods.',
            parameters: GetTaxLotsInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'getTaxLots',
                args as unknown as Record<string, unknown>,
                async () => {
                  const lots = await this.taxService.getTaxLots(userId, {
                    symbol: args.symbol,
                    status: args.status as any
                  });

                  return buildTaxLotsResult(lots) as ToolOutput<
                    ReturnType<typeof buildTaxLotsResult>
                  >;
                }
              );
            }
          }),

          simulateSale: tool({
            description:
              'Simulate selling shares and estimate tax impact using FIFO lot selection. Returns lots consumed, short-term vs long-term gains, estimated federal + state tax + NIIT (3.8%). SELF-CONTAINED: automatically fetches current market price and tax lots — do NOT call getQuote or getTaxLots first. If user says "sell all my X shares", call getTaxHoldings with symbol filter FIRST to get quantity, then call simulateSale. Supports stateTaxPct (e.g. 13.3 for California) and includeNIIT. IMPORTANT: Always include the disclaimer that this is an estimate, not tax advice.',
            parameters: SimulateSaleInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'simulateSale',
                args as unknown as Record<string, unknown>,
                async () => {
                  const simulation = await this.taxService.simulateSaleForUser(
                    userId,
                    {
                      symbol: args.symbol,
                      quantity: args.quantity,
                      pricePerShare: args.pricePerShare,
                      taxBracketPct: args.taxBracketPct,
                      longTermBracketPct: args.longTermBracketPct,
                      stateTaxPct: args.stateTaxPct,
                      includeNIIT: args.includeNIIT
                    }
                  );

                  return buildSimulateSaleResult(simulation) as ToolOutput<
                    ReturnType<typeof buildSimulateSaleResult>
                  >;
                }
              );
            }
          }),

          portfolioLiquidation: tool({
            description:
              'Simulate liquidating ALL portfolio holdings at current market prices and estimate total tax liability across the entire portfolio. SELF-CONTAINED: fetches all holdings, market prices, and tax lots internally — do NOT call getTaxHoldings, getQuote, or any other tool first. Shows per-holding breakdown with gains, losses, and tax. Supports federal, state, and NIIT. Use when user asks "what if I sell everything" or "total tax if I liquidate". IMPORTANT: High-stakes estimate — always include disclaimer.',
            parameters: PortfolioLiquidationInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'portfolioLiquidation',
                args as unknown as Record<string, unknown>,
                async () => {
                  const result =
                    await this.taxService.simulatePortfolioLiquidation(userId, {
                      taxBracketPct: args.taxBracketPct,
                      longTermBracketPct: args.longTermBracketPct,
                      stateTaxPct: args.stateTaxPct,
                      includeNIIT: args.includeNIIT,
                      topN: args.topN
                    });

                  return buildPortfolioLiquidationResult(result) as ToolOutput<
                    ReturnType<typeof buildPortfolioLiquidationResult>
                  >;
                }
              );
            }
          }),

          taxLossHarvest: tool({
            description:
              'Find tax-loss harvesting candidates — holdings with unrealized losses that could be sold to offset capital gains. SELF-CONTAINED: fetches holdings, market prices, and lots internally — do NOT call other tools first. Shows potential tax savings, flags wash sale risk. Use when user asks about tax-loss harvesting, reducing tax bill, or offsetting gains.',
            parameters: TaxLossHarvestInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'taxLossHarvest',
                args as unknown as Record<string, unknown>,
                async () => {
                  const result =
                    await this.taxService.findTaxLossHarvestCandidates(userId, {
                      minLoss: args.minLoss,
                      taxBracketPct: args.taxBracketPct
                    });

                  return buildTaxLossHarvestResult(result) as ToolOutput<
                    ReturnType<typeof buildTaxLossHarvestResult>
                  >;
                }
              );
            }
          }),

          washSaleCheck: tool({
            description:
              'Check for IRS wash sale violations by scanning for substantially identical purchases within 30 days before/after a loss sale. SELF-CONTAINED: fetches transaction history and lots internally — do NOT call other tools first. Flags confirmed wash sales and at-risk positions. Use when user asks about wash sales, or before recommending tax-loss harvesting.',
            parameters: WashSaleCheckInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'washSaleCheck',
                args as unknown as Record<string, unknown>,
                async () => {
                  const result = await this.taxService.checkWashSales(userId, {
                    symbol: args.symbol,
                    lookbackDays: args.lookbackDays
                  });

                  return buildWashSaleCheckResult(result) as ToolOutput<
                    ReturnType<typeof buildWashSaleCheckResult>
                  >;
                }
              );
            }
          }),

          createAdjustment: tool({
            description:
              'Create a cost basis adjustment for a holding. Use when user wants to correct missing or wrong cost basis data.',
            parameters: CreateAdjustmentInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'createAdjustment',
                args as unknown as Record<string, unknown>,
                async () => {
                  const adjustment = await this.taxService.createAdjustment(
                    userId,
                    {
                      symbol: args.symbol,
                      adjustmentType: args.adjustmentType as any,
                      data: args.data,
                      note: args.data.note
                    }
                  );

                  return buildCreateAdjustmentResult(adjustment) as ToolOutput<
                    ReturnType<typeof buildCreateAdjustmentResult>
                  >;
                }
              );
            }
          }),

          updateAdjustment: tool({
            description:
              'Update an existing cost basis adjustment. Use when user wants to modify a previously created adjustment.',
            parameters: UpdateAdjustmentInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'updateAdjustment',
                args as unknown as Record<string, unknown>,
                async () => {
                  const adjustment = await this.taxService.updateAdjustment(
                    userId,
                    args.adjustmentId,
                    { data: args.data, note: args.data.note }
                  );

                  return buildUpdateAdjustmentResult(adjustment) as ToolOutput<
                    ReturnType<typeof buildUpdateAdjustmentResult>
                  >;
                }
              );
            }
          }),

          deleteAdjustment: tool({
            description:
              'Delete a cost basis adjustment. Use when user wants to remove a previously created adjustment.',
            parameters: DeleteAdjustmentInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'deleteAdjustment',
                args as unknown as Record<string, unknown>,
                async () => {
                  await this.taxService.deleteAdjustment(
                    userId,
                    args.adjustmentId
                  );

                  return buildDeleteAdjustmentResult(
                    args.adjustmentId
                  ) as ToolOutput<
                    ReturnType<typeof buildDeleteAdjustmentResult>
                  >;
                }
              );
            }
          }),

          webSearch: tool({
            description:
              'Search the web for real-time information — news, analysis, company data, market events, or general knowledge. Use when the user asks about current events, recent news, external data not in the portfolio, or anything requiring live web data. Always cite sources from results.',
            parameters: WebSearchInputSchema,
            execute: async (args) => {
              return executeWithGuardrails(
                'webSearch',
                args as unknown as Record<string, unknown>,
                async () => {
                  const tavilyApiKey = process.env.TAVILY_API_KEY;

                  if (!tavilyApiKey) {
                    return buildWebSearchResult(
                      undefined,
                      args,
                      'Web search is not configured — TAVILY_API_KEY environment variable is missing.'
                    ) as ToolOutput<ReturnType<typeof buildWebSearchResult>>;
                  }

                  try {
                    const tavilyResponse = await executeWebSearch(
                      args,
                      tavilyApiKey
                    );

                    return buildWebSearchResult(
                      tavilyResponse,
                      args
                    ) as ToolOutput<ReturnType<typeof buildWebSearchResult>>;
                  } catch (searchError) {
                    Logger.warn(
                      `webSearch failed: ${searchError instanceof Error ? searchError.message : String(searchError)}`,
                      'AiService'
                    );

                    return buildWebSearchResult(
                      undefined,
                      args,
                      searchError instanceof Error
                        ? searchError.message
                        : 'Web search request failed'
                    ) as ToolOutput<ReturnType<typeof buildWebSearchResult>>;
                  }
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
      const estimatedCost = estimateCost(modelId, inputTokens, outputTokens);

      trace.setTokens(inputTokens, outputTokens);
      trace.setCost(estimatedCost);

      // Wire cost limiter — accumulate actual cost so the guardrail works
      costLimiter.addCost(estimatedCost);
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
          ? 'Your request took too long to process. This can happen with complex portfolio analysis, large files, or when market data providers are slow. Try a more specific question or ask about fewer symbols at once.'
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
