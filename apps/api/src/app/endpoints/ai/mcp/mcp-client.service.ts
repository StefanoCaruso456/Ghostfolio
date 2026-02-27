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

      let data: T;

      try {
        data = JSON.parse(responseText) as T;
      } catch {
        throw new Error(
          `MCP server returned invalid JSON for method ${method}`
        );
      }

      this.logger.debug(`MCP RPC ← ${method} OK`);

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
