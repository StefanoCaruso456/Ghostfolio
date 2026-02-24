# Project Rules

## UI/UX Design

- **Design Style**: All new UI features and components must use a **neomorphic (neumorphism)** design style
- Neomorphic characteristics: soft shadows, subtle depth, rounded corners, light/dark shadow pairs that create an embossed or debossed look
- Use CSS `box-shadow` with dual light/dark shadows rather than Material elevation
- Maintain compatibility with the existing light/dark theme toggle (`.theme-dark` class)

## Tech Stack

- **Frontend**: Angular with Angular Material (M2), Bootstrap grid, SCSS
- **Backend**: NestJS with Prisma ORM, PostgreSQL
- **Auth**: Passport.js (Google OAuth, OIDC, JWT, API Keys, WebAuthn)
- **Monorepo**: Nx workspace

## Existing Theme Reference

- Primary color: `#36cfcc` (teal/cyan)
- Secondary color: `#3686cf` (blue)
- Font: Inter (Roboto fallback)
- CSS variables defined in `apps/client/src/styles.scss`
- Theme config in `apps/client/src/styles/theme.scss`

## Deployment

- Hosted on **Railway** with PostgreSQL
- Environment variables managed via Railway's Variables tab
- Domain: `app.ghostclone.xyz`

## AI Chat Sidebar — AgentForge Requirements

The Perplexity-style AI chat sidebar must follow AgentForge production agent standards:

### Tool Design (5+ tools minimum)

- Each tool must be: **Atomic** (one purpose), **Idempotent** (safe to retry), **Well-documented**, **Error-handled**, **Verified**
- Anti-patterns to avoid: Too broad tools, missing error states, undocumented params, side effects, unverified outputs

### Production Guardrails (Non-negotiable)

- `MAX_ITERATIONS`: 10-15 (prevent infinite loops)
- `TIMEOUT`: 30-45s per query (user experience limit)
- `COST_LIMIT`: $1/query (prevent bill explosions)
- `CIRCUIT_BREAKER`: Same action 3x → abort

### Verification Layer (3+ types required)

1. **Fact Checking** — cross-reference authoritative sources
2. **Hallucination Detection** — flag unsupported claims, require source attribution
3. **Confidence Scoring** — 0-1 scale, surface low-confidence responses
4. **Domain Constraints** — enforce valid tickers, real portfolio data only
5. **Human-in-the-Loop** — escalation for high-risk financial advice

### Architecture Pattern

- Use **ReAct Loop**: Thought → Action → Observation → Repeat
- Finance domain qualifies for agentic pattern (unknown info needs, multi-system, complex analysis, dynamic decisions)
- Tool results must include: `status`, `data`, `verification: { passed, confidence, warnings, errors, sources }`

### Evaluation (50+ test cases)

- Measure: Correctness, Tool Selection, Tool Execution, Safety, Latency (<5s), Cost
- Pass rate target: >80% (good), >90% (excellent)
- Observability: Log every tool call, token count, cost per query
