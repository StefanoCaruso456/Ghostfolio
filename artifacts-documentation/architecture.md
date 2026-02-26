# AI Chat — Architecture

## End-to-End Request Flow

```
User opens AI Chat sidebar
  |
  v
GfAiChatSidebarComponent        apps/client/src/app/components/ai-chat-sidebar/
  |  onSendMessage() sends { message, conversationId, history, attachments }
  |  Supports: file attachments (CSV, PDF, PNG, JPEG), inline rename, persistent history
  |
  v
DataService.chatWithAi()         libs/ui/src/lib/services/data.service.ts
  |  POST /api/v1/ai/chat
  |
  v
AiController.chat()              apps/api/src/app/endpoints/ai/ai.controller.ts
  |  Guards: AuthGuard('jwt'), HasPermissionGuard (permissions.readAiPrompt)
  |  Injects: userId, languageCode, baseCurrency from request user
  |  Passes: body.attachments ?? []
  |
  v
AiService.chat()                 apps/api/src/app/endpoints/ai/ai.service.ts
  |
  +-- telemetryService.startTrace()     Create Braintrust TraceContext
  +-- buildReActSystemPrompt()          Groundedness + safety + anti-hallucination rules
  +-- Assembles attachment context      CSV/PDF inline, images noted
  +-- Creates 10 tools                  4 portfolio + 4 market + 2 decision-support
  +-- executeWithGuardrails() per tool  Circuit breaker, cost limiter, schema validation
  |
  v
generateText()                   Vercel AI SDK
  |  model: OpenRouter LLM (configurable via admin settings)
  |  maxSteps: 10 (ReAct loop)
  |  messages: [system prompt, history, user message + attachments]
  |  tools: { all 10 tools }
  |
  +-- LLM decides which tool(s) to call
  +-- Tool execute() runs via executeWithGuardrails()
  +-- Results fed back to LLM
  +-- LLM generates final text response
  |
  v
Groundedness Check               Post-response validation
  |  Detects hallucination patterns, prediction language
  |  Flags tool failures not mentioned, "Sources:" on error responses
  |
  v
Conversation Persistence          Non-blocking async save
  |  AiConversationService.createConversation() / addMessages()
  |  Failures logged as warnings, never fail the response
  |
  v
Telemetry Finalization            Non-blocking async log
  |  telemetryService.logTrace(traceCtx.finalize())
  |
  v
AiChatResponse                   Returned to frontend
  { conversationId, message: { content, role: 'assistant', timestamp } }
  |
  v
GfAiChatSidebarComponent renders response with Markdown
```

## Two AI Paths (Do Not Confuse)

| Path | Endpoint | Method | Purpose |
|------|----------|--------|---------|
| **Chat (primary)** | `POST /api/v1/ai/chat` | `AiService.chat()` | Full ReAct loop with 10 tools + telemetry + persistence |
| **Prompt (legacy)** | `GET /api/v1/ai/prompt/:mode` | `AiService.getPrompt()` | Generates markdown text for clipboard copy to external AI |

The legacy prompt path has **no tools, no ReAct loop, no telemetry**. It only builds a text string.

## Conversation Endpoints (DB-Backed History)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /ai/conversations` | List | All conversations for authenticated user |
| `GET /ai/conversations/:id` | Detail | Single conversation with messages |
| `PATCH /ai/conversations/:id` | Update | Rename conversation title |
| `DELETE /ai/conversations/:id` | Delete | Remove conversation and messages (cascade) |

All guarded with JWT + `readAiPrompt` permission. Controller: `AiConversationController`.

## Production Guardrails

| Guardrail | Value | Purpose |
|-----------|-------|---------|
| `MAX_ITERATIONS` | 10 | Prevent infinite ReAct loops |
| `TIMEOUT_MS` | 45,000 | User experience limit |
| `COST_LIMIT_USD` | $1.00 | Prevent bill explosions |
| `CIRCUIT_BREAKER_MAX_REPETITIONS` | 3 | Same action 3x -> abort |

## Feature Gates

