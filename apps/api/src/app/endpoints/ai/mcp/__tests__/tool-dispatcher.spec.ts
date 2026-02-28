/**
 * ToolDispatcher integration tests — verifies that:
 *   1. mode=local always uses the local function
 *   2. mode=hybrid routes allowlisted tools to MCP
 *   3. mode=mcp routes all tools to MCP
 *   4. MCP results pass output schema validation
 *   5. DispatchResult includes executor, mcpRequestId, mcpLatencyMs
 *   6. Verification wrapper is applied to raw MCP results
 */
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';

import { z } from 'zod';

import { createVerificationResult } from '../../../../import-auditor/schemas/verification.schema';
import { McpClientService } from '../mcp-client.service';
import {
  ToolDispatcherService,
  type DispatchResult
} from '../tool-dispatcher.service';

// ── Mock ConfigurationService ─────────────────────────────────────────────

const mockConfigService = {
  get: jest.fn().mockReturnValue('')
};

// ── Mock McpClientService ─────────────────────────────────────────────────

const mockMcpClientService = {
  isConfigured: jest.fn().mockReturnValue(true),
  callTool: jest.fn(),
  rpc: jest.fn()
};

// ── Helpers ───────────────────────────────────────────────────────────────

function createDispatcher(mode: string): ToolDispatcherService {
  // Configure the mock to return the desired mode
  mockConfigService.get.mockImplementation((key: string) => {
    if (key === 'TOOLS_DISPATCH_MODE') return mode;
    return '';
  });

  return new ToolDispatcherService(
    mockConfigService as unknown as ConfigurationService,
    mockMcpClientService as unknown as McpClientService
  );
}

const TestOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: z
    .object({
      quotes: z.array(
        z.object({
          symbol: z.string(),
          price: z.number()
        })
      )
    })
    .optional(),
  message: z.string(),
  verification: z.object({
    passed: z.boolean(),
    confidence: z.number()
  })
});

const MOCK_LOCAL_RESULT = {
  status: 'success' as const,
  data: {
    quotes: [{ symbol: 'AAPL', price: 185.5 }]
  },
  message: 'Fetched 1 of 1 quotes.',
  verification: createVerificationResult({
    passed: true,
    confidence: 0.95,
    sources: ['yahoo-finance2']
  })
};

const MOCK_MCP_RESULT = {
  status: 'success' as const,
  data: {
    quotes: [{ symbol: 'AAPL', price: 185.5 }]
  },
  message: 'Fetched 1 of 1 quotes via MCP.',
  verification: createVerificationResult({
    passed: true,
    confidence: 0.9,
    sources: ['mcp-server']
  })
};

// ──────────────────────────────────────────────────────────────────────────

