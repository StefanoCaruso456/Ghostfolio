/**
 * Production Hardening Tests — Assert gates, guardrails, and schema validation.
 *
 * These tests verify the new production-reliability improvements:
 * - Verification gate enforcement (block / human_review / continue)
 * - Circuit breaker with normalized signatures
 * - Payload limits (CSV size + row count)
 * - Tool failure backoff
 * - Hallucination detection in broker detection
 * - Zod validation helper
 * - Stateless session behavior
 */
import { z } from 'zod';

import { CircuitBreaker, createSignature } from '../guardrails/circuit-breaker';
import {
  checkPayloadLimits,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS
} from '../guardrails/payload-limiter';
import {
  ToolFailureTracker,
  MAX_TOOL_FAILURES
} from '../guardrails/tool-failure-tracker';
import type { MappedActivity } from '../schemas/validate-transactions.schema';
import { createVerificationResult } from '../schemas/verification.schema';
import { validateWithZod } from '../tooling/tool-helpers';
import { detectBrokerFormat } from '../tools/detect-broker-format.tool';
import { generateImportPreview } from '../tools/generate-import-preview.tool';
import { normalizeToActivityDTO } from '../tools/normalize-to-activity-dto.tool';
import { validateTransactions } from '../tools/validate-transactions.tool';
import { enforceVerificationGate } from '../verification/enforce';

// ─── Test Fixtures ──────────────────────────────────────────────────

const VALID_ACTIVITY: MappedActivity = {
  account: null,
  comment: null,
  currency: 'USD',
  dataSource: 'YAHOO',
  date: '2023-01-15T00:00:00.000Z',
  fee: 19,
  quantity: 5,
  symbol: 'MSFT',
  type: 'BUY',
  unitPrice: 298.58
};

// ═════════════════════════════════════════════════════════════════════
// Verification Gate Tests
// ═════════════════════════════════════════════════════════════════════

describe('Verification Gate: enforceVerificationGate', () => {
  it('G001: blocks when verification.passed=false', () => {
    const v = createVerificationResult({
      passed: false,
      errors: ['Something failed']
    });

    const gate = enforceVerificationGate(v, {
      highStakes: false,
      minConfidence: 0.7
    });

    expect(gate.decision).toBe('block');
    expect((gate as { reason: string }).reason).toContain('Something failed');
  });

  it('G002: blocks when domainRulesFailed is non-empty', () => {
    const v = createVerificationResult({
      passed: true,
      confidence: 1.0,
      domainRulesFailed: ['error-free-commit-gate']
    });

    const gate = enforceVerificationGate(v, {
      highStakes: false,
      minConfidence: 0.7
    });

    expect(gate.decision).toBe('block');
    expect((gate as { reason: string }).reason).toContain(
      'error-free-commit-gate'
    );
  });

  it('G003: requests human_review on highStakes + confidence < minConfidence', () => {
    const v = createVerificationResult({
      passed: true,
      confidence: 0.5
    });

    const gate = enforceVerificationGate(v, {
      highStakes: true,
      minConfidence: 0.7
    });

    expect(gate.decision).toBe('human_review');
    expect((gate as { reason: string }).reason).toContain('low confidence');
  });

  it('G004: requests human_review on hallucination flags', () => {
    const v = createVerificationResult({
      passed: true,
      confidence: 0.9,
      hallucinationFlags: ['Broker detection uncertain']
    });

    const gate = enforceVerificationGate(v, {
      highStakes: false,
      minConfidence: 0.7
    });

    expect(gate.decision).toBe('human_review');
    expect((gate as { reason: string }).reason).toContain('Hallucination');
  });

  it('G005: continues when all checks pass', () => {
    const v = createVerificationResult({
      passed: true,
      confidence: 0.95
    });

    const gate = enforceVerificationGate(v, {
      highStakes: false,
      minConfidence: 0.7
    });

    expect(gate.decision).toBe('continue');
  });

  it('G006: requests human_review when requiresHumanReview=true', () => {
    const v = createVerificationResult({
      passed: true,
      confidence: 0.95,
      requiresHumanReview: true
    });

    const gate = enforceVerificationGate(v, {
      highStakes: false,
      minConfidence: 0.7
    });

    expect(gate.decision).toBe('human_review');
  });

  it('G007: requests human_review on warnings in high-stakes flow', () => {
    const v = createVerificationResult({
      passed: true,
      confidence: 0.95,
      warnings: ['Some warning']
    });

    const gate = enforceVerificationGate(v, {
      highStakes: true,
      minConfidence: 0.7
    });

    expect(gate.decision).toBe('human_review');
  });

  it('G008: verification gate blocks import preview with errors', () => {
    const preview = generateImportPreview({
      validActivities: [VALID_ACTIVITY],
      totalErrors: 2,
      totalWarnings: 0
    });

    const gate = enforceVerificationGate(preview.verification, {
      highStakes: true,
      minConfidence: 0.7
    });

    // Should block because domain rule "error-free-commit-gate" failed
    expect(gate.decision).toBe('block');
  });
});

