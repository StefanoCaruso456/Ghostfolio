# Hard Gate Audit — Evidence Report

**Date:** 2025-02-25
**App:** Ghostfolio (app.ghostclone.xyz)
**Domain:** Personal finance / portfolio management

---

## Result Summary

| #   | Requirement                                | Verdict         |
| --- | ------------------------------------------ | --------------- |
| 1   | Agent responds to natural language queries | PASS            |
| 2   | At least 3 functional tools                | PASS (6 tools)  |
| 3   | Tool calls return structured results       | PASS            |
| 4   | Agent synthesizes tool results             | PASS            |
| 5   | Conversation history maintained            | PASS            |
| 6   | Basic error handling                       | PASS            |
| 7   | Domain-specific verification check         | PASS            |
| 8   | 5+ test cases with expected outcomes       | PASS (55 cases) |

---

## 1. Agent Responds to Natural Language Queries

**Agents:** Two production agents in the finance domain.

### AI Chat Sidebar (`POST /api/v1/ai/chat`)

- Accepts natural language questions about portfolios
- Injects user's holdings as system context, LLM generates response
- File: `apps/api/src/app/endpoints/ai/ai.service.ts`

### Import Auditor (`POST /api/v1/import-auditor/chat`)

- Accepts natural language instructions for CSV import processing
- Uses ReAct loop (Thought → Action → Observation → Repeat)
- File: `apps/api/src/app/import-auditor/import-auditor.service.ts`

**Live proof:**

```
GET https://app.ghostclone.xyz/api/v1/import-auditor/health
→ {"status":"OK"}
```

---

## 2. At Least 3 Functional Tools (6 implemented)

All tools in `apps/api/src/app/import-auditor/tools/`:

| #   | Tool                     | File                                | Purpose                                                 |
| --- | ------------------------ | ----------------------------------- | ------------------------------------------------------- |
| 1   | `detectBrokerFormat`     | `detect-broker-format.tool.ts`      | Auto-detect CSV broker (IBKR, DEGIRO, Swissquote, etc.) |
| 2   | `parseCSV`               | `parse-csv.tool.ts`                 | Parse raw CSV into rows + headers                       |
| 3   | `mapBrokerFields`        | `map-broker-fields.tool.ts`         | Map CSV columns → Ghostfolio fields                     |
| 4   | `validateTransactions`   | `validate-transactions.tool.ts`     | Financial validation (currencies, dates, types)         |
| 5   | `normalizeToActivityDTO` | `normalize-to-activity-dto.tool.ts` | Convert to Ghostfolio DTO format                        |
| 6   | `generateImportPreview`  | `generate-import-preview.tool.ts`   | Summary + commit gate                                   |

**Test proof (tools execute independently):**

```
✓ E001: Full pipeline — Ghostfolio CSV parse + map + validate (8 ms)
✓ E002: Full pipeline — IBKR CSV detect + parse + map (1 ms)
✓ E026: Detect → Parse → Map → Validate → Preview (full pipeline) (1 ms)
```

---

## 3. Tool Calls Return Structured Results

Every tool returns this schema:

```typescript
{
  status: 'success' | 'error' | 'pass' | 'fail' | 'warnings',
  data: { /* tool-specific payload */ },
  verification: {
    passed: boolean,
    confidence: number,          // 0–1 scale
    warnings: string[],
    errors: string[],
    sources: string[],
    requiresHumanReview: boolean,
    domainRulesChecked: string[],
    domainRulesFailed: string[]
  },
  schemaVersion: '1.0'
}
```

**Test proof (structured output assertions):**

```
✓ E001: parseResult.status === 'success', parseResult.verification.passed === true
✓ E003: validateResult.status === 'pass', validateResult.verification.confidence === 1.0
✓ E004: previewResult.data.canCommit === true, previewResult.verification.passed === true
✓ E008: parseResult.status === 'error', parseResult.verification.passed === false
✓ E030: validateResult.verification.confidence ≈ 0.67 (2 valid / 3 total)
```

---

## 4. Agent Synthesizes Tool Results into Coherent Responses

The Import Auditor uses a ReAct loop (`import-auditor.service.ts` lines 235–573):

1. LLM reasons about what tool to call
2. Tool executes, returns structured result + verification
3. Verification gate decides: `continue` / `block` / `human_review`
4. LLM receives observation, decides next step or generates final response
5. Final response synthesizes all tool observations into natural language

**Test proof (multi-tool synthesis):**

```
✓ E026: Detect → Parse → Map → Validate → Normalize → Preview (6 tools chained)
         merged verification: passed=true, confidence > 0.5
✓ E028: Pipeline with validation failures → blocked commit
         preview.data.canCommit === false (synthesized from validate errors)
✓ E029: Pipeline with batch duplicates → warnings
         preview.verification.requiresHumanReview === true (synthesized from validate warnings)
```

