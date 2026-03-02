<div align="center">

[<img src="https://avatars.githubusercontent.com/u/82473144?s=200" width="100" alt="Ghostfolio logo">](https://ghostfol.io)

# Ghostfolio

**Open Source Wealth Management Software — Enhanced with AI**

[![Shield: License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-orange.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Shield: Contributions Welcome](https://img.shields.io/badge/Contributions-Welcome-limegreen.svg)](#contributing)

</div>

**Ghostfolio** is an open source wealth management application built with web technology. This enhanced fork adds two production-grade AI agents — a conversational portfolio assistant and an intelligent CSV import auditor — on top of the core portfolio tracking platform.

<div align="center">

[<img src="./apps/client/src/assets/images/video-preview.jpg" width="600" alt="Preview image of the Ghostfolio video trailer">](https://www.youtube.com/watch?v=yY6ObSQVJZk)

</div>

---

## What's New in This Fork

### AI Chat Assistant

A conversational sidebar powered by a ReAct agent loop with **10 specialized financial tools**:

| Tool                  | Purpose                                             |
| --------------------- | --------------------------------------------------- |
| `getPortfolioSummary` | Portfolio overview, net worth, total gain/loss      |
| `listActivities`      | Transaction history with filters                    |
| `getAllocations`      | Asset allocation breakdown by class, sector, region |
| `getPerformance`      | Return metrics across time ranges                   |
| `getQuote`            | Real-time price lookups (up to 25 symbols)          |
| `getHistory`          | Historical price data and charts                    |
| `getFundamentals`     | P/E ratio, market cap, dividend yield               |
| `getNews`             | Market news and headlines                           |
| `computeRebalance`    | Target allocation rebalancing suggestions           |
| `scenarioImpact`      | What-if analysis for hypothetical portfolio changes |

**Key capabilities:**

- Natural language queries against your actual portfolio data
- Multi-step reasoning (ask about performance, then drill into news for top holdings)
- Model-agnostic via OpenRouter (Claude, GPT-4o, Gemini — switch with one config change)
- File attachments (images and CSV) with thumbnail previews
- Thumbs up/down feedback on responses
- Conversation history persisted in localStorage
- Markdown rendering with tables, code blocks, and lists

### Production Guardrails

Every AI query is protected by four layers:

| Guardrail       | Limit              | Purpose                        |
| --------------- | ------------------ | ------------------------------ |
| Cost limiter    | $1.00/query        | Prevents bill explosions       |
| Circuit breaker | 3 repeated actions | Stops infinite tool-call loops |
| Max iterations  | 10 steps           | Bounds compute per request     |
| Timeout         | 45 seconds         | Prevents hung requests         |

### Verification Layer

Five verification types ensure response accuracy in the financial domain:

1. **Confidence scoring** — 0–1 scale on every tool result
2. **Hallucination detection** — Post-response groundedness check
3. **Domain constraints** — Valid tickers, real portfolio data only
4. **Fact checking** — Cross-reference between tool outputs
5. **Human-in-the-loop** — Escalation for high-risk financial advice

### Import Auditor

An AI-powered CSV import agent with 6 tools:

- Auto-detects broker format from uploaded CSV files
- Maps fields to Ghostfolio's activity schema with LLM assistance
- Validates transactions and flags duplicates before import
- Generates a preview before committing changes

### Observability

Full telemetry via **Braintrust** on every query:

- Input/output token counts and estimated USD cost
- Per-tool timing, status, and verification results
- Confidence and safety scores
- Latency tracking

### Evaluation Framework

**138 deterministic test cases** across three suites:

- 56 golden set cases (tool selection, content validation, negative checks)
- 31 labeled scenarios (single-tool, multi-tool, edge case, adversarial, safety)
- 55 import auditor test cases

---

## Core Features

- Create, update, and delete transactions
- Multi-account management
- Portfolio performance: ROAI for Today, WTD, MTD, YTD, 1Y, 5Y, Max
- Charts and visualizations
- Static analysis to identify portfolio risks
- Import and export transactions
- Dark mode and zen mode
- Progressive Web App (PWA) with mobile-first design

---

## Tech Stack

| Layer     | Technology                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Frontend  | [Angular](https://angular.dev), [Angular Material](https://material.angular.io), [Bootstrap](https://getbootstrap.com), SCSS       |
| Backend   | [NestJS](https://nestjs.com), [Prisma](https://www.prisma.io), [PostgreSQL](https://www.postgresql.org), [Redis](https://redis.io) |
| AI/LLM    | [OpenRouter](https://openrouter.ai) via [Vercel AI SDK](https://sdk.vercel.ai), Zod tool schemas                                   |
| Monorepo  | [Nx](https://nx.dev) workspace                                                                                                     |
| Auth      | Passport.js (Google OAuth, OIDC, JWT, API keys, WebAuthn)                                                                          |
| Telemetry | [Braintrust](https://braintrust.dev)                                                                                               |
| Hosting   | [Railway](https://railway.app)                                                                                                     |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) (v20+)
- [Docker](https://www.docker.com/products/docker-desktop) (for PostgreSQL and Redis)
- An [OpenRouter](https://openrouter.ai) API key (for AI features)

### Quick Start with Docker Compose

```bash
# Clone the repository
git clone https://github.com/StefanoCaruso456/Ghostfolio.git
cd Ghostfolio

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your database credentials and API keys

# Start the application
docker compose -f docker/docker-compose.yml up -d
```

Open [http://localhost:3333](http://localhost:3333) and create your first account via **Get Started**.

### Enable AI Features

Set these values in your environment or database properties:

| Variable             | Description                                |
| -------------------- | ------------------------------------------ |
| `OPENROUTER_API_KEY` | Your OpenRouter API key                    |
| `OPENROUTER_MODEL`   | Model ID, e.g. `anthropic/claude-sonnet-4` |

The AI chat sidebar becomes available in the application header once configured.

---

## Environment Variables

| Name                     | Type                | Default   | Description                                  |
| ------------------------ | ------------------- | --------- | -------------------------------------------- |
| `ACCESS_TOKEN_SALT`      | `string`            |           | Random string used as salt for access tokens |
| `DATABASE_URL`           | `string`            |           | PostgreSQL connection URL                    |
| `JWT_SECRET_KEY`         | `string`            |           | Random string for JSON Web Tokens            |
| `POSTGRES_DB`            | `string`            |           | PostgreSQL database name                     |
| `POSTGRES_PASSWORD`      | `string`            |           | PostgreSQL password                          |
| `POSTGRES_USER`          | `string`            |           | PostgreSQL user                              |
| `REDIS_HOST`             | `string`            |           | Redis host                                   |
| `REDIS_PORT`             | `number`            |           | Redis port                                   |
| `REDIS_PASSWORD`         | `string`            |           | Redis password                               |
| `HOST`                   | `string` (optional) | `0.0.0.0` | Application host                             |
| `PORT`                   | `number` (optional) | `3333`    | Application port                             |
| `API_KEY_COINGECKO_DEMO` | `string` (optional) |           | CoinGecko Demo API key                       |
| `API_KEY_COINGECKO_PRO`  | `string` (optional) |           | CoinGecko Pro API key                        |

See [DEVELOPMENT.md](./DEVELOPMENT.md) for the full list including OIDC configuration.

---

## Project Structure

```
apps/
  api/                          # NestJS backend
    src/app/endpoints/ai/       # AI chat agent (service, controller, tools)
      evals/                    # Golden set + labeled scenario test suites
      telemetry/                # Braintrust observability
      tools/                    # Tool builders + Zod schemas
    src/app/import-auditor/     # Import auditor agent
      guardrails/               # Circuit breaker, cost limiter, failure tracker
  client/                       # Angular frontend
    src/app/components/
      ai-chat-sidebar/          # AI chat sidebar component
artifacts-documentation/        # Architecture docs, cost analysis, eval evidence
```

---

## Public API

### Authorization

```
Authorization: Bearer <token>
```

Obtain a token via:

```
POST /api/v1/auth/anonymous
Body: { "accessToken": "<SECURITY_TOKEN>" }
```

### Key Endpoints

| Method | Path                      | Description                     |
| ------ | ------------------------- | ------------------------------- |
| `GET`  | `/api/v1/health`          | Health check (no auth required) |
| `POST` | `/api/v1/import`          | Import activities               |
| `POST` | `/api/v1/ai/chat`         | AI chat (JWT required)          |
| `GET`  | `/api/v1/ai/prompt/:mode` | Get suggested prompts           |

---

## Development

```bash
# Install dependencies
npm install

# Start development servers
npx nx serve api
npx nx serve client

# Run tests
npx nx test api
npx nx test client

# Lint
npx nx lint api
npx nx lint client

# Format
npx nx format:write
```

See [DEVELOPMENT.md](./DEVELOPMENT.md) for detailed setup instructions.

---

## Contributing

Contributions are welcome. Please open an issue first to discuss proposed changes.

---

## License

Licensed under the [AGPLv3 License](https://www.gnu.org/licenses/agpl-3.0.html).

Based on [Ghostfolio](https://ghostfol.io) by the Ghostfolio team.
