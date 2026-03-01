# AI Chat — API Contracts

## POST /api/v1/ai/chat

The primary chat endpoint. Requires JWT authentication and `readAiPrompt` permission.

### Request

```typescript
POST /api/v1/ai/chat
Content-Type: application/json
Authorization: Bearer <jwt>

{
  "message": string,                 // User's chat message (required)
  "conversationId"?: string,         // UUID for conversation grouping (optional)
  "history"?: [                      // Previous messages (optional)
    { "content": string, "role": "user" | "assistant" }
  ],
  "attachments"?: [                  // File attachments (optional, max 3, max 5MB each)
    {
      "content": string,             // File content (text for CSV/PDF, base64 data URL for images)
      "fileName": string,            // Original filename
      "mimeType": string,            // text/csv, application/pdf, image/png, image/jpeg
      "size": number                 // File size in bytes
    }
  ]
}
```

**DTO:** `libs/common/src/lib/dtos/ai-chat.dto.ts` (`AiChatDto`)

### Response -- `AiChatResponse`

```typescript
{
  "conversationId": "abc-123-def",
  "message": {
    "content": "Your portfolio has 5 holdings...",
    "role": "assistant",
    "timestamp": "2026-02-25T16:00:00.000Z"
  }
}
```

### Error Responses

| Status | Cause                                                        |
| ------ | ------------------------------------------------------------ |
| 400    | Missing `message`                                            |
| 401    | Not authenticated                                            |
| 403    | Missing `readAiPrompt` permission                            |
| 500    | Internal error (LLM failure, timeout, guardrail abort, etc.) |

---

## GET /api/v1/ai/conversations

List all conversations for the authenticated user. Requires JWT + `readAiPrompt` permission.

### Response

```typescript
[
  {
    id: 'conv-uuid-1',
    title: 'What is the price of AAPL?',
    createdAt: '2026-02-25T10:00:00.000Z',
    updatedAt: '2026-02-25T10:05:00.000Z'
  }
];
```

---

## GET /api/v1/ai/conversations/:id

Get a single conversation with all messages. Requires JWT + `readAiPrompt` permission.

### Response

```typescript
{
  "id": "conv-uuid-1",
  "title": "What is the price of AAPL?",
  "createdAt": "2026-02-25T10:00:00.000Z",
  "updatedAt": "2026-02-25T10:05:00.000Z",
  "userId": "user-123",
  "messages": [
    {
      "id": "msg-uuid-1",
      "content": "What is the price of AAPL?",
      "role": "user",
      "conversationId": "conv-uuid-1",
      "createdAt": "2026-02-25T10:00:00.000Z"
    },
    {
      "id": "msg-uuid-2",
      "content": "The current price of AAPL is $185.50...",
      "role": "assistant",
      "conversationId": "conv-uuid-1",
      "createdAt": "2026-02-25T10:00:02.000Z"
    }
  ]
}
```

### Error Responses

| Status | Cause                                             |
| ------ | ------------------------------------------------- |
| 404    | Conversation not found or belongs to another user |

---

## PATCH /api/v1/ai/conversations/:id

Rename a conversation. Requires JWT + `readAiPrompt` permission.

### Request

```typescript
PATCH /api/v1/ai/conversations/:id
Content-Type: application/json

{
  "title": "My portfolio analysis"
}
```

**DTO:** `libs/common/src/lib/dtos/update-ai-conversation.dto.ts` (`UpdateAiConversationDto`)

---

## DELETE /api/v1/ai/conversations/:id

Delete a conversation and all its messages (cascade). Requires JWT + `readAiPrompt` permission. Returns `204 No Content`.

---

## GET /api/v1/ai/prompt/:mode (Legacy)

The legacy prompt endpoint. Returns a markdown string for clipboard copy.

### Request

```
GET /api/v1/ai/prompt/default?accounts=...&tags=...
Authorization: Bearer <jwt>
```

### Response

```typescript
{
  "prompt": "You are a neutral financial assistant..."
}
```

This endpoint has **no tools, no ReAct loop, no telemetry**. It exists for the "Copy to Duck.ai" feature.

---

## ToolResult Envelope (Internal)

Every tool `execute()` returns this shape (not exposed to frontend directly -- the LLM consumes it):

```typescript
{
  status: 'success' | 'error',
  data: { ... },                    // Tool-specific payload
  message: string,                  // Human-readable summary
  verification: {
    passed: boolean,
    confidence: number,             // 0.0 - 1.0
    errors?: string[],
    warnings?: string[],
    sources: string[],
    verificationType: 'confidence_scoring'
  },
  meta?: {
    schemaVersion: "1.0.0",
    source: "yahoo-finance2",       // Data source attribution
    cacheHit?: boolean,
    providerLatencyMs?: number
  }
}
```