---

## 5. Conversation History Maintained Across Turns

**Backend:** Both agents accept `history` array in request body.

```typescript
// ai.controller.ts line 37
history: body.history ?? []

// Messages built as:
[systemMessage, ...history, currentMessage]
```

**Frontend:** Persisted in `localStorage` under key `'gf-ai-conversations'`.

```typescript
// ai-chat-sidebar.component.ts
localStorage.setItem('gf-ai-conversations', JSON.stringify(toSave));
```

**Design:** Stateless — client sends full history with each request. No server-side session storage. Safe for serverless/multi-instance deployments.

**Proof (code paths):**

- `apps/api/src/app/endpoints/ai/ai.service.ts` lines 197–207 — history injected into LLM messages
- `apps/api/src/app/import-auditor/import-auditor.service.ts` — history array accepted in chat method
- `apps/client/src/app/components/ai-chat-sidebar/ai-chat-sidebar.component.ts` — localStorage persistence

---

## 6. Basic Error Handling (Graceful Failure, Not Crashes)

### 5-Layer Guardrail Stack (Import Auditor)

| Layer                | Limit                   | What Happens            |
| -------------------- | ----------------------- | ----------------------- |
| Payload Limiter      | 5 MB / 10K rows         | Rejects before LLM call |
| Timeout              | 45s via AbortController | Cancels cleanly         |
| Circuit Breaker      | 3x same tool+args       | Aborts with explanation |
| Cost Limiter         | $1.00/query             | Stops token consumption |
| Tool Failure Tracker | 2 failures/tool         | Stops retrying          |

### AI Chat Sidebar Error Handling

- Missing API key → clear error message (not a crash)
- Portfolio fetch fails → continues without context, confidence drops to 0.6
- LLM call fails → error logged to telemetry, re-thrown with message
- Frontend shows retry button on error

**Test proof (guardrail tests):**

```
✓ E038: Circuit breaker trips on 3 identical parseCSV calls
✓ E039: Circuit breaker does NOT trip on varied tool calls
✓ E040: Cost limiter blocks at $1 threshold
✓ E041: Cost limiter warns at 80% of limit
✓ E008: Empty CSV content → status='error', not a crash
✓ E010: All null fields → status='fail' with 7 MISSING_REQUIRED_FIELD errors
```

---

## 7. Domain-Specific Verification Checks

### Financial Validation Rules (validateTransactions tool)

| Rule                     | What It Checks                                  |
| ------------------------ | ----------------------------------------------- |
| ISO 4217 currencies      | USD, EUR, GBP valid; "XYZ", "US" rejected       |
| Activity types           | BUY/SELL/DIVIDEND/FEE/INTEREST/LIABILITY only   |
| Date ranges              | Must be valid ISO 8601, ≥1970, not future       |
| Numeric invariants       | fee ≥ 0, quantity ≥ 0                           |
| Batch duplicates         | Flags identical transactions                    |
| High-value detection     | ≥$100K triggers human review                    |
| Price/quantity coherence | BUY with 0 quantity or SELL with 0 price warned |

**Test proof (domain validation):**

```
✓ E013: Activity with pre-1970 date → INVALID_DATE error
✓ E015: Activity with 2-char currency 'US' → INVALID_CURRENCY error
✓ E050: TRANSFER type → INVALID_TYPE error
✓ E051: GBP currency → valid (1 valid activity)
✓ E053: XYZ currency → invalid (fail status)
✓ E033: $250K import → requiresHumanReview=true, high-value-detection rule triggered
✓ E035: Hallucination flag → shouldEscalateToHuman returns true
```

---

## 8. Evaluation: 55 Test Cases with Expected Outcomes

### Test Run Output (2025-02-25)

```
Test Suites: 13 passed, 13 total
Tests:       199 passed, 199 total
Time:        7.67s
```

### Evaluation Test Cases (E001–E055): 55/55 PASS

#### Happy Path (7 cases)

```
✓ E001: Full pipeline — Ghostfolio CSV parse + map + validate        (8 ms)
✓ E002: Full pipeline — IBKR CSV detect + parse + map                (1 ms)
✓ E003: Validate multiple valid activities                            (1 ms)
✓ E004: Preview generation for clean import                           (4 ms)
✓ E005: Semicolon-delimited CSV parse                                 (1 ms)
✓ E006: DIVIDEND activity type validation                             (1 ms)
✓ E007: FEE activity type validation                                  (0 ms)
```

#### Edge Cases (11 cases)

