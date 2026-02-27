# MCP Ghostfolio AI Dashboard

## Architecture & Data Flow (4 Repos)

### Overview

This system adds AI-driven dashboard configuration to Ghostfolio via an MCP (Method Call Protocol) server. The Ghostfolio API exposes an authenticated endpoint (`POST /api/v1/ai/dashboard`) which delegates to the MCP server (`POST /rpc`) using a shared API key. The MCP server dispatches requests by method name to registered handlers (skills/tools). The response is returned to Ghostfolio and ultimately to the client.

### Repositories

1. **Ghostfolio (main app)** — `StefanoCaruso456/Ghostfolio`
2. **MCP Server (runtime)** — `StefanoCaruso456/ghostfolio-mcp-server`
3. **MCP Platform (shared framework)** — `StefanoCaruso456/MCP`
4. **AI Agent Skills (tooling library)** — `StefanoCaruso456/AI_AGENT_SKILLS`

---

## Repo 1 — Ghostfolio (Main Application)

**Repo:** `StefanoCaruso456/Ghostfolio`
**Purpose:** User-facing product (Angular) + backend API (NestJS). Hosts the AI endpoint that calls MCP.

### Components

- **NestJS API:** `apps/api`
  - Serves API routes under: `/api/v1/*`
  - Hosts AI endpoints, auth, permissions
- **Angular Client:** `apps/client`
  - Built and served via the NestJS deployment (static assets)

### Key Endpoints

- **`POST /api/v1/ai/dashboard`**
  - Auth: JWT (`AuthGuard('jwt')`)
  - Authorization: permission guard (e.g., `HasPermissionGuard`)
  - Calls AI service -> MCP client -> MCP server
- **`GET /api/version`** (public)
  - Returns build metadata (e.g., `buildSha`, `environment`)
  - Used to confirm production is running the intended commit

### MCP Integration (within Ghostfolio)

- **MCP client service:** `apps/api/src/app/endpoints/ai/mcp/mcp-client.service.ts`
  - Calls MCP server: `POST {MCP_SERVER_URL}/rpc`
  - Adds header: `x-mcp-api-key: {MCP_API_KEY}`
  - Sends JSON body: `{ method: string, params: object }`
  - Handles non-2xx responses and parses MCP responses
  - **Important:** Unwraps JSON-RPC envelope when MCP returns `{ id, result: ... }`

---

## Repo 2 — ghostfolio-mcp-server (Runtime MCP Service)

**Repo:** `StefanoCaruso456/ghostfolio-mcp-server`
**Purpose:** Deployed service that receives RPC calls and executes registered methods (skills/tools).

### Runtime Contract

- **Endpoint:** `POST /rpc`
- **Headers:** `x-mcp-api-key` (required; shared secret)
- **Body:**

```json
{ "id": "optional", "method": "string", "params": { } }
```

### Dispatch Model

- A map-based dispatcher: `methods[methodName]`
- On success:

```json
{ "id": "...", "result": "<handler output>" }
```

- On failure:

```json
{ "id": "...", "error": { "code": "...", "message": "..." } }
```

### Supported Methods (example)

- `recommendDashboard`
- `buildSql`
- `buildDashboardConfig`
- `getDashboardConfig` (added to align with Ghostfolio integration)

---

## Repo 3 — MCP (Platform / Shared Framework)

**Repo:** `StefanoCaruso456/MCP`
**Purpose:** Shared MCP conventions and reusable infrastructure patterns (method dispatch patterns, contracts, helpers).

### How it fits:

- Provides "platform" primitives used by MCP servers and/or skill packs
- May be imported by `ghostfolio-mcp-server` depending on implementation
- Defines consistent patterns for method naming, request/response shape, validation conventions, and tool registration

(If the server is currently using a simple in-repo method map, this repo is still useful as the system grows to multiple MCP servers or shared middleware.)

---