---

## Attachment Handling (Internal)

When attachments are present, they are injected into the user message sent to the LLM:

- **CSV files:** Prepended as `[Attached CSV: {fileName}]\n{content}`
- **PDF files:** Prepended as `[Attached PDF: {fileName}]\n{content}`
- **Images:** Noted as `[Attached image: {fileName} -- image data provided but cannot be visually analyzed]`

All attachments are appended after an `--- Attachments ---` header in the user message.

---

## Database Models

### AiConversation

```sql
CREATE TABLE "AiConversation" (
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX ON "AiConversation"("userId");
CREATE INDEX ON "AiConversation"("updatedAt");
```

---

## Tax Intelligence Endpoints

All tax endpoints require JWT authentication + `accessAssistant` permission. Controller: `TaxController`.

### GET /api/tax/accounts

List all connected brokerage (SnapTrade) and bank (Plaid) accounts.

#### Response

```typescript
[
  {
    id: string,
    type: 'snaptrade' | 'plaid',
    brokerageName: string | null,
    institutionName: string | null,
    status: string,
    lastSyncedAt: string | null,
    accountCount: number
  }
]
```

### POST /api/tax/accounts/:id/sync

Trigger a sync for a specific connected account.

#### Request

```typescript
{
  "type": "snaptrade" | "plaid"
}
```

#### Response

```typescript
{
  syncedAt: string,
  holdingsCount: number,
  transactionsCount: number,
  status: 'success' | 'error',
  message?: string
}
```

### GET /api/tax/holdings

Cross-account holdings with cost basis and unrealized gain/loss.

#### Query Parameters

| Param       | Type   | Description               |
| ----------- | ------ | ------------------------- |
| `symbol`    | string | Filter to specific symbol |
| `accountId` | string | Filter to specific account |

#### Response

```typescript
[
  {
    symbol: string,
    name: string | null,
    quantity: number,
    marketPrice: number | null,
    marketValue: number | null,
    costBasis: number,
    unrealizedGainLoss: number | null,
    unrealizedGainLossPct: number | null,
    currency: string,
    accountName: string | null,
    dataSource: string
  }
]
```

### GET /api/tax/transactions

Tax-relevant transaction history.

#### Query Parameters

| Param       | Type   | Description          |
| ----------- | ------ | -------------------- |
| `symbol`    | string | Filter by symbol     |
| `startDate` | string | ISO date lower bound |
| `endDate`   | string | ISO date upper bound |
| `limit`     | string | Max results          |

#### Response

```typescript
{
  transactions: TaxTransaction[],
  totalCount: number
}
```

### GET /api/tax/lots

FIFO-derived tax lots.

#### Query Parameters

| Param    | Type   | Description                       |
| -------- | ------ | --------------------------------- |
| `symbol` | string | Filter by symbol                  |
| `status` | string | `OPEN`, `CLOSED`, or `ALL`        |

### POST /api/tax/simulate

Simulate selling shares and estimate tax impact.

#### Request

```typescript
{
  symbol: string,
  quantity: number,
  pricePerShare?: number,
  taxBracketPct?: number
}
```

#### Response

```typescript
{
  symbol: string,
  quantitySold: number,
  pricePerShare: number,
  totalProceeds: number,
  lotsConsumed: ConsumedLot[],
  summary: {
    totalCostBasis: number,
    totalProceeds: number,
    totalGainLoss: number,
    shortTermGain: number,
    longTermGain: number,
    estimatedFederalTax: number,
    effectiveTaxRate: number,
    shortTermTaxRate: number,
    longTermTaxRate: number,
    currency: string
  },
  assumptions: string[]
}
```

### POST /api/tax/adjustments

Create a cost basis adjustment.

#### Request

```typescript
{
  symbol: string,
  adjustmentType: 'COST_BASIS_OVERRIDE' | 'ADD_LOT' | 'REMOVE_LOT',
  data: Record<string, any>,
  note?: string,
  dataSource?: string
}
```

### PUT /api/tax/adjustments/:id

Update an existing adjustment.

### DELETE /api/tax/adjustments/:id

Delete an adjustment.

### GET /api/tax/adjustments

List adjustments, optionally filtered by `?symbol=`.

---

### AiConversationMessage

```sql
CREATE TABLE "AiConversationMessage" (
    "content" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL REFERENCES "AiConversation"("id") ON DELETE CASCADE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL
);
CREATE INDEX ON "AiConversationMessage"("conversationId");
CREATE INDEX ON "AiConversationMessage"("createdAt");
```
