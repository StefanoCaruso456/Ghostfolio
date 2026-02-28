import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';

import { Injectable, Logger } from '@nestjs/common';

/**
 * MCP Client Service
 *
 * Lightweight HTTP client for communicating with the ghostfolio-mcp-server
 * via JSON-RPC style requests. Handles authentication, timeouts, and
 * error handling for all MCP server interactions.
 */
@Injectable()
export class McpClientService {
  private readonly logger = new Logger(McpClientService.name);
  private readonly mcpServerUrl: string;
  private readonly mcpApiKey: string;

  /** Request timeout in milliseconds (30s) */
  private static readonly TIMEOUT_MS = 30_000;

  public constructor(
    private readonly configurationService: ConfigurationService
  ) {
    this.mcpServerUrl = this.configurationService.get('MCP_SERVER_URL');
    this.mcpApiKey = this.configurationService.get('MCP_API_KEY');
  }

  /**
   * Send an RPC request to the MCP server.
   *
   * @param method  The RPC method name (e.g. 'getDashboardConfig')
   * @param params  Optional parameters object to send with the request
   * @returns       The parsed JSON response body
   * @throws        Error if the MCP server is not configured, unreachable, or returns an error
   */
  public async rpc<T = unknown>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    if (!this.mcpServerUrl) {
      throw new Error(
        'MCP_SERVER_URL is not configured. Set it in your environment variables.'
      );
    }

    const url = `${this.mcpServerUrl.replace(/\/+$/, '')}/rpc`;
    const body = JSON.stringify({ method, params });

    this.logger.debug(`MCP RPC → ${method} @ ${url}`);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      McpClientService.TIMEOUT_MS
    );

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.mcpApiKey ? { 'x-mcp-api-key': this.mcpApiKey } : {})
        },
        body,
        signal: controller.signal
      });

      const status = response.status;
      const responseText = await response.text().catch(() => '');

      this.logger.log(`MCP RPC ${method} → ${status} @ ${url}`);

      if (!response.ok) {
        this.logger.error(
          `MCP RPC ${method} failed: status=${status} body=${responseText}`
        );

        let mcpBody: unknown;

        try {
          mcpBody = JSON.parse(responseText);
        } catch {
          mcpBody = responseText;
        }

        const err = new Error(`MCP server returned ${status}`);
        (err as any).mcpStatus = status;
        (err as any).mcpBody = mcpBody;

        throw err;
      }

      let parsed: any;

      try {
        parsed = JSON.parse(responseText);
      } catch {
        throw new Error(
          `MCP server returned invalid JSON for method ${method}`
        );
      }

      // JSON-RPC envelope: unwrap `.result` if present
      const data: T = parsed?.result !== undefined ? parsed.result : parsed;

      this.logger.debug(
        `MCP RPC ← ${method} OK (hasResult=${parsed?.result !== undefined})`
      );

      return data;
    } catch (error) {
      if (error?.name === 'AbortError') {
        this.logger.error(
          `MCP RPC timeout after ${McpClientService.TIMEOUT_MS}ms for method: ${method}`
        );

        throw new Error(
          `MCP server request timed out after ${McpClientService.TIMEOUT_MS}ms`
        );
      }

      // Re-throw enriched errors from above as-is
      if ((error as any)?.mcpStatus) {
        throw error;
      }

      this.logger.error(
        `MCP RPC error for method ${method}: ${error?.message ?? error}`
      );

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Call a named tool via MCP RPC with a custom timeout.
   *
   * @param toolName   The MCP tool/method name (e.g. 'getQuote')
   * @param args       Tool arguments to forward
   * @param options    Optional overrides (timeoutMs)
   * @returns          { result, mcpRequestId, mcpLatencyMs }
   */
  public async callTool<T = unknown>(
    toolName: string,
    args: Record<string, unknown>,
    options?: { timeoutMs?: number }
  ): Promise<{ result: T; mcpRequestId: string; mcpLatencyMs: number }> {
    if (!this.mcpServerUrl) {
      throw new Error(
        'MCP_SERVER_URL is not configured. Set it in your environment variables.'
      );
    }

    const url = `${this.mcpServerUrl.replace(/\/+$/, '')}/rpc`;
    const mcpRequestId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const body = JSON.stringify({
      method: toolName,
      params: args,
      requestId: mcpRequestId
    });

    const effectiveTimeout = options?.timeoutMs ?? McpClientService.TIMEOUT_MS;

    this.logger.debug(
      `MCP callTool → ${toolName} (timeout=${effectiveTimeout}ms, reqId=${mcpRequestId})`
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), effectiveTimeout);

    const start = Date.now();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.mcpApiKey ? { 'x-mcp-api-key': this.mcpApiKey } : {})
        },
        body,
        signal: controller.signal
      });

      const mcpLatencyMs = Date.now() - start;

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown error');

        throw new Error(`MCP server returned ${response.status}: ${errorText}`);
      }

      const result = (await response.json()) as T;

      this.logger.debug(
        `MCP callTool ← ${toolName} OK (${mcpLatencyMs}ms, reqId=${mcpRequestId})`
      );

      return { result, mcpRequestId, mcpLatencyMs };
    } catch (error) {
      const mcpLatencyMs = Date.now() - start;

      if (error?.name === 'AbortError') {
        this.logger.error(
          `MCP callTool timeout after ${effectiveTimeout}ms for ${toolName} (reqId=${mcpRequestId})`
        );

        throw new Error(
          `MCP tool ${toolName} timed out after ${effectiveTimeout}ms`
        );
      }

      this.logger.error(
        `MCP callTool error for ${toolName} (${mcpLatencyMs}ms, reqId=${mcpRequestId}): ${error?.message ?? error}`
      );

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Check if the MCP server is configured.
   */
  public isConfigured(): boolean {
    return !!this.mcpServerUrl;
  }

  /**
   * Check if an API key is configured (without revealing it).
   */
  public hasApiKey(): boolean {
    return !!this.mcpApiKey;
  }

  /**
   * Get the resolved RPC URL (safe to expose in diagnostics).
   */
  public getResolvedRpcUrl(): string | null {
    if (!this.mcpServerUrl) {
      return null;
    }

    return `${this.mcpServerUrl.replace(/\/+$/, '')}/rpc`;
  }
}
