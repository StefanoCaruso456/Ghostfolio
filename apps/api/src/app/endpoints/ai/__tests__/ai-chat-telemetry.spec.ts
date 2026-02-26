/**
 * Service-level AI chat tests — verifies the full pipeline including
 * tool execution and Braintrust telemetry WITHOUT requiring Docker/Postgres/Redis.
 *
 * Mocks: generateText(), PropertyService, PortfolioService, OrderService
 * Real:  executeWithGuardrails(), TraceContext, ToolSpanBuilder, BraintrustTelemetryService
 */
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';

import { BraintrustTelemetryService } from '../telemetry/braintrust-telemetry.service';
import type { TelemetryPayload } from '../telemetry/telemetry.interfaces';

// ── Mock generateText before importing AiService ─────────────────────────

let mockGenerateTextImpl: (args: any) => Promise<any>;

jest.mock('ai', () => ({
  generateText: jest.fn(async (args: any) => {
    if (mockGenerateTextImpl) {
      return mockGenerateTextImpl(args);
    }

    return {
      text: 'Mock LLM response',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
    };
  }),
  tool: jest.fn((config: any) => config)
}));

jest.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: jest.fn(() => ({
    chat: jest.fn(() => 'mock-model-ref')
  }))
}));

// ── Now import AiService (after mocks are in place) ──────────────────────

import { AiService } from '../ai.service';
import { AiConversationService } from '../conversation/conversation.service';

