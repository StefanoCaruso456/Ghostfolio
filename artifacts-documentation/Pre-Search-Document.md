# Ghostfolio AI — Pre-Search Document

> Phase 1–3 checklist covering research, tool landscape, and design decisions made before implementation.

---

## Phase 1: Problem Definition & Research

### 1.1 Problem Statement

Ghostfolio users need an intelligent, conversational interface to query their portfolio data, understand market context, and run what-if scenarios — without manually navigating dashboards or learning query syntax.

### 1.2 Domain Analysis

| Dimension             | Finding                                                                     |
| --------------------- | --------------------------------------------------------------------------- |
| **Domain**            | Personal finance / portfolio management                                     |
| **User persona**      | Self-directed investors managing multi-asset portfolios                     |
| **Information needs** | Portfolio overview, performance, allocations, market data, rebalancing      |
| **Risk level**        | High — financial data requires accuracy, no hallucinations                  |
| **Regulatory**        | Must not provide personalized investment advice, tax advice, or predictions |

### 1.3 Why Agentic (Not Simple RAG)

Per AgentForge decision framework, the AI chat qualifies for an agentic pattern because:

| Criterion           | Applies? | Evidence                                                                       |
| ------------------- | -------- | ------------------------------------------------------------------------------ |
| Unknown info needs  | Yes      | User may ask about holdings, then follow up with market data                   |
| Multi-system access | Yes      | Portfolio DB + market APIs + scenario engine                                   |
| Complex analysis    | Yes      | Rebalancing math, scenario impact, cross-referencing holdings with market data |
| Dynamic decisions   | Yes      | Tool selection depends on user query, not fixed pipeline                       |
| Human-in-the-loop   | Yes      | Financial domain requires verification gates                                   |

### 1.4 Competitive Landscape

| Product               | Approach                         | Limitations                                        |
| --------------------- | -------------------------------- | -------------------------------------------------- |
| Wealthfront AI        | Chat with portfolio              | Closed ecosystem, no self-hosting                  |
| Copilot Money         | Transaction categorization       | No portfolio analysis tools                        |
| ChatGPT + manual data | General LLM                      | No real-time portfolio integration                 |
| **Ghostfolio AI**     | **ReAct agent with tool access** | **Open source, self-hosted, 10 specialized tools** |

---

## Phase 2: Architecture Decisions

### 2.1 LLM Provider Decision

| Option               | Pros                                                     | Cons                        | Decision     |
| -------------------- | -------------------------------------------------------- | --------------------------- | ------------ |
| Direct Anthropic API | Lowest latency                                           | Vendor lock-in              | Rejected     |
| Direct OpenAI API    | Wide model selection                                     | Vendor lock-in              | Rejected     |
| **OpenRouter**       | **Model flexibility, single API key, cost optimization** | **Slight latency overhead** | **Selected** |

**Rationale**: OpenRouter allows switching models (Claude, GPT-4o, Gemini) without code changes. The `PROPERTY_OPENROUTER_MODEL` database property enables runtime model switching without deployment.

### 2.2 SDK Decision

| Option            | Pros                                                   | Cons                                        | Decision     |
| ----------------- | ------------------------------------------------------ | ------------------------------------------- | ------------ |
| LangChain         | Rich ecosystem                                         | Heavy dependency, abstractions hide control | Rejected     |
| LlamaIndex        | Good for RAG                                           | Over-engineered for tool-calling agent      | Rejected     |
| **Vercel AI SDK** | **Lightweight, native tool support, TypeScript-first** | **Less ecosystem**                          | **Selected** |

**Rationale**: Vercel AI SDK's `generateText()` with `tools` parameter maps directly to the ReAct pattern. Combined with `@openrouter/ai-sdk-provider`, it provides clean tool orchestration with minimal abstraction.

### 2.3 Tool Architecture Decision

| Option                   | Pros                                                      | Cons                         | Decision     |
| ------------------------ | --------------------------------------------------------- | ---------------------------- | ------------ |
| Monolithic handler       | Simple to implement                                       | Unmaintainable, hard to test | Rejected     |
| Plugin system            | Hot-reloadable                                            | Over-engineered for 10 tools | Rejected     |
| **Inline tool registry** | **Co-located with LLM call, Zod validation, easy to add** | **All in one file**          | **Selected** |

**Rationale**: 10 tools defined inline in `ai.service.ts` with Zod schemas in `tools/schemas/`. Each tool is atomic (one purpose), idempotent (safe to retry), and well-documented (description drives LLM selection).

### 2.4 Guardrail Architecture Decision

| Guardrail         | Why Needed                          | Implementation                                  |
| ----------------- | ----------------------------------- | ----------------------------------------------- |
| Circuit breaker   | Prevent infinite tool-call loops    | `CircuitBreaker` class, 3-repetition limit      |
| Cost limiter      | Prevent bill explosions             | `CostLimiter` class, $1/query cap               |
| Failure tracker   | Prevent cascading failures          | `ToolFailureTracker`, backoff + abort           |
| Verification gate | Prevent hallucinated financial data | `VerificationResult` schema, confidence scoring |
| Timeout           | Prevent hung requests               | 45s `AbortController`                           |
| Max iterations    | Bound compute                       | 10-step hard limit                              |

