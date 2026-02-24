/**
 * AgentForge Evaluation Framework
 *
 * Provides structured test case definition, execution, and reporting
 * for the Import Auditor agentic system.
 *
 * Requirements:
 * - 50+ test cases minimum
 * - Categories: happy_path, edge_case, adversarial, multi_step, verification, guardrail
 * - Measures: correctness, tool selection, tool execution, safety, latency, cost
 * - Target pass rate: >80% (good), >90% (excellent)
 */

export type TestCategory =
  | 'happy_path'
  | 'edge_case'
  | 'adversarial'
  | 'multi_step'
  | 'verification'
  | 'guardrail';

export interface TestCase {
  id: string;
  category: TestCategory;
  description: string;
  inputQuery: string;
  csvContent?: string;
  expectedTools: string[];
  expectedOutcome: {
    /** Keywords that should appear in the response */
    keywords?: string[];
    /** Should the run succeed? */
    success: boolean;
    /** Should canCommit be true? */
    canCommit?: boolean;
    /** Expected verification.passed per tool */
    verificationPassed?: Record<string, boolean>;
    /** Expected guardrail trigger */
    guardrailTriggered?: string;
    /** Minimum confidence threshold */
    minConfidence?: number;
  };
}

export interface TestResult {
  testId: string;
  category: TestCategory;
  passed: boolean;
  failures: string[];
  durationMs: number;
  toolsCalled: string[];
  cost: number;
}

export interface EvaluationReport {
  totalTests: number;
  passed: number;
  failed: number;
  passRate: number;
  avgDurationMs: number;
  avgCost: number;
  byCategory: Record<
    TestCategory,
    { total: number; passed: number; passRate: number }
  >;
  failures: { testId: string; reasons: string[] }[];
}

/**
 * Run all test cases against the agent and produce a report.
 * This is designed to be called from a Jest test or a CLI script.
 */
export function generateEvaluationReport(
  results: TestResult[]
): EvaluationReport {
  const totalTests = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = totalTests - passed;
  const passRate = totalTests > 0 ? passed / totalTests : 0;

  const avgDurationMs =
    totalTests > 0
      ? results.reduce((sum, r) => sum + r.durationMs, 0) / totalTests
      : 0;

  const avgCost =
    totalTests > 0
      ? results.reduce((sum, r) => sum + r.cost, 0) / totalTests
      : 0;

  const categories: TestCategory[] = [
    'happy_path',
    'edge_case',
    'adversarial',
    'multi_step',
    'verification',
    'guardrail'
  ];

  const byCategory: EvaluationReport['byCategory'] =
    {} as EvaluationReport['byCategory'];

  for (const cat of categories) {
    const catResults = results.filter((r) => r.category === cat);
    const catPassed = catResults.filter((r) => r.passed).length;

    byCategory[cat] = {
      total: catResults.length,
      passed: catPassed,
      passRate: catResults.length > 0 ? catPassed / catResults.length : 0
    };
  }

  const failures = results
    .filter((r) => !r.passed)
    .map((r) => ({ testId: r.testId, reasons: r.failures }));

  return {
    totalTests,
    passed,
    failed,
    passRate,
    avgDurationMs,
    avgCost,
    byCategory,
    failures
  };
}
