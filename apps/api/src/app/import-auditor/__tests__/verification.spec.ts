import {
  createVerificationResult,
  mergeVerificationResults,
  shouldEscalateToHuman
} from '../schemas/verification.schema';

describe('VerificationResult', () => {
  // ─── Factory ───────────────────────────────────────────────────────

  it('should create a default passing verification result', () => {
    const result = createVerificationResult();

    expect(result.passed).toBe(true);
    expect(result.confidence).toBe(1.0);
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.requiresHumanReview).toBe(false);
  });

  it('should allow overriding specific fields', () => {
    const result = createVerificationResult({
      passed: false,
      confidence: 0.3,
      errors: ['Something failed'],
      verificationType: 'fact_check'
    });

    expect(result.passed).toBe(false);
    expect(result.confidence).toBe(0.3);
    expect(result.errors).toEqual(['Something failed']);
    expect(result.verificationType).toBe('fact_check');
  });

  // ─── Human-in-the-Loop Escalation ─────────────────────────────────

  it('should escalate when domain rules fail', () => {
    const verification = createVerificationResult({
      confidence: 0.9,
      domainRulesFailed: ['max-position-size']
    });

    expect(shouldEscalateToHuman(verification, false)).toBe(true);
  });

  it('should escalate for high-stakes + low confidence', () => {
    const verification = createVerificationResult({
      confidence: 0.5
    });

    expect(shouldEscalateToHuman(verification, true)).toBe(true);
  });

  it('should NOT escalate for high-stakes + high confidence', () => {
    const verification = createVerificationResult({
      confidence: 0.9
    });

    expect(shouldEscalateToHuman(verification, true)).toBe(false);
  });

  it('should NOT escalate for low-stakes + low confidence', () => {
    const verification = createVerificationResult({
      confidence: 0.3
    });

    expect(shouldEscalateToHuman(verification, false)).toBe(false);
  });

  it('should escalate when hallucination flags are present', () => {
    const verification = createVerificationResult({
      confidence: 0.9,
      hallucinationFlags: ['Unsupported claim about return rate']
    });

    expect(shouldEscalateToHuman(verification, false)).toBe(true);
  });

  // ─── Merge ─────────────────────────────────────────────────────────

  it('should merge multiple verification results', () => {
    const results = [
      createVerificationResult({
        passed: true,
        confidence: 0.8,
        sources: ['tool-a'],
        warnings: ['warn1']
      }),
      createVerificationResult({
        passed: true,
        confidence: 0.6,
        sources: ['tool-b'],
        warnings: ['warn2']
      })
    ];

    const merged = mergeVerificationResults(results);

    expect(merged.passed).toBe(true);
    expect(merged.confidence).toBeCloseTo(0.7, 1);
    expect(merged.warnings).toEqual(['warn1', 'warn2']);
    expect(merged.sources).toContain('tool-a');
    expect(merged.sources).toContain('tool-b');
    expect(merged.verificationType).toBe('composite');
  });

  it('should fail if any sub-result fails', () => {
    const results = [
      createVerificationResult({ passed: true, confidence: 1.0 }),
      createVerificationResult({ passed: false, confidence: 0.2 })
    ];

    const merged = mergeVerificationResults(results);

    expect(merged.passed).toBe(false);
    expect(merged.confidence).toBeCloseTo(0.6, 1);
  });

  it('should flag human review if any sub-result requires it', () => {
    const results = [
      createVerificationResult({ requiresHumanReview: false }),
      createVerificationResult({
        requiresHumanReview: true,
        escalationReason: 'High value import'
      })
    ];

    const merged = mergeVerificationResults(results);

    expect(merged.requiresHumanReview).toBe(true);
    expect(merged.escalationReason).toContain('High value import');
  });

  it('should deduplicate sources in merge', () => {
    const results = [
      createVerificationResult({ sources: ['papaparse', 'tool-a'] }),
      createVerificationResult({ sources: ['papaparse', 'tool-b'] })
    ];

    const merged = mergeVerificationResults(results);

    // 'papaparse' should appear only once
    const paparseCount = merged.sources.filter((s) => s === 'papaparse').length;
    expect(paparseCount).toBe(1);
    expect(merged.sources).toContain('tool-a');
    expect(merged.sources).toContain('tool-b');
  });

  it('should return default for empty merge', () => {
    const merged = mergeVerificationResults([]);

    expect(merged.passed).toBe(true);
    expect(merged.confidence).toBe(1.0);
  });

  it('should collect domain rules from all results', () => {
    const results = [
      createVerificationResult({
        domainRulesChecked: ['rule-a', 'rule-b'],
        domainRulesFailed: ['rule-b']
      }),
      createVerificationResult({
        domainRulesChecked: ['rule-c'],
        domainRulesFailed: []
      })
    ];

    const merged = mergeVerificationResults(results);

    expect(merged.domainRulesChecked).toEqual(['rule-a', 'rule-b', 'rule-c']);
    expect(merged.domainRulesFailed).toEqual(['rule-b']);
  });

  it('should track allClaimsSupported across results', () => {
    const results = [
      createVerificationResult({ allClaimsSupported: true }),
      createVerificationResult({ allClaimsSupported: false })
    ];

    const merged = mergeVerificationResults(results);
    expect(merged.allClaimsSupported).toBe(false);
  });
});
