# Ghostfolio AI Dashboard — System Architecture

## Overview

This system extends Ghostfolio with AI-powered dashboard configuration using an MCP (Method Call Protocol) server. The architecture separates:

- **Product application** (Ghostfolio)
- **AI execution layer** (MCP server)
- **Shared MCP platform abstractions**
- **AI skill/tool implementations**

The integration is secure, versioned, and environment-driven.

---

## Repositories

| Repo | Purpose | Runtime |
|------|---------|---------|
| `Ghostfolio` | Main product (NestJS API + Angular UI) | Railway |
| `ghostfolio-mcp-server` | RPC execution service | Railway |
| `MCP` | Shared protocol + dispatch conventions | Library |
| `AI_AGENT_SKILLS` | Tool/skill implementations | Library |

---

## High-Level Architecture

```
                    ┌──────────────────────────┐
                    │        End User          │
                    │  (Browser / Frontend)    │
                    └────────────┬─────────────┘
                                 │
                                 │ HTTPS (JWT)
                                 ▼
                 ┌────────────────────────────────┐
                 │          Ghostfolio            │
                 │  NestJS API + Angular Client   │
                 │                                │
                 │  POST /api/v1/ai/dashboard     │
                 └────────────┬───────────────────┘
                              │
                              │ HTTP (RPC)
                              │ x-mcp-api-key
                              ▼
             ┌────────────────────────────────────┐
             │       ghostfolio-mcp-server        │
             │                                    │
             │  POST /rpc                         │
             │  methods[methodName] dispatcher    │
             └────────────┬───────────────────────┘
                          │
                          ▼
           ┌──────────────────────────────┐
           │      AI_AGENT_SKILLS         │
           │  recommendDashboard          │
           │  buildSql                    │
           │  buildDashboardConfig        │
           │  getDashboardConfig          │
           └──────────────────────────────┘
```

---

## Deployment Topology

### Production Environment (Railway)

```
Railway Project
│
├── Ghostfolio Service
│   ├── NestJS API (apps/api)
│   └── Angular Static Client (apps/client)
│
└── ghostfolio-mcp-server Service
    └── Express RPC Server
```

Each service runs independently with its own environment variables.

---

## Environment Variables

### Ghostfolio Service

```
MCP_SERVER_URL=https://ghostfolio-mcp-server-<env>.up.railway.app
MCP_API_KEY=<shared-secret>
BUILD_SHA=<commit-sha>
NODE_ENV=production
```

### MCP Server Service

```
MCP_API_KEY=<same-shared-secret>
NODE_ENV=production
```

**Security boundary:**
- MCP server only accepts requests with valid `x-mcp-api-key`
- Ghostfolio endpoint requires JWT authentication

---

## API Contracts

### 1. Ghostfolio -> MCP RPC Contract

**Endpoint:**

```
POST {MCP_SERVER_URL}/rpc
```

**Headers:**

```
x-mcp-api-key: <shared-secret>
Content-Type: application/json
```

**Request Body:**

```json
{
  "id": "optional",
  "method": "string",
  "params": { }
}
```

**Success Response:**

```json
{
  "id": "optional",
  "result": { ... }
}
```

**Error Response:**

```json
{
  "id": "optional",
  "error": {
    "code": "METHOD_NOT_FOUND | INVALID_PARAMS | INTERNAL_ERROR",
    "message": "..."
  }
}
```

### 2. Public API Endpoint — Ghostfolio

```
POST /api/v1/ai/dashboard
```

**Auth:**

```
Authorization: Bearer <JWT>
```

**Returns:**

- `200` / `201` on success
- `401` if JWT invalid
- `403` if permission denied
- `502` if MCP upstream fails

---

## End-to-End Sequence Diagram

```
User Browser
     │
     │ 1. POST /api/v1/ai/dashboard (JWT)
     ▼
Ghostfolio API (NestJS)
     │
     │ 2. Validate JWT (AuthGuard)
     │ 3. Check permissions
     │
     │ 4. Call MCP client:
     │    rpc("getDashboardConfig", { userId })
     ▼
MCP Server (/rpc)
     │
     │ 5. Validate x-mcp-api-key
     │ 6. Lookup method in dispatcher
     │
     │ 7. Execute handler:
     │    getDashboardConfig(params)
     ▼
Skill Implementation
     │
     │ 8. Return dashboard config object
     ▼
MCP Server
     │
     │ 9. Wrap result in JSON-RPC envelope
     │    { id, result }
     ▼
Ghostfolio MCP Client
     │
     │ 10. Parse JSON
     │ 11. Unwrap parsed.result
     │
     ▼
Ghostfolio Controller
     │
     │ 12. Return dashboard config
     ▼
User Browser
```

---

## Error Flow

| Scenario | Response | Handling |
|----------|----------|----------|
| JWT Failure | `401 Unauthorized` | Handled before MCP call |
| Permission Failure | `403 Forbidden` | Handled before MCP call |
| MCP Method Missing | MCP returns `404 METHOD_NOT_FOUND` | Ghostfolio maps to `502 Bad Gateway` |
| MCP Network Failure | Timeout / connection error | Ghostfolio returns `502` |

---

## Observability

### Version Endpoint

```
GET /api/version
```

**Returns:**

```json
{
  "buildSha": "...",
  "environment": "production"
}
```

Used to confirm deployed commit.

### Direct MCP Health Check

```
POST /rpc
method: getDashboardConfig
```

Used to validate:
- Deployment correctness
- Method availability
- API key alignment

---

## Security Model

| Layer | Protection |
|-------|------------|
| Client -> Ghostfolio | JWT Authentication |
| Ghostfolio -> MCP | Shared Secret (`x-mcp-api-key`) |
| Environment | Secrets stored in Railway |

No direct public access to skill layer.

---

## Current State

- [x] MCP server deployed and method registered
- [x] Ghostfolio unwraps JSON-RPC result
- [x] Dashboard endpoint returns valid response
- [x] End-to-end integration verified in production

---

## Future Improvements

- Add structured tracing IDs across services
- Centralized logging (OpenTelemetry)
- Add `/rpc/health` endpoint
- Standardize `200` vs `201` response codes
- Formal OpenAPI spec for RPC schema