1. **Permission:** `hasPermissionToReadAiPrompt` -- controls button disabled state
2. **Experimental features:** `user.settings.isExperimentalFeatures` -- controls panel visibility
3. **API key configured:** `PROPERTY_API_KEY_OPENROUTER` must be set in admin settings

## Key Dependencies

| Package | Role |
|---------|------|
| `ai` (Vercel AI SDK) | `generateText()`, `tool()` for ReAct loop |
| `@openrouter/ai-sdk-provider` | LLM provider for OpenRouter |
| `braintrust` | Telemetry -- traces, tool spans, inline scores |
| `zod` | Schema validation for tool inputs/outputs |
| `yahoo-finance2` | Market data provider (quotes, history, fundamentals, news) |

## File Map

```
apps/api/src/app/endpoints/ai/
  +-- ai.controller.ts              Controller with POST /chat + GET /prompt/:mode
  +-- ai.service.ts                 Service: chat(), getPrompt(), executeWithGuardrails()
  +-- ai.module.ts                  NestJS module
  +-- conversation/
  |   +-- conversation.service.ts   CRUD for AiConversation + AiConversationMessage
  |   +-- conversation.controller.ts REST: GET/PATCH/DELETE /ai/conversations
  +-- telemetry/
  |   +-- braintrust-telemetry.service.ts  TraceContext, ToolSpanBuilder, logTrace()
  |   +-- telemetry.interfaces.ts          TelemetryPayload, TraceLevelSummary, ToolSpan, etc.
  |   +-- eval-scorers.ts                  scoreGroundedness, computeAllScores
  |   +-- __tests__/
  |       +-- braintrust-telemetry.spec.ts 56 telemetry infrastructure tests
  +-- evals/
  |   +-- golden-set.spec.ts               28 deterministic golden set tests
  |   +-- labeled-scenarios.spec.ts        16 coverage mapping tests
  |   +-- replay-harness.spec.ts           13 replay & scoring tests
  +-- __tests__/
  |   +-- ai-chat-telemetry.spec.ts        21 service-level pipeline tests
  +-- providers/
  |   +-- yahoo-finance2.provider.ts       Primary market data provider
  |   +-- coingecko.provider.ts            Cryptocurrency provider
  |   +-- cached-market-data.provider.ts   Caching layer with TTLs
  |   +-- index.ts                         Provider factory + cache stats
  +-- tools/
      +-- index.ts                         Barrel + OUTPUT_SCHEMA_REGISTRY (10 tools)
      +-- get-portfolio-summary.tool.ts    Real: portfolio holdings, allocations
      +-- list-activities.tool.ts          Real: orders/transactions with filters
      +-- get-allocations.tool.ts          Real: allocation breakdown by class/sector
      +-- get-performance.tool.ts          Real: net worth, returns, investment
      +-- get-quote.tool.ts               Real: live price quotes (yahoo-finance2)
      +-- get-history.tool.ts             Real: historical OHLCV data
      +-- get-fundamentals.tool.ts        Real: P/E, market cap, dividends
      +-- get-news.tool.ts                Real: financial news articles
      +-- compute-rebalance.tool.ts       Real: rebalancing math (NOT trade advice)
      +-- scenario-impact.tool.ts         Real: "what if" portfolio simulation
      +-- tool-result.helpers.ts          wrapToolResult, prepareToolSpanMetadata
      +-- schemas/                        Zod input/output schemas for all 10 tools
      +-- __tests__/
          +-- tool-registry-match.spec.ts 9 registry sync proof tests

apps/client/src/app/components/ai-chat-sidebar/
  +-- ai-chat-sidebar.component.ts   Angular standalone, OnPush, file attachments, rename, history
  +-- ai-chat-sidebar.component.html Template with markdown rendering
  +-- ai-chat-sidebar.component.scss Neomorphic design with soft shadows

libs/common/src/lib/
  +-- dtos/ai-chat.dto.ts                 AiChatDto with optional attachments
  +-- dtos/update-ai-conversation.dto.ts  UpdateAiConversationDto { title }
  +-- interfaces/ai-chat-attachment.interface.ts  AiChatAttachment type

prisma/schema.prisma
  +-- AiConversation model               id, title, userId, timestamps
  +-- AiConversationMessage model        content, conversationId, role, timestamps
```