```
✓ E008: Empty CSV content                                            (7 ms)
✓ E009: CSV with only headers, no data                               (0 ms)
✓ E010: All null fields in activity                                   (1 ms)
✓ E011: Unrecognized broker headers                                   (1 ms)
✓ E012: Map fields with no matching headers                           (0 ms)
✓ E013: Activity with pre-1970 date                                   (1 ms)
✓ E014: Activity with invalid date string                             (1 ms)
✓ E015: Activity with 2-char currency code                            (1 ms)
✓ E016: Tab-delimited CSV                                            (1 ms)
✓ E017: CSV with special characters in fields                         (1 ms)
✓ E018: Preview with mixed activity types and currencies              (1 ms)
```

#### Adversarial (7 cases)

```
✓ E019: Prompt injection in CSV content                               (1 ms)
✓ E020: SQL injection in CSV fields                                   (0 ms)
✓ E021: XSS in CSV note field                                        (0 ms)
✓ E022: Extremely long CSV content (1000 rows)                        (7 ms)
✓ E023: Activity with extremely high unit price                       (0 ms)
✓ E024: Activity with zero everything (except required fields)        (1 ms)
✓ E025: Unicode symbols in CSV                                       (0 ms)
```

#### Multi-Step (4 cases)

```
✓ E026: Detect → Parse → Map → Validate → Normalize → Preview        (1 ms)
✓ E027: Pipeline with partial mapping failure                         (1 ms)
✓ E028: Pipeline with validation failures → blocked commit            (0 ms)
✓ E029: Pipeline with batch duplicates → warnings                     (1 ms)
```

#### Verification (8 cases)

```
✓ E030: Confidence scoring reflects error ratio                       (1 ms)
✓ E031: Low-confidence broker detection triggers human review          (0 ms)
✓ E032: Domain constraint — error-free commit gate                    (1 ms)
✓ E033: Domain constraint — high-value detection                     (12 ms)
✓ E034: Merged verification aggregates all sources                    (1 ms)
✓ E035: Escalation for hallucination flags                            (0 ms)
✓ E036: No escalation for confident, low-stakes result                (1 ms)
✓ E037: All verification sources tracked per tool                     (1 ms)
```

#### Guardrails (8 cases)

```
✓ E038: Circuit breaker trips on 3 identical parseCSV calls           (1 ms)
✓ E039: Circuit breaker does NOT trip on varied tool calls            (1 ms)
✓ E040: Cost limiter blocks at $1 threshold                           (0 ms)
✓ E041: Cost limiter warns at 80% of limit                            (0 ms)
✓ E042: Cost estimation is reasonable for GPT-4o                      (0 ms)
✓ E043: Metrics track guardrail trigger reason                        (0 ms)
✓ E044: Metrics finalization captures duration                        (1 ms)
✓ E045: Metrics log structure is complete                             (0 ms)
```

#### Additional (10 cases)

```
✓ E046: SELL activity with zero price warns                           (1 ms)
✓ E047: BUY with zero quantity warns                                  (0 ms)
✓ E048: INTEREST activity type is valid                               (0 ms)
✓ E049: LIABILITY activity type is valid                              (1 ms)
✓ E050: TRANSFER type is invalid                                      (0 ms)
✓ E051: GBP currency code is valid                                    (0 ms)
✓ E052: JPY currency code is valid                                    (1 ms)
✓ E053: XYZ currency code is invalid                                  (0 ms)
✓ E054: Pipe-delimited CSV                                           (0 ms)
✓ E055: Detect Swissquote format                                      (1 ms)
```

### Pass Rate: 55/55 = 100%

**Test file:** `apps/api/src/app/import-auditor/__tests__/evaluation-test-cases.spec.ts`
**Framework:** `apps/api/src/app/import-auditor/__tests__/evaluation-framework.ts`

---

## Deployment Proof

```
$ curl https://app.ghostclone.xyz/api/v1/import-auditor/health
{"status":"OK"}

$ curl https://app.ghostclone.xyz/api/v1/info
{
  "benchmarks": [],
  "globalPermissions": ["enableAuthGoogle","enableAuthToken","createUserAccount"],
  "baseCurrency": "USD",
  "currencies": ["USD","USX"]
}

$ curl -L https://app.ghostclone.xyz/ → HTTP 200
```

**Platform:** Railway (us-west2)
**Domain:** app.ghostclone.xyz

---

## Full API Test Suite (All 40 Suites)

Run command:

```
ACCESS_TOKEN_SALT=<salt> JWT_SECRET_KEY=<secret> npx jest --config apps/api/jest.config.ts --no-coverage --maxWorkers=1
```

### Results: 38 passed, 2 skipped, 0 failed

