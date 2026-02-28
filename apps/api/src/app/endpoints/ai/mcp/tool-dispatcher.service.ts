/**
 * ToolDispatcher — routes tool execution through local, MCP, or hybrid paths.
 *
 * Controlled by TOOLS_DISPATCH_MODE env var:
 *   - local  (default): all tools run in-process
 *   - mcp:    all tools forwarded to MCP server
 *   - hybrid: allowlisted tools go to MCP, rest run locally
 *
 * MCP results are validated against the same Zod output schemas
 * used for local execution. A verification wrapper is applied so
 * MCP results match the same contract as local results.
 */
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';

import { Injectable, Logger } from '@nestjs/common';
import type { ZodType } from 'zod';

import { createVerificationResult } from '../../../import-auditor/schemas/verification.schema';
import { McpClientService } from './mcp-client.service';
import {
  getMcpMethodName,
  isOnMcpAllowlist,
  type ToolDispatchMode
} from './mcp-tool-map';

export interface DispatchResult<T> {
  /** The tool output (same shape as local) */
  result: T;
  /** Which executor ran this tool */
  executor: 'local' | 'mcp';
  /** MCP request correlation ID (only if executor=mcp) */
  mcpRequestId?: string;
  /** MCP round-trip latency in ms (only if executor=mcp) */
  mcpLatencyMs?: number;
}

@Injectable()
export class ToolDispatcherService {
  private readonly logger = new Logger(ToolDispatcherService.name);
  private readonly mode: ToolDispatchMode;

  public constructor(
    configurationService: ConfigurationService,
    private readonly mcpClientService: McpClientService
  ) {
    const raw = (
      configurationService.get('TOOLS_DISPATCH_MODE') || 'local'
    ).toLowerCase() as ToolDispatchMode;

    this.mode = ['local', 'mcp', 'hybrid'].includes(raw) ? raw : 'local';

    if (this.mode !== 'local') {
      this.logger.log(`ToolDispatcher running in "${this.mode}" mode`);
    }
  }

  /**
   * Get the current dispatch mode.
   */
  public getMode(): ToolDispatchMode {
    return this.mode;
  }

  /**
   * Determine which executor should handle a tool call,
   * then dispatch accordingly.
   */
  public async dispatch<T>(
    toolName: string,
    args: Record<string, unknown>,
    localFn: () => T | Promise<T>,
    options?: {
      outputSchema?: ZodType;
      timeoutMs?: number;
    }
  ): Promise<DispatchResult<T>> {
    const executor = this.resolveExecutor(toolName);

    if (executor === 'local') {
      return this.dispatchLocal(localFn);
    }

    return this.dispatchMcp<T>(toolName, args, options);
  }

  // ─── Private dispatch methods ──────────────────────────────────────

  private async dispatchLocal<T>(
    localFn: () => T | Promise<T>
  ): Promise<DispatchResult<T>> {
    const result = await localFn();

    return { result, executor: 'local' };
  }

  private async dispatchMcp<T>(
    toolName: string,
    args: Record<string, unknown>,
    options?: {
      outputSchema?: ZodType;
      timeoutMs?: number;
    }
  ): Promise<DispatchResult<T>> {
    const mcpMethodName = getMcpMethodName(toolName);

    if (!mcpMethodName) {
      throw new Error(
        `No MCP method mapping found for tool "${toolName}". Add it to mcp-tool-map.ts.`
      );
    }

    if (!this.mcpClientService.isConfigured()) {
      throw new Error(
        `TOOLS_DISPATCH_MODE=${this.mode} but MCP_SERVER_URL is not configured.`
      );
    }

    const {
      result: rawResult,
      mcpRequestId,
      mcpLatencyMs
    } = await this.mcpClientService.callTool<Record<string, unknown>>(
      mcpMethodName,
      args,
      { timeoutMs: options?.timeoutMs }
    );

    // ── Schema validation ────────────────────────────────────────────
    if (options?.outputSchema) {
      const validation = options.outputSchema.safeParse(rawResult);

      if (!validation.success) {
        const zodErrors = validation.error.issues
          .map((i) => i.message)
          .join('; ');

        this.logger.warn(
          `MCP output schema validation failed for ${toolName}: ${zodErrors}`
        );

        // Return an error-shaped result that matches the tool output contract
        const errorResult = {
          status: 'error',
          data: (rawResult as Record<string, unknown>)?.data,
          message: `MCP output schema validation failed: ${zodErrors}`,
          verification: createVerificationResult({
            passed: false,
            confidence: 0,
            errors: [
              `MCP output schema validation failed for ${toolName}: ${zodErrors}`
            ],
            sources: ['mcp-server']
          })
        } as unknown as T;

        return {
          result: errorResult,
          executor: 'mcp',
          mcpRequestId,
          mcpLatencyMs
        };
      }
    }

    // ── Verification wrapper ─────────────────────────────────────────
    // If MCP returned raw data without a verification object, add one.
    const mcpResult = rawResult as Record<string, unknown>;

    if (mcpResult && !mcpResult.verification) {
      mcpResult.verification = createVerificationResult({
        passed: mcpResult.status === 'success',
        confidence: mcpResult.status === 'success' ? 0.85 : 0.1,
        sources: ['mcp-server'],
        warnings: ['Verification added by Ghostfolio (MCP result)']
      });
    }

    return {
      result: mcpResult as T,
      executor: 'mcp',
      mcpRequestId,
      mcpLatencyMs
    };
  }

  // ─── Executor resolution ───────────────────────────────────────────

  private resolveExecutor(toolName: string): 'local' | 'mcp' {
    switch (this.mode) {
      case 'local':
        return 'local';

      case 'mcp':
        return 'mcp';

      case 'hybrid':
        return isOnMcpAllowlist(toolName) ? 'mcp' : 'local';

      default:
        return 'local';
    }
  }
}
