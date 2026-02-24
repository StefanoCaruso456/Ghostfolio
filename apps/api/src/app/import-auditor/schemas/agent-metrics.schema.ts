import { z } from 'zod';

/**
 * AgentMetrics — Production observability for every agent run.
 *
 * Tracks task_id, timing, iterations, tokens, cost, tool calls,
 * success/failure, and thought/action/observation logs.
 */
export const ToolCallLogSchema = z.object({
  tool: z.string(),
  args: z.record(z.unknown()).optional(),
  status: z.enum(['success', 'error']),
  durationMs: z.number(),
  tokensUsed: z.number().optional()
});

export type ToolCallLog = z.infer<typeof ToolCallLogSchema>;

export const AgentMetricsSchema = z.object({
  taskId: z.string(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime().optional(),
  durationMs: z.number().default(0),
  iterations: z.number().default(0),
  totalTokens: z.number().default(0),
  promptTokens: z.number().default(0),
  completionTokens: z.number().default(0),
  totalCostUsd: z.number().default(0),
  toolsCalled: z.array(z.string()).default([]),
  toolCallLog: z.array(ToolCallLogSchema).default([]),
  success: z.boolean().default(false),
  error: z.string().optional(),
  guardrailTriggered: z
    .enum(['max_iterations', 'timeout', 'cost_limit', 'circuit_breaker'])
    .optional(),
  thoughtLog: z.array(z.string()).default([]),
  actionLog: z.array(z.string()).default([]),
  observationLog: z.array(z.string()).default([])
});

export type AgentMetrics = z.infer<typeof AgentMetricsSchema>;

/**
 * Model pricing map (USD per 1K tokens).
 * Used to estimate cost from token counts.
 */
export const MODEL_PRICING: Record<
  string,
  { promptPer1k: number; completionPer1k: number }
> = {
  // OpenRouter-routed models (approximate pricing)
  'anthropic/claude-sonnet-4': { promptPer1k: 0.003, completionPer1k: 0.015 },
  'anthropic/claude-haiku-4': {
    promptPer1k: 0.00025,
    completionPer1k: 0.00125
  },
  'openai/gpt-4o': { promptPer1k: 0.0025, completionPer1k: 0.01 },
  'openai/gpt-4o-mini': { promptPer1k: 0.00015, completionPer1k: 0.0006 },
  'google/gemini-2.0-flash': { promptPer1k: 0.0001, completionPer1k: 0.0004 },
  // Default fallback
  default: { promptPer1k: 0.003, completionPer1k: 0.015 }
};

export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['default'];

  return (
    (promptTokens / 1000) * pricing.promptPer1k +
    (completionTokens / 1000) * pricing.completionPer1k
  );
}

export function createAgentMetrics(taskId: string): AgentMetrics {
  return {
    taskId,
    startTime: new Date().toISOString(),
    endTime: undefined,
    durationMs: 0,
    iterations: 0,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalCostUsd: 0,
    toolsCalled: [],
    toolCallLog: [],
    success: false,
    error: undefined,
    guardrailTriggered: undefined,
    thoughtLog: [],
    actionLog: [],
    observationLog: []
  };
}

export function finalizeMetrics(metrics: AgentMetrics): AgentMetrics {
  const endTime = new Date().toISOString();
  const durationMs =
    new Date(endTime).getTime() - new Date(metrics.startTime).getTime();

  return {
    ...metrics,
    endTime,
    durationMs
  };
}