## Repo 4 — AI_AGENT_SKILLS (Skills / Tools Library)

**Repo:** `StefanoCaruso456/AI_AGENT_SKILLS`
**Purpose:** A library of callable skills/tools designed to be invoked by an MCP server.

### How it fits:

- May export functions like `recommendDashboard`, `buildSql`, `buildDashboardConfig`
- MCP server can:
  - Import skills directly (compile-time dependency), or
  - Load skills dynamically (plugin-style), depending on the architecture

(If skills are duplicated across repos today, this repo becomes the canonical "skills source of truth" as you consolidate.)

---

## Deployment Topology

### Production Hosting (current)

- **Ghostfolio:** deployed on Railway
  - Single unified deployment serving:
    - NestJS API (`apps/api`)
    - Angular static files (`apps/client`)
- **ghostfolio-mcp-server:** deployed on Railway
  - Dedicated service exposing `/rpc`

### Environment Variables

**On Ghostfolio service:**

- `MCP_SERVER_URL=https://ghostfolio-mcp-server-...up.railway.app`
- `MCP_API_KEY=<shared secret>`
- `BUILD_SHA=<commit sha>`
- (plus standard Ghostfolio env vars)

**On MCP server service:**

- `MCP_API_KEY=<same shared secret>`
- (plus service-specific runtime vars)

---

## End-to-End Data Flow

### 1) Client -> Ghostfolio API

1. User authenticates and receives a JWT.
2. Client calls:
   - `POST /api/v1/ai/dashboard`
   - Includes `Authorization: Bearer <JWT>`

### 2) Ghostfolio API (Auth + Permission)

1. NestJS validates JWT (`AuthGuard('jwt')`).
2. Permission guard checks required permission for AI endpoint.

### 3) Ghostfolio API -> MCP Server (RPC)

1. AI service calls MCP client:
   - `mcpClientService.rpc("getDashboardConfig", { userId })`
2. MCP client sends HTTP request:
   - `POST {MCP_SERVER_URL}/rpc`
   - Header: `x-mcp-api-key: {MCP_API_KEY}`
   - Body: `{ "method": "getDashboardConfig", "params": { "userId": "..." } }`

### 4) MCP Server Dispatch -> Skill Execution

1. MCP server validates request and API key.
2. Dispatch looks up handler:
   - `methods["getDashboardConfig"]`
3. Handler returns dashboard configuration JSON.

### 5) MCP Server -> Ghostfolio API -> Client

1. MCP server responds:
   - `{ "id": null, "result": { ...dashboardConfig } }`
2. Ghostfolio MCP client parses JSON and unwraps result as needed.
3. Ghostfolio returns the dashboard config (or envelope, depending on controller/service choice).
4. Client renders dashboard UI.

---

## Observability & Diagnostics

### Build / Deployment Verification

- `GET /api/version` confirms environment and deployed SHA.

### MCP Health Verification

- Direct RPC test:
  - `POST https://ghostfolio-mcp-server.../rpc`
  - method: `"getDashboardConfig"`
  - Confirms method exists and the server is on the intended build.

### Error Handling (recommended standard)

- If MCP returns non-2xx, Ghostfolio should surface:
  - **502 Bad Gateway** for upstream failures
  - include upstream status/body in logs (never secrets)

---

## Key Integration Requirements

- **Method name alignment:** Ghostfolio RPC method string must exist in MCP server dispatcher.
- **Shared secret consistency:** `MCP_API_KEY` must match between services.
- **JSON-RPC envelope awareness:** Ghostfolio must handle `{ result: ... }` response shape.
- **Correct auth header:** `Authorization: Bearer <JWT>` required for Ghostfolio endpoint.

---

## Current Status

- MCP server method `getDashboardConfig` implemented and deployed ✅
- Ghostfolio MCP client updated to unwrap JSON-RPC result ✅
- `POST /api/v1/ai/dashboard` returns successful response in production ✅
