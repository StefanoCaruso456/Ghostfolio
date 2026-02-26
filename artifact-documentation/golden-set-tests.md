# AI Chat — Test Suite

## Overview

The AI chat system has **143 tests** across 6 test files organized in a 3-stage evaluation framework, plus infrastructure and proof tests. All tests run without an LLM, network access, or Docker/Postgres/Redis.

## How to Run

```bash
# Run all AI endpoint tests (143 tests)
npx jest --config apps/api/jest.config.ts --testPathPatterns="endpoints/ai" --no-coverage

# Run golden set tests only (28 tests)
npx jest --config apps/api/jest.config.ts --testPathPatterns="golden-set" --no-coverage

# Run telemetry tests only (77 tests = 56 infrastructure + 21 service-level)
npx jest --config apps/api/jest.config.ts --testPathPatterns="telemetry" --no-coverage

# Run all tests (AI chat + import auditor)
npx jest --config apps/api/jest.config.ts --testPathPatterns="endpoints/ai|import-auditor" --no-coverage
```

## Test Files Summary

| # | File | Tests | Stage | Purpose |
|---|------|-------|-------|---------|
| 1 | `evals/golden-set.spec.ts` | 28 | 1 (post-commit) | Deterministic tool routing, safety, content validation |
| 2 | `evals/labeled-scenarios.spec.ts` | 16 | 2 (release) | Coverage mapping, scenario framework |
| 3 | `evals/replay-harness.spec.ts` | 13 | 3 (anytime) | Record-once score-anytime replay framework |
| 4 | `__tests__/ai-chat-telemetry.spec.ts` | 21 | Service-level | Full pipeline with mocked LLM + real telemetry |
| 5 | `telemetry/__tests__/braintrust-telemetry.spec.ts` | 56 | Infrastructure | TraceContext, ToolSpanBuilder, eval scorers |
| 6 | `tools/__tests__/tool-registry-match.spec.ts` | 9 | Proof | Registry sync between tools and schemas |

---

## Stage 1: Golden Set Tests (28 tests)

**File:** `evals/golden-set.spec.ts`

Deterministic, binary pass/fail tests that run after every commit. Zero API cost, zero ambiguity.

### What Gets Tested

| Category | Tests | What They Verify |
|----------|-------|------------------|
| Structure | 4 | Min 15 test cases, unique IDs, descriptions, tool coverage |
| Tool Coverage | 4 | All 10 tools covered, safety cases, market cases, decision cases |
| Tool Selection | 4 | Correct tool chosen, missing tool detected, extra tools OK, multi-tool |
| Source Citation | 2 | Expected sources cited, missing sources detected |
| Content Validation | 3 | Required content present, forbidden content absent, case-insensitive |
| Negative Validation | 3 | Forbidden phrases rejected (e.g., "you should buy", "I recommend") |
| Composite | 2 | All checks must pass, single failure causes overall failure |
| runGoldenSet | 6 | Full scenario execution for market, decision-support, safety cases |

### Tool Categories Covered

- **Portfolio:** getPortfolioSummary, listActivities, getAllocations, getPerformance
- **Market:** getQuote, getHistory, getFundamentals, getNews
- **Decision-Support:** computeRebalance, scenarioImpact
- **Safety/Negative:** Buy recommendations, prediction requests, specific trade advice

---

## Stage 2: Labeled Scenarios (16 tests)

**File:** `evals/labeled-scenarios.spec.ts`

Coverage reporting and scenario framework validation. Ensures comprehensive scenario coverage.

| Category | Tests | What They Verify |
|----------|-------|------------------|
| Scenario Structure | 7 | Min 25 scenarios, unique IDs, valid categories/complexity/difficulty |
| Coverage Report | 3 | Coverage matrix, gap identification, per-category counts |
| Scenario Runner | 2 | Results grouped by category, handles missing IDs |
| Invariants | 4 | Category coverage, complexity distribution |

**Valid categories:** `single_tool`, `multi_tool`, `edge_case`, `adversarial`, `performance`, `safety`

---

## Stage 3: Replay Harness (13 tests)