```
PASS api apps/api/src/helper/object.helper.spec.ts
PASS api apps/api/src/app/portfolio/current-rate.service.spec.ts
PASS api apps/api/src/services/data-provider/data-enhancer/yahoo-finance/yahoo-finance.service.spec.ts
PASS api apps/api/src/guards/has-permission.guard.spec.ts
PASS api apps/api/src/services/benchmark/benchmark.service.spec.ts
PASS api apps/api/src/app/import-auditor/__tests__/evaluation-test-cases.spec.ts
PASS api apps/api/src/app/import-auditor/__tests__/output-validation-and-gates.spec.ts
PASS api apps/api/src/app/import-auditor/__tests__/production-hardening.spec.ts
PASS api apps/api/src/app/import-auditor/__tests__/validate-transactions.tool.spec.ts
PASS api apps/api/src/app/import-auditor/__tests__/generate-import-preview.tool.spec.ts
PASS api apps/api/src/app/import-auditor/__tests__/activity-import-dto.spec.ts
PASS api apps/api/src/app/import-auditor/__tests__/map-broker-fields.tool.spec.ts
PASS api apps/api/src/app/import-auditor/__tests__/detect-broker-format.tool.spec.ts
PASS api apps/api/src/app/import-auditor/__tests__/parse-csv.tool.spec.ts
PASS api apps/api/src/app/import-auditor/__tests__/verification.spec.ts
PASS api apps/api/src/app/import-auditor/__tests__/agent-metrics.spec.ts
PASS api apps/api/src/app/import-auditor/__tests__/circuit-breaker.spec.ts
PASS api apps/api/src/app/import-auditor/__tests__/cost-limiter.spec.ts
PASS api apps/api/src/app/portfolio/calculator/roai/portfolio-calculator-cash.spec.ts
PASS api apps/api/src/app/endpoints/ai/telemetry/__tests__/braintrust-telemetry.spec.ts
PASS api apps/api/src/app/portfolio/calculator/roai/portfolio-calculator-msft-buy-with-dividend.spec.ts
PASS api apps/api/src/app/portfolio/calculator/roai/portfolio-calculator-msft-buy-and-sell.spec.ts
PASS api apps/api/src/app/portfolio/calculator/roai/portfolio-calculator-btcusd-short.spec.ts
PASS api apps/api/src/app/portfolio/calculator/roai/portfolio-calculator-btcusd.spec.ts
PASS api apps/api/src/app/portfolio/calculator/roai/portfolio-calculator-fee.spec.ts
PASS api apps/api/src/app/portfolio/calculator/roai/portfolio-calculator-btceur.spec.ts
PASS api apps/api/src/app/portfolio/calculator/roai/portfolio-calculator-novn-buy-and-sell.spec.ts
PASS api apps/api/src/app/portfolio/calculator/roai/portfolio-calculator-novn-buy-and-sell-partially.spec.ts
PASS api apps/api/src/app/portfolio/calculator/roai/portfolio-calculator-baln-buy-and-sell.spec.ts
PASS api apps/api/src/app/portfolio/calculator/roai/portfolio-calculator-baln-buy-and-sell-in-two-activities.spec.ts
PASS api apps/api/src/app/portfolio/calculator/roai/portfolio-calculator-valuable.spec.ts
PASS api apps/api/src/app/portfolio/calculator/roai/portfolio-calculator-baln-buy.spec.ts
PASS api apps/api/src/app/portfolio/calculator/roai/portfolio-calculator-googl-buy.spec.ts
PASS api apps/api/src/app/portfolio/calculator/roai/portfolio-calculator-liability.spec.ts
PASS api apps/api/src/app/portfolio/calculator/roai/portfolio-calculator-baln-buy-and-buy.spec.ts
PASS api apps/api/src/app/portfolio/calculator/roai/portfolio-calculator-no-orders.spec.ts
PASS api apps/api/src/app/portfolio/calculator/roai/portfolio-calculator-jnug-buy-and-sell-and-buy-and-sell.spec.ts
PASS api apps/api/src/app/portfolio/calculator/roai/portfolio-calculator-btceur-in-base-currency-eur.spec.ts

Test Suites: 2 skipped, 38 passed, 38 of 40 total
Tests:       2 skipped, 267 passed, 269 total
```

### Breakdown by Component

| Component                             | Suites | Tests   | Status       |
| ------------------------------------- | ------ | ------- | ------------ |
| Import Auditor (agent + tools)        | 13     | 199     | ALL PASS     |
| ROAI Portfolio Calculator             | 19     | 21      | ALL PASS     |
| AI Chat Telemetry (Braintrust)        | 1      | 38      | ALL PASS     |
| Core services (guards, helpers, etc.) | 5      | 9       | ALL PASS     |
| **Total**                             | **38** | **267** | **ALL PASS** |

### Note on Environment

ROAI calculator tests require `ACCESS_TOKEN_SALT` and `JWT_SECRET_KEY` env vars.
Without them, `ConfigurationService` calls `process.exit(1)` and Jest reports
"worker encountered child process exceptions" — this is an env config issue, not a code bug.