### 2.5 Evaluation Strategy Decision

| Option                       | Pros                                | Cons                                | Decision                   |
| ---------------------------- | ----------------------------------- | ----------------------------------- | -------------------------- |
| Manual testing               | Quick to start                      | Not reproducible, doesn't scale     | Rejected for production    |
| LLM-as-judge                 | Nuanced evaluation                  | Expensive, non-deterministic        | Considered for Stage 3     |
| **Deterministic golden set** | **Zero-cost, binary, reproducible** | **Can't evaluate response quality** | **Selected for Stage 1–2** |

**Rationale**: Golden set (54 cases) + labeled scenarios (29 cases) provide deterministic checks for tool selection, source citation, content validation, and negative validation. No LLM judge needed for Stage 1–2.

---

## Phase 3: Design Specification

### 3.1 Tool Registry (10 Tools)

| #   | Tool                  | Category  | Data Source                         |
| --- | --------------------- | --------- | ----------------------------------- |
| 1   | `getPortfolioSummary` | Portfolio | Ghostfolio Portfolio Service        |
| 2   | `listActivities`      | Portfolio | Ghostfolio Order Service            |
| 3   | `getAllocations`      | Portfolio | Ghostfolio Portfolio Service        |
| 4   | `getPerformance`      | Portfolio | Ghostfolio Portfolio Service        |
| 5   | `getQuote`            | Market    | Yahoo Finance 2 (via data provider) |
| 6   | `getHistory`          | Market    | Yahoo Finance 2                     |
| 7   | `getFundamentals`     | Market    | Yahoo Finance 2                     |
| 8   | `getNews`             | Market    | Yahoo Finance 2                     |
| 9   | `computeRebalance`    | Decision  | Portfolio Service + math            |
| 10  | `scenarioImpact`      | Decision  | Portfolio Service + math            |

### 3.2 Verification Types (5 Implemented)

| #   | Type                      | When Used                                   |
| --- | ------------------------- | ------------------------------------------- |
| 1   | `confidence_scoring`      | Every tool result (0–1 scale)               |
| 2   | `hallucination_detection` | Post-response groundedness check            |
| 3   | `domain_constraint`       | Ticker validation, real portfolio data only |
| 4   | `fact_check`              | Cross-reference tool outputs                |
| 5   | `human_in_the_loop`       | High-risk financial advice escalation       |

### 3.3 System Prompt Design

The system prompt (`buildReActSystemPrompt()`) follows AgentForge ReAct protocol:

1. **Role**: "You are Ghostfolio AI, a financial assistant..."
2. **Protocol**: THINK → ACT → OBSERVE → DECIDE
3. **Format rules**: Language matching, currency formatting, markdown
4. **Anti-hallucination contract**:
   - Never invent prices, allocations, or performance figures
   - Never reference holdings not returned by tools
   - Always call tools before stating any numbers
   - Show work using tool-provided values

### 3.4 Frontend Design

- Neomorphic sidebar with dual-shadow styling
- Suggested prompts on welcome screen
- Markdown rendering for assistant responses
- Conversation history with localStorage persistence
- File attachments (images + CSV) with thumbnail previews
- Thumbs up/down feedback on assistant messages
- Copy and retry actions

### 3.5 Telemetry Design

Three-layer observability via Braintrust:

| Layer                | Data Collected                                             |
| -------------------- | ---------------------------------------------------------- |
| Trace-level          | Request ID, user ID, model, latency, total tokens, cost    |
| Tool spans           | Per-tool timing, input/output, status, verification result |
| Verification summary | Hallucination flags, confidence scores, domain violations  |

### 3.6 Security Considerations

| Risk                        | Mitigation                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------- |
| Prompt injection            | System prompt includes anti-injection rules; adversarial test cases (ls-060, ls-061)  |
| Data exfiltration           | JWT-guarded endpoints, user-scoped portfolio data                                     |
| Cost abuse                  | $1/query cap, circuit breaker, rate limiting                                          |
| Hallucinated financial data | Verification gate, groundedness check, domain constraints                             |
| Investment advice liability | Safety test cases (gs-015, gs-044–047, ls-070–072) refuse recommendations/predictions |

---

## Phase Summary

| Phase                 | Status   | Key Artifacts                                                         |
| --------------------- | -------- | --------------------------------------------------------------------- |
| Phase 1: Research     | Complete | Problem definition, domain analysis, competitive landscape            |
| Phase 2: Architecture | Complete | Provider/SDK/tool/guardrail/eval decisions                            |
| Phase 3: Design       | Complete | Tool registry, verification types, system prompt, frontend, telemetry |
| Implementation        | Complete | `ai.service.ts`, 10 tools, guardrails, evals, telemetry, frontend     |
| Evaluation            | Complete | 54 golden set + 29 labeled scenarios = 83 AI chat eval cases          |
