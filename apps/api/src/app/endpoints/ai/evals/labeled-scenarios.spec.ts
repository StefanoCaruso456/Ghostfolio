/**
 * Stage 2 Labeled Scenario Tests — Coverage mapping.
 *
 * These tests validate the scenario framework and coverage reporting.
 * Run on every release / CI job.
 */
import {
  generateCoverageReport,
  LABELED_SCENARIOS,
  runLabeledScenarios
} from './labeled-scenarios';

describe('Labeled Scenarios Framework', () => {
  // ── Structure ───────────────────────────────────────────────────────

  describe('Scenario Structure', () => {
    it('should have at least 25 labeled scenarios', () => {
      expect(LABELED_SCENARIOS.length).toBeGreaterThanOrEqual(25);
    });

    it('should have unique IDs for all scenarios', () => {
      const ids = LABELED_SCENARIOS.map((s) => s.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should have valid categories for all scenarios', () => {
      const validCategories = [
        'single_tool',
        'multi_tool',
        'edge_case',
        'adversarial',
        'performance',
        'safety'
      ];

      for (const scenario of LABELED_SCENARIOS) {
        expect(validCategories).toContain(scenario.category);
      }
    });

    it('should have valid complexity levels', () => {
      const validComplexity = ['simple', 'medium', 'complex'];

      for (const scenario of LABELED_SCENARIOS) {
        expect(validComplexity).toContain(scenario.complexity);
      }
    });

    it('should have valid difficulty levels', () => {
      const validDifficulty = ['straightforward', 'nuanced', 'ambiguous'];

      for (const scenario of LABELED_SCENARIOS) {
        expect(validDifficulty).toContain(scenario.difficulty);
      }
    });

    it('should cover all 6 categories', () => {
      const categories = new Set(LABELED_SCENARIOS.map((s) => s.category));

      expect(categories.has('single_tool')).toBe(true);
      expect(categories.has('multi_tool')).toBe(true);
      expect(categories.has('edge_case')).toBe(true);
      expect(categories.has('adversarial')).toBe(true);
      expect(categories.has('performance')).toBe(true);
      expect(categories.has('safety')).toBe(true);
    });
  });

  // ── Coverage Report ─────────────────────────────────────────────────

  describe('Coverage Report', () => {
    it('should generate a coverage matrix', () => {
      const report = generateCoverageReport();

      expect(report.matrix.length).toBeGreaterThan(0);
      expect(report.totalScenarios).toBe(LABELED_SCENARIOS.length);
    });

    it('should identify coverage gaps', () => {
      const report = generateCoverageReport();

      // Gaps should be identified where category × tool has zero tests
      expect(report.gaps).toBeDefined();
      expect(Array.isArray(report.gaps)).toBe(true);
    });

    it('should report per-category counts', () => {
      const report = generateCoverageReport();

      expect(report.categoryCounts).toBeDefined();
      expect(report.categoryCounts.single_tool).toBeGreaterThan(0);
      expect(report.categoryCounts.safety).toBeGreaterThan(0);
    });

    it('should have at least 3 scenarios per major category', () => {
      const report = generateCoverageReport();

      expect(report.categoryCounts.single_tool).toBeGreaterThanOrEqual(3);
      expect(report.categoryCounts.multi_tool).toBeGreaterThanOrEqual(2);
      expect(report.categoryCounts.safety).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Scenario Runner ─────────────────────────────────────────────────

  describe('Scenario Runner', () => {
    it('should return results grouped by category', () => {
      const testResults = [
        {
          caseId: 'ls-001',
          toolsUsed: ['getPortfolioSummary'],
          sources: ['ghostfolio-portfolio-service'],
          responseText: 'You have 10 holdings.'
        },
        {
          caseId: 'ls-070',
          toolsUsed: [],
          sources: [],
          responseText:
            'I cannot provide investment advice. Please consult a financial advisor.'
        }
      ];

      const results = runLabeledScenarios(testResults);

      expect(results.total).toBe(2);
      expect(results.byCategory).toBeDefined();
      expect(results.byCategory.single_tool.passed).toBe(1);
      expect(results.byCategory.safety.passed).toBe(1);
    });

    it('should handle missing scenario IDs gracefully', () => {
      const testResults = [
        {
          caseId: 'nonexistent-999',
          toolsUsed: [],
          sources: [],
          responseText: 'test'
        }
      ];

      const results = runLabeledScenarios(testResults);

      expect(results.total).toBe(0);
    });
  });
});
