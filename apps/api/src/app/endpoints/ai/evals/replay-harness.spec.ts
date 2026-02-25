/**
 * Stage 3 Replay Harness Tests — Record once, score anytime.
 *
 * Tests the replay framework without any LLM calls.
 */
import { replayAndScore, type RecordedSession } from './replay-harness';

describe('Replay Harness Framework', () => {
  const createSession = (
    overrides: Partial<RecordedSession> = {}
  ): RecordedSession => ({
    sessionId: 'test-session-001',
    recordedAt: new Date().toISOString(),
    query: 'How many holdings do I have?',
    messages: [
      {
        role: 'user',
        content: 'How many holdings do I have?',
        timestamp: new Date().toISOString()
      },
      {
        role: 'assistant',
        content: 'You have 10 holdings in your portfolio.',
        timestamp: new Date().toISOString()
      }
    ],
    toolCalls: [
      {
        toolName: 'getPortfolioSummary',
        toolInput: { userCurrency: 'USD' },
        toolOutput: {
          status: 'success',
          data: { holdingsCount: 10 }
        },
        status: 'success',
        latencyMs: 150,
        verification: {
          passed: true,
          confidence: 0.95,
          warnings: [],
          errors: [],
          sources: ['ghostfolio-portfolio-service']
        }
      }
    ],
    finalResponse: 'You have 10 holdings in your portfolio.',
    metadata: {
      model: 'anthropic/claude-sonnet-4',
      totalLatencyMs: 2500,
      inputTokens: 500,
      outputTokens: 50,
      estimatedCostUsd: 0.05,
      iterationCount: 1,
      guardrailsTriggered: []
    },
    ...overrides
  });

  // ── Scoring Without Ground Truth ────────────────────────────────────

  describe('Scoring without ground truth', () => {
    it('should return neutral scores when no ground truth', () => {
      const session = createSession({ groundTruth: undefined });
      const score = replayAndScore(session);

      expect(score.sessionId).toBe('test-session-001');
      expect(score.overallScore).toBe(0.5);
      expect(score.negativeValidation).toBe(1.0);
    });
  });

  // ── Scoring With Ground Truth ───────────────────────────────────────

  describe('Scoring with ground truth', () => {
    it('should score perfectly when all checks pass', () => {
      const session = createSession({
        groundTruth: {
          expectedTools: ['getPortfolioSummary'],
          expectedSources: ['ghostfolio-portfolio-service'],
          mustContain: ['10 holdings'],
          mustNotContain: ["I don't know"]
        }
      });

      const score = replayAndScore(session);

      expect(score.toolAccuracy).toBe(1.0);
      expect(score.groundedness).toBe(1.0);
      expect(score.contentPrecision).toBe(1.0);
      expect(score.negativeValidation).toBe(1.0);
      expect(score.overallScore).toBeGreaterThan(0.8);
    });

    it('should penalize missing tools', () => {
      const session = createSession({
        groundTruth: {
          expectedTools: ['getPortfolioSummary', 'getPerformance'],
          expectedSources: [],
          mustContain: [],
          mustNotContain: []
        }
      });

      const score = replayAndScore(session);

      // Only getPortfolioSummary was called, getPerformance was expected but missing
      expect(score.toolAccuracy).toBe(0.5);
      expect(score.details.missingTools).toContain('getPerformance');
    });

    it('should penalize forbidden content', () => {
      const session = createSession({
        finalResponse: "I don't know the answer.",
        groundTruth: {
          expectedTools: [],
          expectedSources: [],
          mustContain: [],
          mustNotContain: ["I don't know"]
        }
      });

      const score = replayAndScore(session);

      expect(score.negativeValidation).toBe(0);
      expect(score.details.mustNotContainViolations).toContain("I don't know");
    });

    it('should penalize missing required content', () => {
      const session = createSession({
        finalResponse: 'Your portfolio looks good.',
        groundTruth: {
          expectedTools: [],
          expectedSources: [],
          mustContain: ['10 holdings', '5 accounts'],
          mustNotContain: []
        }
      });

      const score = replayAndScore(session);

      expect(score.contentPrecision).toBe(0);
      expect(score.details.mustContainMissing).toContain('10 holdings');
      expect(score.details.mustContainMissing).toContain('5 accounts');
    });

    it('should score faithfulness based on tool verification', () => {
      // All tools passed → faithfulness should be 1.0
      const goodSession = createSession({
        groundTruth: {
          expectedTools: ['getPortfolioSummary'],
          expectedSources: [],
          mustContain: [],
          mustNotContain: []
        }
      });

      expect(replayAndScore(goodSession).faithfulness).toBe(1.0);

      // A tool failed but response mentions error → faithfulness should be decent
      const okSession = createSession({
        toolCalls: [
          {
            toolName: 'getPortfolioSummary',
            toolInput: {},
            toolOutput: null,
            status: 'error',
            latencyMs: 100,
            verification: {
              passed: false,
              confidence: 0,
              warnings: [],
              errors: ['DB error'],
              sources: []
            }
          }
        ],
        finalResponse: 'There was an error retrieving your portfolio data.',
        groundTruth: {
          expectedTools: ['getPortfolioSummary'],
          expectedSources: [],
          mustContain: [],
          mustNotContain: []
        }
      });

      expect(replayAndScore(okSession).faithfulness).toBe(0.8);
    });
  });

  // ── Edge Cases ──────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle empty tool calls', () => {
      const session = createSession({
        toolCalls: [],
        groundTruth: {
          expectedTools: [],
          expectedSources: [],
          mustContain: [],
          mustNotContain: []
        }
      });

      const score = replayAndScore(session);

      expect(score.toolAccuracy).toBe(1.0);
      expect(score.overallScore).toBeGreaterThan(0.5);
    });

    it('should handle extra tools not in ground truth', () => {
      const session = createSession({
        groundTruth: {
          expectedTools: ['getPortfolioSummary'],
          expectedSources: [],
          mustContain: [],
          mustNotContain: []
        }
      });

      // Session has getPortfolioSummary (from createSession default)
      const score = replayAndScore(session);

      expect(score.details.extraTools).toHaveLength(0);
    });
  });
});
