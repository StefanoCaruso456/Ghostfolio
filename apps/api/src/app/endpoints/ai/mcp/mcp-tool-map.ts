/**
 * MCP Tool Map — single source of truth for canonical ↔ MCP name mapping.
 *
 * Keys:   Ghostfolio canonical tool names (camelCase, matching OUTPUT_SCHEMA_REGISTRY)
 * Values: MCP RPC method/tool names on the remote server
 *
 * Today both sides use identical names. If the MCP server ever renames
 * a tool, update the VALUE here — no other code changes needed.
 */

export type ToolDispatchMode = 'local' | 'mcp' | 'hybrid';

/**
 * Canonical tool name → MCP RPC method name.
 * Only tools listed here can be dispatched via MCP.
 */
export const MCP_TOOL_MAP: Record<string, string> = {
  getPortfolioSummary: 'getPortfolioSummary',
  listActivities: 'listActivities',
  getAllocations: 'getAllocations',
  getPerformance: 'getPerformance',
  getQuote: 'getQuote',
  getHistory: 'getHistory',
  getFundamentals: 'getFundamentals',
  getNews: 'getNews',
  computeRebalance: 'computeRebalance',
  scenarioImpact: 'scenarioImpact'
};

/**
 * Tools routed to MCP when TOOLS_DISPATCH_MODE=hybrid.
 * Start conservative — only getQuote for now.
 */
export const MCP_HYBRID_ALLOWLIST = new Set<string>(['getQuote']);

/**
 * Look up the MCP method name for a canonical tool name.
 * Returns undefined if the tool is not mapped.
 */
export function getMcpMethodName(
  canonicalToolName: string
): string | undefined {
  return MCP_TOOL_MAP[canonicalToolName];
}

/**
 * Check whether a tool should be dispatched via MCP in hybrid mode.
 */
export function isOnMcpAllowlist(canonicalToolName: string): boolean {
  return MCP_HYBRID_ALLOWLIST.has(canonicalToolName);
}