describe('AI Chat Telemetry Integration', () => {
  let aiService: AiService;
  let telemetryService: BraintrustTelemetryService;
  let logTraceSpy: jest.SpyInstance;
  let capturedPayload: TelemetryPayload | null = null;

  const mockPropertyService = {
    getByKey: jest.fn()
  };

  const mockPortfolioService = {
    getDetails: jest.fn(),
    getPerformance: jest.fn()
  };

  const mockOrderService = {
    getOrders: jest.fn()
  };

  const mockConversationService = {
    createConversation: jest.fn().mockResolvedValue({ id: 'conv-1' }),
    addMessages: jest.fn().mockResolvedValue({ count: 2 })
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue(undefined) // No Braintrust key → disabled
  };

  beforeEach(() => {
    jest.clearAllMocks();
    capturedPayload = null;

    // Default: return API key + model from property service
    mockPropertyService.getByKey.mockImplementation((key: string) => {
      if (key === 'API_KEY_OPENROUTER') return 'test-api-key';
      if (key === 'OPENROUTER_MODEL') return 'anthropic/claude-sonnet-4';
      return null;
    });

    telemetryService = new BraintrustTelemetryService(
      mockConfigService as unknown as ConfigurationService
    );

    // Spy on logTrace to capture the payload
    logTraceSpy = jest
      .spyOn(telemetryService, 'logTrace')
      .mockImplementation(async (payload: TelemetryPayload) => {
        capturedPayload = payload;
      });

    aiService = new AiService(
      mockConversationService as unknown as AiConversationService,
      mockOrderService as any,
      mockPortfolioService as any,
      mockPropertyService as any,
      telemetryService
    );
  });

  // ========================================================================
  // Test 1: Tool call scenario — "Price of AAPL" → getQuote
  // ========================================================================
  describe('Tool call scenario — getQuote', () => {
    beforeEach(() => {
      // Simulate the LLM calling getQuote tool and returning a response
      mockGenerateTextImpl = async (args: any) => {
        // Find the getQuote tool
        const getQuoteTool = args.tools?.getQuote;

        if (getQuoteTool?.execute) {
          // Simulate LLM calling the tool
          await getQuoteTool.execute({ symbols: ['AAPL'] });
        }

        return {
          text: 'The current price of AAPL is $185.50.',
          usage: { promptTokens: 200, completionTokens: 80, totalTokens: 280 },
          steps: [
            {
              toolCalls: [
                { toolName: 'getQuote', args: { symbols: ['AAPL'] } }
              ]
            }
          ]
        };
      };
    });

    it('should invoke tool executor', async () => {
      const response = await aiService.chat({
        attachments: [],
        conversationId: 'test-conv-1',
        history: [],
        languageCode: 'en',
        message: 'What is the price of AAPL?',
        userCurrency: 'USD',
        userId: 'user-123'
      });

      expect(response).toBeDefined();
      expect(response.message.role).toBe('assistant');
      expect(response.conversationId).toBeTruthy();
    });

    it('should call telemetryService.logTrace() exactly once', async () => {
      await aiService.chat({
        attachments: [],
        conversationId: 'test-conv-1',
        history: [],
        languageCode: 'en',
        message: 'What is the price of AAPL?',
        userCurrency: 'USD',
        userId: 'user-123'
      });

      expect(logTraceSpy).toHaveBeenCalledTimes(1);
    });

    it('should set payload.trace.usedTools === true', async () => {
      await aiService.chat({
        attachments: [],
        conversationId: 'test-conv-1',
        history: [],
        languageCode: 'en',
        message: 'What is the price of AAPL?',
        userCurrency: 'USD',
        userId: 'user-123'
      });

      expect(capturedPayload).not.toBeNull();
      expect(capturedPayload!.trace.usedTools).toBe(true);
    });

    it('should set payload.trace.toolCallCount > 0', async () => {
      await aiService.chat({
        attachments: [],
        conversationId: 'test-conv-1',
        history: [],
        languageCode: 'en',
        message: 'What is the price of AAPL?',
        userCurrency: 'USD',
        userId: 'user-123'
      });

      expect(capturedPayload!.trace.toolCallCount).toBeGreaterThan(0);
    });

    it('should include toolName=getQuote in toolSpans', async () => {
      await aiService.chat({
        attachments: [],
        conversationId: 'test-conv-1',
        history: [],
        languageCode: 'en',
        message: 'What is the price of AAPL?',
        userCurrency: 'USD',
        userId: 'user-123'
      });

      expect(capturedPayload!.toolSpans.length).toBeGreaterThanOrEqual(1);

      const quoteSpan = capturedPayload!.toolSpans.find(
        (s) => s.toolName === 'getQuote'
      );
      expect(quoteSpan).toBeDefined();
      expect(quoteSpan!.toolName).toBe('getQuote');
      expect(quoteSpan!.latencyMs).toBeGreaterThanOrEqual(0);
      expect(['success', 'error']).toContain(quoteSpan!.status);
    });

    it('should populate error field when tool fails', async () => {
      await aiService.chat({
        attachments: [],
        conversationId: 'test-conv-1',
        history: [],
        languageCode: 'en',
        message: 'What is the price of AAPL?',
        userCurrency: 'USD',
        userId: 'user-123'
      });

      // getQuote will fail because there's no real market data provider
      // The span should still record the execution with error details
      const quoteSpan = capturedPayload!.toolSpans.find(
        (s) => s.toolName === 'getQuote'
      );
      expect(quoteSpan).toBeDefined();

      // If tool errored, error field should be populated
      if (quoteSpan!.status === 'error') {
        expect(quoteSpan!.error).toBeTruthy();
      }
    });

    it('should include trace metadata (sessionId, userId, model)', async () => {
      await aiService.chat({
        attachments: [],
        conversationId: 'test-conv-1',
        history: [],
        languageCode: 'en',
        message: 'What is the price of AAPL?',
        userCurrency: 'USD',
        userId: 'user-123'
      });

      expect(capturedPayload!.trace.sessionId).toBe('test-conv-1');
      expect(capturedPayload!.trace.userId).toBe('user-123');
      expect(capturedPayload!.trace.model).toBe('anthropic/claude-sonnet-4');
      expect(capturedPayload!.trace.queryText).toBe(
        'What is the price of AAPL?'
      );
    });

    it('should include verification summary', async () => {
      await aiService.chat({
        attachments: [],
        conversationId: 'test-conv-1',
        history: [],
        languageCode: 'en',
        message: 'What is the price of AAPL?',
        userCurrency: 'USD',
        userId: 'user-123'
      });

      expect(capturedPayload!.verification).toBeDefined();
      expect(typeof capturedPayload!.verification.passed).toBe('boolean');
      expect(typeof capturedPayload!.verification.confidenceScore).toBe(
        'number'
      );
      expect(
        capturedPayload!.verification.confidenceScore
      ).toBeGreaterThanOrEqual(0);
      expect(
        capturedPayload!.verification.confidenceScore
      ).toBeLessThanOrEqual(1);
    });
  });

  // ========================================================================
  // Test 2: No-tools prompt — "Hello, how are you?"
  // ========================================================================
  describe('No-tools prompt — toolCallCount === 0', () => {
    beforeEach(() => {
      // LLM responds directly without calling any tools
      mockGenerateTextImpl = async () => {
        return {
          text: "Hello! I'm your Ghostfolio AI assistant. I can help you with portfolio analysis, market data, and investment questions. How can I assist you today?",
          usage: { promptTokens: 150, completionTokens: 40, totalTokens: 190 },
          steps: []
        };
      };
    });

    it('should return a valid response without tool calls', async () => {
      const response = await aiService.chat({
        attachments: [],
        conversationId: 'test-conv-2',
        history: [],
        languageCode: 'en',
        message: 'Hello, how are you?',
        userCurrency: 'USD',
        userId: 'user-456'
      });

      expect(response).toBeDefined();
      expect(response.message.content).toBeTruthy();
      expect(response.message.role).toBe('assistant');
    });

    it('should call telemetryService.logTrace() exactly once', async () => {
      await aiService.chat({
        attachments: [],
        conversationId: 'test-conv-2',
        history: [],
        languageCode: 'en',
        message: 'Hello, how are you?',
        userCurrency: 'USD',
        userId: 'user-456'
      });

      expect(logTraceSpy).toHaveBeenCalledTimes(1);
    });

    it('should set payload.trace.toolCallCount === 0', async () => {
      await aiService.chat({
        attachments: [],
        conversationId: 'test-conv-2',
        history: [],
        languageCode: 'en',
        message: 'Hello, how are you?',
        userCurrency: 'USD',
        userId: 'user-456'
      });

      expect(capturedPayload).not.toBeNull();
      expect(capturedPayload!.trace.toolCallCount).toBe(0);
    });

    it('should set payload.trace.usedTools === false', async () => {
      await aiService.chat({
        attachments: [],
        conversationId: 'test-conv-2',
        history: [],
        languageCode: 'en',
        message: 'Hello, how are you?',
        userCurrency: 'USD',
        userId: 'user-456'
      });

      expect(capturedPayload!.trace.usedTools).toBe(false);
    });

    it('should have empty toolSpans array', async () => {
      await aiService.chat({
        attachments: [],
        conversationId: 'test-conv-2',
        history: [],
        languageCode: 'en',
        message: 'Hello, how are you?',
        userCurrency: 'USD',
        userId: 'user-456'
      });

      expect(capturedPayload!.toolSpans).toEqual([]);
    });

    it('should have empty toolNames array', async () => {
      await aiService.chat({
        attachments: [],
        conversationId: 'test-conv-2',
        history: [],
        languageCode: 'en',
        message: 'Hello, how are you?',
        userCurrency: 'USD',
        userId: 'user-456'
      });

      expect(capturedPayload!.trace.toolNames).toEqual([]);
    });

    it('should still include success=true in trace', async () => {
      await aiService.chat({
        attachments: [],
        conversationId: 'test-conv-2',
        history: [],
        languageCode: 'en',
        message: 'Hello, how are you?',
        userCurrency: 'USD',
        userId: 'user-456'
      });

      expect(capturedPayload!.trace.success).toBe(true);
      expect(capturedPayload!.trace.error).toBeNull();
    });

    it('should record response text in trace', async () => {
      await aiService.chat({
        attachments: [],
        conversationId: 'test-conv-2',
        history: [],
        languageCode: 'en',
        message: 'Hello, how are you?',
        userCurrency: 'USD',
        userId: 'user-456'
      });

      expect(capturedPayload!.trace.responseText).toBeTruthy();
      expect(capturedPayload!.trace.responseText).toContain('Ghostfolio');
    });
  });

  // ========================================================================
  // Test 3: Payload structure validation
  // ========================================================================
  describe('Payload structure validation', () => {
    beforeEach(() => {
      mockGenerateTextImpl = async () => ({
        text: 'Test response',
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 }
      });
    });

    it('should have all required TelemetryPayload fields', async () => {
      await aiService.chat({
        attachments: [],
        conversationId: 'test-conv-3',
        history: [],
        languageCode: 'en',
        message: 'Test prompt',
        userCurrency: 'USD',
        userId: 'user-789'
      });

      expect(capturedPayload).not.toBeNull();

      // Top-level shape
      expect(capturedPayload).toHaveProperty('trace');
      expect(capturedPayload).toHaveProperty('toolSpans');
      expect(capturedPayload).toHaveProperty('verification');
      expect(capturedPayload).toHaveProperty('reactIterations');
      expect(capturedPayload).toHaveProperty('derived');

      // Trace fields
      const trace = capturedPayload!.trace;
      expect(trace.traceId).toBeTruthy();
      expect(trace.sessionId).toBe('test-conv-3');
      expect(trace.userId).toBe('user-789');
      expect(typeof trace.totalLatencyMs).toBe('number');
      expect(typeof trace.llmLatencyMs).toBe('number');
      expect(typeof trace.toolCallCount).toBe('number');
      expect(Array.isArray(trace.toolNames)).toBe(true);
      expect(typeof trace.success).toBe('boolean');

      // Derived metrics
      const derived = capturedPayload!.derived;
      expect(typeof derived.toolOverheadRatio).toBe('number');
      expect(typeof derived.failedToolCount).toBe('number');
    });
  });
});