**File:** `evals/replay-harness.spec.ts`

Record-once, score-anytime framework. Tests replay scoring without LLM calls.

| Category | Tests | What They Verify |
|----------|-------|------------------|
| No Ground Truth | 1 | Neutral 0.5 score when no reference |
| With Ground Truth | 6 | Perfect score, missing tools, forbidden content, faithfulness |
| Edge Cases | 2 | Empty tool calls, extra tools |
| Scoring Details | 4 | Detailed breakdowns of missingTools, violations, content precision |

### Faithfulness Scoring
- **1.0** -- All tool verifications pass
- **0.8** -- Tool fails but error acknowledged in response
- **0.0** -- Tool fails and error hidden/ignored

---

## Service-Level Pipeline Tests (21 tests)

**File:** `__tests__/ai-chat-telemetry.spec.ts`

Tests the full AiService.chat() pipeline with mocked `generateText()` and real telemetry infrastructure. No Docker/Postgres/Redis required.

### Mock Strategy

```
jest.mock('ai')               -- Intercept generateText() and tool()
jest.mock('@openrouter/...')  -- Intercept createOpenRouter()

Real: AiService, executeWithGuardrails(), TraceContext, ToolSpanBuilder, BraintrustTelemetryService
Mock: generateText(), PropertyService, PortfolioService, OrderService, ConversationService
```

### Test Scenarios

#### Tool Call Scenario -- "getQuote" (9 tests)
Simulates LLM calling `getQuote` for "What is the price of AAPL?":
- Tool executor invoked, valid response returned
- `logTrace()` called exactly once
- `usedTools === true`, `toolCallCount > 0`
- `toolSpans` includes `toolName === 'getQuote'` with latencyMs >= 0
- Error field populated when tool fails
- Trace metadata: sessionId, userId, model, queryText
- Verification summary: passed (boolean), confidenceScore (0-1)

#### No-Tools Prompt (7 tests)
Simulates direct response for "Hello, how are you?":
- Valid response without tool calls
- `toolCallCount === 0`, `usedTools === false`
- `toolSpans === []`, `toolNames === []`
- `success === true`, `error === null`
- Response text recorded in trace

#### Payload Structure Validation (5 tests)
- All `TelemetryPayload` fields present: trace, toolSpans, verification, reactIterations, derived
- Correct types for all trace fields
- Derived metrics computed (toolOverheadRatio, failedToolCount)

---

## Telemetry Infrastructure Tests (56 tests)

**File:** `telemetry/__tests__/braintrust-telemetry.spec.ts`

Tests core telemetry classes and scoring functions.

| Category | Tests | What They Verify |
|----------|-------|------------------|
| TraceContext | 17 | Trace creation, latency breakdown, tokens, cost, tool spans, verification, guardrails, ReAct iterations |
| ToolSpanBuilder | 3 | Success/error spans, retry count, wasCorrectTool flag |
| Eval Scorers | 33 | scoreLatency, scoreCost, scoreSafety, scoreGroundedness, scoreToolSelection, scoreToolExecution, computeAllScores |
| Advanced | 3 | Provider fields, failedToolCount, output hygiene |

---

## Tool Registry Proof Tests (9 tests)

**File:** `tools/__tests__/tool-registry-match.spec.ts`

Ensures the tool registry stays in sync:

- OUTPUT_SCHEMA_REGISTRY has exactly 10 entries
- Tools object has exactly 10 entries
- Registry keys match tools keys (sorted)
- Every tool has a non-null Zod schema with `safeParse()`
- Validates getQuote and getPortfolioSummary output schemas

---

## When to Update Tests

| Scenario | Action |
|----------|--------|
| Add a new tool | Add to golden-set tool coverage, labeled scenarios, registry proof test |
| Change system prompt rules | Update golden-set content/negative validation |
| Modify response shape | Update telemetry payload structure tests |
| Convert tool behavior | Update golden-set routing + labeled scenario expectations |
| Change guardrails | Update telemetry infrastructure tests |
| Add market data provider | Update provider-related tests |
| Change scoring logic | Update eval scorer tests |
