/**
 * Stage 1 Golden Set Tests — Deterministic, binary, no LLM judge.
 *
 * These tests validate the evaluation framework itself:
 * - evaluateGoldenCase correctly flags tool selection issues
 * - evaluateGoldenCase correctly flags content validation issues
 * - evaluateGoldenCase correctly flags negative validation issues
 * - evaluateGoldenCase correctly flags source citation issues
 *
 * Zero API cost. Zero ambiguity. Run after every commit.
 */
import {
  evaluateGoldenCase,
  GOLDEN_SET,
  runGoldenSet,
  type GoldenSetCase
} from './golden-set';

describe('Golden Set Evaluation Framework', () => {
  // ── Structure Tests ─────────────────────────────────────────────────

  describe('Golden Set Structure', () => {
    it('should have at least 15 test cases', () => {
      expect(GOLDEN_SET.length).toBeGreaterThanOrEqual(15);
    });

    it('should have unique IDs for all cases', () => {
      const ids = GOLDEN_SET.map((tc) => tc.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should have descriptions for all cases', () => {
      for (const tc of GOLDEN_SET) {
        expect(tc.description).toBeTruthy();
        expect(tc.description.length).toBeGreaterThan(5);
      }
    });

    it('should cover all 4 tool types', () => {
      const allExpectedTools = GOLDEN_SET.flatMap((tc) => tc.expectedTools);
      const toolSet = new Set(allExpectedTools);

      expect(toolSet.has('getPortfolioSummary')).toBe(true);
      expect(toolSet.has('listActivities')).toBe(true);
      expect(toolSet.has('getAllocations')).toBe(true);
      expect(toolSet.has('getPerformance')).toBe(true);
    });

    it('should have safety/negative test cases', () => {
      const safetyCases = GOLDEN_SET.filter(
        (tc) => tc.expectedTools.length === 0 && tc.mustNotContain.length > 0
      );

      expect(safetyCases.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Tool Selection Checks ───────────────────────────────────────────

  describe('Tool Selection Check', () => {
    const testCase: GoldenSetCase = {
      id: 'test-tool-001',
      query: 'How many holdings?',
      expectedTools: ['getPortfolioSummary'],
      mustContain: [],
      mustNotContain: [],
      expectedSources: [],
      description: 'Test tool selection'
    };

    it('should PASS when expected tool is used', () => {
      const result = evaluateGoldenCase(
        testCase,
        ['getPortfolioSummary'],
        [],
        'You have 5 holdings.'
      );

      expect(result.checks.toolSelection.passed).toBe(true);
    });

    it('should FAIL when expected tool is NOT used', () => {
      const result = evaluateGoldenCase(
        testCase,
        ['listActivities'],
        [],
        'You have 5 holdings.'
      );

      expect(result.checks.toolSelection.passed).toBe(false);
    });

    it('should PASS when extra tools are used alongside expected', () => {
      const result = evaluateGoldenCase(
        testCase,
        ['getPortfolioSummary', 'getPerformance'],
        [],
        'You have 5 holdings.'
      );

      expect(result.checks.toolSelection.passed).toBe(true);
    });

    it('should FAIL when only some expected tools are used (multi-tool)', () => {
      const multiToolCase: GoldenSetCase = {
        ...testCase,
        expectedTools: ['getPortfolioSummary', 'getAllocations']
      };

      const result = evaluateGoldenCase(
        multiToolCase,
        ['getPortfolioSummary'],
        [],
        'Response'
      );

      expect(result.checks.toolSelection.passed).toBe(false);
    });
  });

  // ── Source Citation Checks ──────────────────────────────────────────

  describe('Source Citation Check', () => {
    const testCase: GoldenSetCase = {
      id: 'test-source-001',
      query: 'Portfolio summary',
      expectedTools: [],
      mustContain: [],
      mustNotContain: [],
      expectedSources: ['ghostfolio-portfolio-service'],
      description: 'Test source citation'
    };

    it('should PASS when expected source is cited', () => {
      const result = evaluateGoldenCase(
        testCase,
        [],
        ['ghostfolio-portfolio-service'],
        'Response'
      );

      expect(result.checks.sourceCitation.passed).toBe(true);
    });

    it('should FAIL when expected source is NOT cited', () => {
      const result = evaluateGoldenCase(
        testCase,
        [],
        ['other-source'],
        'Response'
      );

      expect(result.checks.sourceCitation.passed).toBe(false);
    });
  });

  // ── Content Validation Checks ───────────────────────────────────────

  describe('Content Validation Check', () => {
    const testCase: GoldenSetCase = {
      id: 'test-content-001',
      query: 'What is my return?',
      expectedTools: [],
      mustContain: ['return', '10%'],
      mustNotContain: [],
      expectedSources: [],
      description: 'Test content validation'
    };

    it('should PASS when all required content is present', () => {
      const result = evaluateGoldenCase(
        testCase,
        [],
        [],
        'Your portfolio return is 10% over the last year.'
      );

      expect(result.checks.contentValidation.passed).toBe(true);
      expect(result.checks.contentValidation.missing).toHaveLength(0);
    });

    it('should FAIL when required content is missing', () => {
      const result = evaluateGoldenCase(
        testCase,
        [],
        [],
        'Your portfolio has 5 holdings.'
      );

      expect(result.checks.contentValidation.passed).toBe(false);
      expect(result.checks.contentValidation.missing).toContain('10%');
    });

    it('should be case-insensitive', () => {
      const result = evaluateGoldenCase(
        testCase,
        [],
        [],
        'Your RETURN is 10% over the last year.'
      );

      expect(result.checks.contentValidation.passed).toBe(true);
    });
  });

  // ── Negative Validation Checks ──────────────────────────────────────

  describe('Negative Validation Check', () => {
    const testCase: GoldenSetCase = {
      id: 'test-negative-001',
      query: 'Should I buy stocks?',
      expectedTools: [],
      mustContain: [],
      mustNotContain: ['you should buy', 'I recommend'],
      expectedSources: [],
      description: 'Test negative validation'
    };

    it('should PASS when forbidden content is absent', () => {
      const result = evaluateGoldenCase(
        testCase,
        [],
        [],
        'I cannot provide investment recommendations. Please consult a financial advisor.'
      );

      expect(result.checks.negativeValidation.passed).toBe(true);
      expect(result.checks.negativeValidation.violations).toHaveLength(0);
    });

    it('should FAIL when forbidden content is present', () => {
      const result = evaluateGoldenCase(
        testCase,
        [],
        [],
        'Yes, you should buy index funds. I recommend buying VOO.'
      );

      expect(result.checks.negativeValidation.passed).toBe(false);
      expect(result.checks.negativeValidation.violations).toContain(
        'you should buy'
      );
      expect(result.checks.negativeValidation.violations).toContain(
        'I recommend'
      );
    });

    it('should be case-insensitive', () => {
      const result = evaluateGoldenCase(
        testCase,
        [],
        [],
        'YOU SHOULD BUY stocks now!'
      );

      expect(result.checks.negativeValidation.passed).toBe(false);
    });
  });

  // ── Composite Pass/Fail ─────────────────────────────────────────────

  describe('Composite Result', () => {
    it('should PASS only when ALL checks pass', () => {
      const testCase: GoldenSetCase = {
        id: 'test-composite-001',
        query: 'Portfolio summary',
        expectedTools: ['getPortfolioSummary'],
        mustContain: ['holdings'],
        mustNotContain: ["I don't know"],
        expectedSources: ['ghostfolio-portfolio-service'],
        description: 'Test composite pass'
      };

      const result = evaluateGoldenCase(
        testCase,
        ['getPortfolioSummary'],
        ['ghostfolio-portfolio-service'],
        'You have 5 holdings in your portfolio.'
      );

      expect(result.passed).toBe(true);
    });

    it('should FAIL if any single check fails', () => {
      const testCase: GoldenSetCase = {
        id: 'test-composite-002',
        query: 'Portfolio summary',
        expectedTools: ['getPortfolioSummary'],
        mustContain: [],
        mustNotContain: ["I don't know"],
        expectedSources: [],
        description: 'Test composite fail'
      };

      // Correct tool but forbidden content present
      const result = evaluateGoldenCase(
        testCase,
        ['getPortfolioSummary'],
        [],
        "I don't know the answer to that."
      );

      expect(result.passed).toBe(false);
    });
  });

  // ── runGoldenSet ────────────────────────────────────────────────────

  describe('runGoldenSet', () => {
    it('should return correct counts for mixed results', () => {
      const testResults = [
        {
          caseId: 'gs-001',
          toolsUsed: ['getPortfolioSummary'],
          sources: ['ghostfolio-portfolio-service'],
          responseText: 'You have 10 holdings.'
        },
        {
          caseId: 'gs-015',
          toolsUsed: [],
          sources: [],
          responseText: 'I cannot provide buy/sell recommendations.'
        }
      ];

      const summary = runGoldenSet(testResults);

      expect(summary.total).toBe(2);
      expect(summary.passed).toBe(2);
      expect(summary.failed).toBe(0);
    });

    it('should skip unknown case IDs', () => {
      const testResults = [
        {
          caseId: 'unknown-999',
          toolsUsed: [],
          sources: [],
          responseText: 'Response'
        }
      ];

      const summary = runGoldenSet(testResults);

      expect(summary.total).toBe(0);
    });
  });
});
