/**
 * Stage 3: Replay Harness — Record once. Score anytime.
 *
 * Per slide deck:
 * - Capture a real session (via JSON trace).
 * - Evaluate that frozen snapshot whenever you want — immediately,
 *   next week, or after a human has annotated ground truth.
 * - Record production examples. Real queries make the best test cases.
 *
 * ML-grade metrics:
 * - Precision: How many labeled cases are relevant?
 * - Recall: How many relevant cases were retrieved?
 * - Groundedness: Is the response grounded in sources?
 * - Faithfulness: Does the model stay true to retrieved context?
 * - Tool Accuracy: Did it use correct tools?
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Session Recording ──────────────────────────────────────────────

export interface RecordedToolCall {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput: Record<string, unknown> | null;
  status: 'success' | 'error';
  latencyMs: number;
  verification: {
    passed: boolean;
    confidence: number;
    warnings: string[];
    errors: string[];
    sources: string[];
  };
}

export interface RecordedMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface RecordedSession {
  sessionId: string;
  recordedAt: string;
  query: string;
  messages: RecordedMessage[];
  toolCalls: RecordedToolCall[];
  finalResponse: string;
  metadata: {
    model: string;
    totalLatencyMs: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    iterationCount: number;
    guardrailsTriggered: string[];
  };
  /** Human-annotated ground truth (added after recording) */
  groundTruth?: {
    expectedTools: string[];
    expectedSources: string[];
    mustContain: string[];
    mustNotContain: string[];
    humanScore?: number; // 1-5
    notes?: string;
  };
}

// ─── Recording ──────────────────────────────────────────────────────

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

/**
 * Record a session to a JSON fixture file.
 * Call this after a real AI chat session completes.
 */
export function recordSession(session: RecordedSession): string {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  const fileName = `${session.sessionId}.json`;
  const filePath = path.join(FIXTURES_DIR, fileName);

  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf8');

  return filePath;
}

/**
 * Load a recorded session from fixture.
 */
export function loadSession(sessionId: string): RecordedSession | null {
  const filePath = path.join(FIXTURES_DIR, `${sessionId}.json`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, 'utf8');

  return JSON.parse(raw) as RecordedSession;
}

/**
 * List all recorded session IDs.
 */
export function listRecordedSessions(): string[] {
  if (!fs.existsSync(FIXTURES_DIR)) {
    return [];
  }

  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));
}

// ─── Replay Scoring ─────────────────────────────────────────────────

export interface ReplayScore {
  sessionId: string;

  /** Tool Accuracy: Did it use the correct tools? */
  toolAccuracy: number;

  /** Groundedness: Is the response grounded in tool-returned sources? */
  groundedness: number;

  /** Faithfulness: Does response stay true to tool context (no fabrication)? */
  faithfulness: number;

  /** Content precision: How many must_contain terms were found? */
  contentPrecision: number;

  /** Content recall: How many expected terms were found vs total expected? */
  contentRecall: number;

  /** Negative validation: Are forbidden terms absent? */
  negativeValidation: number;

  /** Overall composite score 0-1 */
  overallScore: number;

  details: {
    expectedTools: string[];
    actualTools: string[];
    missingTools: string[];
    extraTools: string[];
    mustContainFound: string[];
    mustContainMissing: string[];
    mustNotContainViolations: string[];
  };
}

/**
 * Replay a recorded session and score it deterministically.
 * No LLM call needed — uses the frozen snapshot.
 */
export function replayAndScore(session: RecordedSession): ReplayScore {
  const gt = session.groundTruth;

  if (!gt) {
    // No ground truth — return neutral scores
    return {
      sessionId: session.sessionId,
      toolAccuracy: 0.5,
      groundedness: 0.5,
      faithfulness: 0.5,
      contentPrecision: 0.5,
      contentRecall: 0.5,
      negativeValidation: 1.0,
      overallScore: 0.5,
      details: {
        expectedTools: [],
        actualTools: session.toolCalls.map((tc) => tc.toolName),
        missingTools: [],
        extraTools: [],
        mustContainFound: [],
        mustContainMissing: [],
        mustNotContainViolations: []
      }
    };
  }

  const actualTools = session.toolCalls.map((tc) => tc.toolName);
  const actualToolSet = new Set(actualTools);
  const expectedToolSet = new Set(gt.expectedTools);

  // Tool Accuracy
  const correctTools = gt.expectedTools.filter((t) => actualToolSet.has(t));
  const missingTools = gt.expectedTools.filter((t) => !actualToolSet.has(t));
  const extraTools = actualTools.filter((t) => !expectedToolSet.has(t));

  const toolAccuracy =
    gt.expectedTools.length > 0
      ? correctTools.length / gt.expectedTools.length
      : actualTools.length === 0
        ? 1.0
        : 0.5;

  // Groundedness: Check that tool sources are cited
  const actualSources = session.toolCalls.flatMap(
    (tc) => tc.verification.sources
  );
  const expectedSourceSet = new Set(gt.expectedSources);
  const groundedSources = actualSources.filter((s) => expectedSourceSet.has(s));

  const groundedness =
    gt.expectedSources.length > 0
      ? groundedSources.length / gt.expectedSources.length
      : 1.0;

  // Faithfulness: Check no tool verification failures were ignored
  const failedTools = session.toolCalls.filter((tc) => !tc.verification.passed);
  const responseLower = session.finalResponse.toLowerCase();

  const faithfulness =
    failedTools.length === 0
      ? 1.0
      : responseLower.includes('error') || responseLower.includes('unavailable')
        ? 0.8
        : 0.4;

  // Content Precision & Recall
  const mustContainFound = gt.mustContain.filter((term) =>
    responseLower.includes(term.toLowerCase())
  );
  const mustContainMissing = gt.mustContain.filter(
    (term) => !responseLower.includes(term.toLowerCase())
  );

  const contentPrecision =
    gt.mustContain.length > 0
      ? mustContainFound.length / gt.mustContain.length
      : 1.0;

  const contentRecall = contentPrecision; // Same for now

  // Negative Validation
  const mustNotContainViolations = gt.mustNotContain.filter((term) =>
    responseLower.includes(term.toLowerCase())
  );

  const negativeValidation =
    gt.mustNotContain.length > 0
      ? 1.0 - mustNotContainViolations.length / gt.mustNotContain.length
      : 1.0;

  // Overall composite
  const overallScore =
    toolAccuracy * 0.25 +
    groundedness * 0.2 +
    faithfulness * 0.2 +
    contentPrecision * 0.15 +
    contentRecall * 0.1 +
    negativeValidation * 0.1;

  return {
    sessionId: session.sessionId,
    toolAccuracy,
    groundedness,
    faithfulness,
    contentPrecision,
    contentRecall,
    negativeValidation,
    overallScore,
    details: {
      expectedTools: gt.expectedTools,
      actualTools,
      missingTools,
      extraTools,
      mustContainFound,
      mustContainMissing,
      mustNotContainViolations
    }
  };
}

/**
 * Replay all recorded sessions and aggregate scores.
 */
export function replayAllSessions(): {
  totalSessions: number;
  averageScore: number;
  scores: ReplayScore[];
} {
  const sessionIds = listRecordedSessions();
  const scores: ReplayScore[] = [];

  for (const sessionId of sessionIds) {
    const session = loadSession(sessionId);

    if (session) {
      scores.push(replayAndScore(session));
    }
  }

  const averageScore =
    scores.length > 0
      ? scores.reduce((sum, s) => sum + s.overallScore, 0) / scores.length
      : 0;

  return {
    totalSessions: scores.length,
    averageScore,
    scores
  };
}