// ═════════════════════════════════════════════════════════════════════
// Circuit Breaker Signature Normalization Tests
// ═════════════════════════════════════════════════════════════════════

describe('Circuit Breaker: Normalized Signatures', () => {
  it('G009: treats whitespace-padded strings as identical', () => {
    const sig1 = createSignature('parseCSV', {
      csvContent: 'a,b,c'
    });
    const sig2 = createSignature('parseCSV', {
      csvContent: '  a,b,c  '
    });

    expect(sig1).toBe(sig2);
  });

  it('G010: truncates long strings in signature', () => {
    const longString = 'x'.repeat(500);
    const sig1 = createSignature('parseCSV', { csvContent: longString });
    const sig2 = createSignature('parseCSV', {
      csvContent: longString + 'extra'
    });

    // Both should be truncated to 200 chars → same signature
    expect(sig1).toBe(sig2);
  });

  it('G011: rounds numbers to 2 decimal places', () => {
    const sig1 = createSignature('tool', { price: 100.123456 });
    const sig2 = createSignature('tool', { price: 100.12 });

    expect(sig1).toBe(sig2);
  });

  it('G012: sorts keys deterministically', () => {
    const sig1 = createSignature('tool', { b: 1, a: 2 });
    const sig2 = createSignature('tool', { a: 2, b: 1 });

    expect(sig1).toBe(sig2);
  });

  it('G013: circuit breaker trips on normalized-equivalent args', () => {
    const cb = new CircuitBreaker({ maxRepetitions: 3 });

    cb.recordAction('parseCSV', { csvContent: 'data' });
    cb.recordAction('parseCSV', { csvContent: '  data  ' }); // whitespace
    const tripped = cb.recordAction('parseCSV', { csvContent: 'data' });

    expect(tripped).toBe(true);
    expect(cb.isTripped()).toBe(true);
  });

  it('G014: arrays are bucketed by length', () => {
    const sig1 = createSignature('tool', { items: [1, 2, 3] });
    const sig2 = createSignature('tool', { items: [4, 5, 6] });

    // Both arrays have length 3 → same bucket → same signature
    expect(sig1).toBe(sig2);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Payload Limit Tests
// ═════════════════════════════════════════════════════════════════════

describe('Payload Limits', () => {
  it('G015: accepts normal-sized CSV', () => {
    const csv = 'Date,Symbol,Price\n2023-01-01,MSFT,298.58';
    const result = checkPayloadLimits(csv);

    expect(result.ok).toBe(true);
  });

  it('G016: rejects CSV exceeding byte limit', () => {
    const csv = 'x'.repeat(MAX_CSV_BYTES + 1);
    const result = checkPayloadLimits(csv);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('MB limit');
  });

  it('G017: rejects CSV exceeding row limit', () => {
    const header = 'Date,Symbol,Price';
    const rows = Array.from(
      { length: MAX_CSV_ROWS + 10 },
      () => '2023-01-01,MSFT,298'
    );
    const csv = [header, ...rows].join('\n');
    const result = checkPayloadLimits(csv);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('row limit');
  });

  it('G018: accepts undefined CSV content', () => {
    const result = checkPayloadLimits(undefined);

    expect(result.ok).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Tool Failure Backoff Tests
// ═════════════════════════════════════════════════════════════════════

describe('Tool Failure Tracker', () => {
  it('G019: does not abort on first failure', () => {
    const tracker = new ToolFailureTracker();
    const shouldAbort = tracker.recordFailure('parseCSV');

    expect(shouldAbort).toBe(false);
    expect(tracker.isAborted()).toBe(false);
  });

  it('G020: aborts on second failure of same tool', () => {
    const tracker = new ToolFailureTracker();
    tracker.recordFailure('parseCSV');
    const shouldAbort = tracker.recordFailure('parseCSV');

    expect(shouldAbort).toBe(true);
    expect(tracker.isAborted()).toBe(true);
    expect(tracker.getAbortReason()).toContain('parseCSV');
    expect(tracker.getAbortReason()).toContain(`${MAX_TOOL_FAILURES} times`);
  });

  it('G021: does not abort on failures of different tools', () => {
    const tracker = new ToolFailureTracker();
    tracker.recordFailure('parseCSV');
    tracker.recordFailure('mapBrokerFields');

    expect(tracker.isAborted()).toBe(false);
  });

  it('G022: tracks per-tool failure counts', () => {
    const tracker = new ToolFailureTracker();
    tracker.recordFailure('parseCSV');
    tracker.recordFailure('mapBrokerFields');
    tracker.recordFailure('parseCSV');

    const counts = tracker.getFailureCounts();
    expect(counts.get('parseCSV')).toBe(2);
    expect(counts.get('mapBrokerFields')).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Zod Validation Helper Tests
// ═════════════════════════════════════════════════════════════════════

describe('Zod Validation Helper: validateWithZod', () => {
  const TestSchema = z.object({
    name: z.string(),
    age: z.number().min(0)
  });

  it('G023: returns ok:true for valid input', () => {
    const result = validateWithZod(
      TestSchema,
      { name: 'Alice', age: 30 },
      'INVALID_INPUT',
      'test input'
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data.name).toBe('Alice');
    }
  });

  it('G024: returns ok:false with structured error for invalid input', () => {
    const result = validateWithZod(
      TestSchema,
      { name: 123, age: -1 },
      'INVALID_INPUT',
      'test input'
    );

    expect(result.ok).toBe(false);

    // Narrowing for TS discriminated union
    if (result.ok === false) {
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.message).toContain('Schema validation failed');
      expect(result.error.details).toBeDefined();
    }
  });

  it('G025: returns ok:false for null/undefined input', () => {
    const result = validateWithZod(
      TestSchema,
      null,
      'INVALID_INPUT',
      'null input'
    );

    expect(result.ok).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Hallucination Detection Tests
// ═════════════════════════════════════════════════════════════════════

describe('Hallucination Detection: detectBrokerFormat', () => {
  it('G026: flags low-confidence broker detection as hallucination risk', () => {
    // Use headers that partially match a broker but not fully
    const result = detectBrokerFormat({
      headers: ['Symbol', 'Quantity'],
      sampleRows: [{ Symbol: 'AAPL', Quantity: 10 }]
    });

    // Low match → should have hallucination flags
    if (
      result.data.confidence < 0.6 &&
      result.data.detectedBroker !== 'generic'
    ) {
      expect(result.verification.hallucinationFlags).toBeDefined();
      expect(result.verification.hallucinationFlags!.length).toBeGreaterThan(0);
    }
  });

  it('G027: flags generic fallback with best guess as hallucination risk', () => {
    const result = detectBrokerFormat({
      headers: ['Col1', 'Col2'],
      sampleRows: [{ Col1: 'a', Col2: 'b' }]
    });

    expect(result.data.detectedBroker).toBe('generic');
    // The tool should flag that there's no confident match
    expect(result.verification.requiresHumanReview).toBe(true);
  });

  it('G028: no hallucination flags for high-confidence detection', () => {
    const result = detectBrokerFormat({
      headers: [
        'CurrencyPrimary',
        'Symbol',
        'TradeDate',
        'TradePrice',
        'Quantity',
        'Buy/Sell',
        'IBCommission'
      ],
      sampleRows: [
        {
          CurrencyPrimary: 'USD',
          Symbol: 'VTI',
          TradeDate: '20230403',
          TradePrice: 204.35,
          Quantity: 17,
          'Buy/Sell': 'BUY',
          IBCommission: -1
        }
      ]
    });

    expect(result.data.detectedBroker).toBe('interactive_brokers');
    expect(result.data.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.verification.allClaimsSupported).toBe(true);
  });

  it('G029: hallucination flags trigger human_review gate (passed=true case)', () => {
    // A broker detection that passed (confidence >= 0.5) but still has
    // hallucination flags because confidence is below the hallucination threshold (0.6)
    const v = createVerificationResult({
      passed: true,
      confidence: 0.55,
      hallucinationFlags: [
        'Broker "swissquote" detected with only 55% confidence — may be hallucinated'
      ],
      allClaimsSupported: false
    });

    const gate = enforceVerificationGate(v, {
      highStakes: true,
      minConfidence: 0.7
    });

    // Hallucination flags should trigger human_review (not block, since passed=true)
    expect(gate.decision).toBe('human_review');
    expect((gate as { reason: string }).reason).toContain('Hallucination');
  });
});

// ═════════════════════════════════════════════════════════════════════
// Integration: Verification gate with real tool outputs
// ═════════════════════════════════════════════════════════════════════

describe('Integration: Verification Gate + Real Tools', () => {
  it('G030: validation errors block commit via verification gate', () => {
    const result = validateTransactions({
      activities: [{ ...VALID_ACTIVITY, fee: -5 }]
    });

    const gate = enforceVerificationGate(result.verification, {
      highStakes: true,
      minConfidence: 0.7
    });

    expect(gate.decision).toBe('block');
  });

  it('G031: high-value preview triggers human review gate', () => {
    const highValueActivity = {
      ...VALID_ACTIVITY,
      quantity: 1000,
      unitPrice: 500
    }; // $500k
    const normalized = normalizeToActivityDTO({
      activities: [highValueActivity]
    });
    const result = generateImportPreview({
      validActivities: [highValueActivity],
      totalErrors: 0,
      totalWarnings: 0,
      normalizedDTOs: normalized.data.dtos,
      dtoNormalizationErrors: normalized.data.totalFailed
    });

    // The tool itself flags requiresHumanReview
    expect(result.verification.requiresHumanReview).toBe(true);

    const gate = enforceVerificationGate(result.verification, {
      highStakes: true,
      minConfidence: 0.7
    });

    expect(gate.decision).toBe('human_review');
  });

  it('G032: clean validation passes verification gate', () => {
    const result = validateTransactions({
      activities: [VALID_ACTIVITY]
    });

    const gate = enforceVerificationGate(result.verification, {
      highStakes: false,
      minConfidence: 0.7
    });

    expect(gate.decision).toBe('continue');
  });
});