describe('ToolDispatcherService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMcpClientService.isConfigured.mockReturnValue(true);
  });

  // ══════════════════════════════════════════════════════════════════════
  // 1. mode=local — always use local function
  // ══════════════════════════════════════════════════════════════════════

  describe('mode=local', () => {
    it('should execute local function and return executor=local', async () => {
      const dispatcher = createDispatcher('local');
      const localFn = jest.fn().mockResolvedValue(MOCK_LOCAL_RESULT);

      const dispatched: DispatchResult<typeof MOCK_LOCAL_RESULT> =
        await dispatcher.dispatch('getQuote', { symbols: ['AAPL'] }, localFn);

      expect(localFn).toHaveBeenCalledTimes(1);
      expect(dispatched.executor).toBe('local');
      expect(dispatched.result.status).toBe('success');
      expect(dispatched.mcpRequestId).toBeUndefined();
      expect(dispatched.mcpLatencyMs).toBeUndefined();
    });

    it('should never call McpClientService', async () => {
      const dispatcher = createDispatcher('local');

      await dispatcher.dispatch(
        'getQuote',
        { symbols: ['AAPL'] },
        () => MOCK_LOCAL_RESULT
      );

      expect(mockMcpClientService.callTool).not.toHaveBeenCalled();
    });

    it('should return mode=local from getMode()', () => {
      const dispatcher = createDispatcher('local');
      expect(dispatcher.getMode()).toBe('local');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 2. mode=hybrid — allowlisted tools go to MCP, rest local
  // ══════════════════════════════════════════════════════════════════════

  describe('mode=hybrid', () => {
    it('should route getQuote (allowlisted) to MCP', async () => {
      const dispatcher = createDispatcher('hybrid');

      mockMcpClientService.callTool.mockResolvedValue({
        result: MOCK_MCP_RESULT,
        mcpRequestId: 'mcp-12345-abc',
        mcpLatencyMs: 120
      });

      const dispatched = await dispatcher.dispatch(
        'getQuote',
        { symbols: ['AAPL'] },
        () => MOCK_LOCAL_RESULT
      );

      expect(mockMcpClientService.callTool).toHaveBeenCalledTimes(1);
      expect(mockMcpClientService.callTool).toHaveBeenCalledWith(
        'getQuote',
        { symbols: ['AAPL'] },
        { timeoutMs: undefined }
      );
      expect(dispatched.executor).toBe('mcp');
      expect(dispatched.mcpRequestId).toBe('mcp-12345-abc');
      expect(dispatched.mcpLatencyMs).toBe(120);
    });

    it('should route getPortfolioSummary (not allowlisted) to local', async () => {
      const dispatcher = createDispatcher('hybrid');
      const localFn = jest.fn().mockResolvedValue(MOCK_LOCAL_RESULT);

      const dispatched = await dispatcher.dispatch(
        'getPortfolioSummary',
        { userCurrency: 'USD' },
        localFn
      );

      expect(localFn).toHaveBeenCalledTimes(1);
      expect(dispatched.executor).toBe('local');
      expect(mockMcpClientService.callTool).not.toHaveBeenCalled();
    });

    it('should return mode=hybrid from getMode()', () => {
      const dispatcher = createDispatcher('hybrid');
      expect(dispatcher.getMode()).toBe('hybrid');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 3. mode=mcp — all tools go to MCP
  // ══════════════════════════════════════════════════════════════════════

  describe('mode=mcp', () => {
    it('should route all tools to MCP', async () => {
      const dispatcher = createDispatcher('mcp');

      mockMcpClientService.callTool.mockResolvedValue({
        result: MOCK_MCP_RESULT,
        mcpRequestId: 'mcp-99999-xyz',
        mcpLatencyMs: 200
      });

      const dispatched = await dispatcher.dispatch(
        'getPortfolioSummary',
        { userCurrency: 'USD' },
        () => MOCK_LOCAL_RESULT // should NOT be called
      );

      expect(dispatched.executor).toBe('mcp');
      expect(mockMcpClientService.callTool).toHaveBeenCalledTimes(1);
    });

    it('should throw if MCP is not configured', async () => {
      mockMcpClientService.isConfigured.mockReturnValue(false);
      const dispatcher = createDispatcher('mcp');

      await expect(
        dispatcher.dispatch(
          'getQuote',
          { symbols: ['AAPL'] },
          () => MOCK_LOCAL_RESULT
        )
      ).rejects.toThrow('MCP_SERVER_URL is not configured');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 4. Schema validation on MCP results
  // ══════════════════════════════════════════════════════════════════════

  describe('MCP output schema validation', () => {
    it('should pass validation when MCP result matches schema', async () => {
      const dispatcher = createDispatcher('mcp');

      mockMcpClientService.callTool.mockResolvedValue({
        result: MOCK_MCP_RESULT,
        mcpRequestId: 'mcp-valid',
        mcpLatencyMs: 50
      });

      const dispatched = await dispatcher.dispatch(
        'getQuote',
        { symbols: ['AAPL'] },
        () => MOCK_LOCAL_RESULT,
        { outputSchema: TestOutputSchema }
      );

      expect(dispatched.result.status).toBe('success');
      expect(dispatched.executor).toBe('mcp');
    });

    it('should return error result when MCP result fails schema validation', async () => {
      const dispatcher = createDispatcher('mcp');

      // Return a result that doesn't match the schema
      mockMcpClientService.callTool.mockResolvedValue({
        result: { invalid: 'data' }, // Missing required fields
        mcpRequestId: 'mcp-invalid',
        mcpLatencyMs: 30
      });

      const dispatched = await dispatcher.dispatch(
        'getQuote',
        { symbols: ['AAPL'] },
        () => MOCK_LOCAL_RESULT,
        { outputSchema: TestOutputSchema }
      );

      expect(dispatched.result).toBeDefined();
      expect((dispatched.result as any).status).toBe('error');
      expect((dispatched.result as any).message).toContain(
        'MCP output schema validation failed'
      );
      expect(dispatched.executor).toBe('mcp');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 5. Verification wrapper for raw MCP results
  // ══════════════════════════════════════════════════════════════════════

  describe('Verification wrapper', () => {
    it('should add verification object when MCP result lacks one', async () => {
      const dispatcher = createDispatcher('mcp');

      // Raw MCP result without verification
      mockMcpClientService.callTool.mockResolvedValue({
        result: {
          status: 'success',
          data: { quotes: [{ symbol: 'AAPL', price: 185.5 }] },
          message: 'Raw MCP result'
        },
        mcpRequestId: 'mcp-raw',
        mcpLatencyMs: 80
      });

      const dispatched = await dispatcher.dispatch(
        'getQuote',
        { symbols: ['AAPL'] },
        () => MOCK_LOCAL_RESULT
      );

      const result = dispatched.result as any;
      expect(result.verification).toBeDefined();
      expect(result.verification.passed).toBe(true);
      expect(result.verification.confidence).toBe(0.85);
      expect(result.verification.sources).toContain('mcp-server');
    });

    it('should preserve existing verification from MCP', async () => {
      const dispatcher = createDispatcher('mcp');

      mockMcpClientService.callTool.mockResolvedValue({
        result: MOCK_MCP_RESULT,
        mcpRequestId: 'mcp-verified',
        mcpLatencyMs: 60
      });

      const dispatched = await dispatcher.dispatch(
        'getQuote',
        { symbols: ['AAPL'] },
        () => MOCK_LOCAL_RESULT
      );

      const result = dispatched.result as any;
      // Should keep the original verification from MOCK_MCP_RESULT
      expect(result.verification.confidence).toBe(0.9);
      expect(result.verification.sources).toContain('mcp-server');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 6. ToolSpan metadata — executor field
  // ══════════════════════════════════════════════════════════════════════

  describe('ToolSpan metadata', () => {
    it('should include executor=mcp and mcpLatencyMs in dispatch result', async () => {
      const dispatcher = createDispatcher('hybrid');

      mockMcpClientService.callTool.mockResolvedValue({
        result: MOCK_MCP_RESULT,
        mcpRequestId: 'mcp-span-test',
        mcpLatencyMs: 150
      });

      const dispatched = await dispatcher.dispatch(
        'getQuote',
        { symbols: ['AAPL'] },
        () => MOCK_LOCAL_RESULT
      );

      // These values are passed to ToolSpanBuilder.end() by executeWithGuardrails
      expect(dispatched.executor).toBe('mcp');
      expect(dispatched.mcpRequestId).toBe('mcp-span-test');
      expect(dispatched.mcpLatencyMs).toBe(150);
    });

    it('should include executor=local with no MCP metadata for local tools', async () => {
      const dispatcher = createDispatcher('hybrid');

      const dispatched = await dispatcher.dispatch(
        'getPortfolioSummary',
        { userCurrency: 'USD' },
        () => MOCK_LOCAL_RESULT
      );

      expect(dispatched.executor).toBe('local');
      expect(dispatched.mcpRequestId).toBeUndefined();
      expect(dispatched.mcpLatencyMs).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 7. Invalid mode defaults to local
  // ══════════════════════════════════════════════════════════════════════

  describe('Invalid mode handling', () => {
    it('should default to local for invalid mode value', () => {
      const dispatcher = createDispatcher('invalid-mode');
      expect(dispatcher.getMode()).toBe('local');
    });
  });
});
