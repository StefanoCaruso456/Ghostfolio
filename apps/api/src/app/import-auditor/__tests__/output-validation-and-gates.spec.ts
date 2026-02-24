/**
 * Tests for production blockers and quality upgrades:
 *
 * 1. Verification gate block → canCommit=false
 * 2. Runtime output schema validation
 * 3. schemaVersion injection
 * 4. Named schemas replace inline schemas (drift prevention)
 */
import {
  DetectBrokerFormatInputSchema,
  DetectBrokerFormatOutputSchema
} from '../schemas/detect-broker-format.schema';
import { GenerateImportPreviewOutputSchema } from '../schemas/generate-import-preview.schema';
import {
  MapBrokerFieldsInputSchema,
  MapBrokerFieldsOutputSchema
} from '../schemas/map-broker-fields.schema';
import {
  NormalizeActivitiesInputSchema,
  NormalizeActivitiesOutputSchema
} from '../schemas/normalize-activities.schema';
import {
  ParseCsvInputSchema,
  ParseCsvOutputSchema
} from '../schemas/parse-csv.schema';
import { TOOL_RESULT_SCHEMA_VERSION } from '../schemas/tool-result.schema';
import type { MappedActivity } from '../schemas/validate-transactions.schema';
import {
  ValidateTransactionsInputSchema,
  ValidateTransactionsOutputSchema
} from '../schemas/validate-transactions.schema';
import { createVerificationResult } from '../schemas/verification.schema';
import { detectBrokerFormat } from '../tools/detect-broker-format.tool';
import { generateImportPreview } from '../tools/generate-import-preview.tool';
import { mapBrokerFields } from '../tools/map-broker-fields.tool';
import { normalizeToActivityDTO } from '../tools/normalize-to-activity-dto.tool';
import { parseCsv } from '../tools/parse-csv.tool';
import { validateTransactions } from '../tools/validate-transactions.tool';
import { enforceVerificationGate } from '../verification/enforce';

// ─── Fixtures ────────────────────────────────────────────────────────

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
// 1. Verification Gate Block → canCommit=false
// ═════════════════════════════════════════════════════════════════════

describe('Gate block resets canCommit', () => {
  it('V001: gate block returns "block" decision when verification fails', () => {
    const v = createVerificationResult({
      passed: false,
      confidence: 0,
      errors: ['Validation failed completely']
    });

    const gate = enforceVerificationGate(v, {
      highStakes: true,
      minConfidence: 0.7
    });

    expect(gate.decision).toBe('block');
  });

  it('V002: gate block returns "block" when domain rules fail', () => {
    const v = createVerificationResult({
      passed: true,
      confidence: 1.0,
      domainRulesFailed: ['dto-normalization-gate']
    });

    const gate = enforceVerificationGate(v, {
      highStakes: true,
      minConfidence: 0.7
    });

    expect(gate.decision).toBe('block');
  });

  it('V003: preview without DTOs blocks canCommit and fails dto-normalization-gate', () => {
    const preview = generateImportPreview({
      validActivities: [VALID_ACTIVITY],
      totalErrors: 0,
      totalWarnings: 0
      // no normalizedDTOs → canCommit must be false
    });

    expect(preview.data.canCommit).toBe(false);
    expect(preview.verification.domainRulesFailed).toContain(
      'dto-normalization-gate'
    );

    // The verification gate should block this
    const gate = enforceVerificationGate(preview.verification, {
      highStakes: true,
      minConfidence: 0.7
    });
    expect(gate.decision).toBe('block');
  });
});

// ═════════════════════════════════════════════════════════════════════
// 2. Runtime Output Schema Validation
// ═════════════════════════════════════════════════════════════════════

describe('Output schema validation', () => {
  it('V004: parseCsv output passes ParseCsvOutputSchema', () => {
    const result = parseCsv({
      csvContent: 'Date,Symbol,Price\n2023-01-15,MSFT,298.58',
      delimiter: ','
    });

    const validation = ParseCsvOutputSchema.safeParse(result);
    expect(validation.success).toBe(true);
  });

  it('V005: detectBrokerFormat output passes DetectBrokerFormatOutputSchema', () => {
    const result = detectBrokerFormat({
      headers: ['Date', 'Symbol', 'Price', 'Quantity', 'Fee', 'Type'],
      sampleRows: [
        {
          Date: '2023-01-15',
          Symbol: 'MSFT',
          Price: 298.58,
          Quantity: 5,
          Fee: 19,
          Type: 'BUY'
        }
      ]
    });

    const validation = DetectBrokerFormatOutputSchema.safeParse(result);
    expect(validation.success).toBe(true);
  });

  it('V006: mapBrokerFields output passes MapBrokerFieldsOutputSchema', () => {
    const result = mapBrokerFields({
      headers: [
        'Date',
        'Symbol',
        'Price',
        'Quantity',
        'Fee',
        'Type',
        'Currency'
      ],
      sampleRows: [
        {
          Date: '2023-01-15',
          Symbol: 'MSFT',
          Price: 298.58,
          Quantity: 5,
          Fee: 19,
          Type: 'BUY',
          Currency: 'USD'
        }
      ]
    });

    const validation = MapBrokerFieldsOutputSchema.safeParse(result);
    expect(validation.success).toBe(true);
  });

  it('V007: validateTransactions output passes ValidateTransactionsOutputSchema', () => {
    const result = validateTransactions({
      activities: [VALID_ACTIVITY]
    });

    const validation = ValidateTransactionsOutputSchema.safeParse(result);
    expect(validation.success).toBe(true);
  });

  it('V008: normalizeToActivityDTO output passes NormalizeActivitiesOutputSchema', () => {
    const result = normalizeToActivityDTO({
      activities: [VALID_ACTIVITY]
    });

    const validation = NormalizeActivitiesOutputSchema.safeParse(result);
    expect(validation.success).toBe(true);
  });

  it('V009: generateImportPreview output passes GenerateImportPreviewOutputSchema', () => {
    const normalized = normalizeToActivityDTO({
      activities: [VALID_ACTIVITY]
    });
    const result = generateImportPreview({
      validActivities: [VALID_ACTIVITY],
      totalErrors: 0,
      totalWarnings: 0,
      normalizedDTOs: normalized.data.dtos,
      dtoNormalizationErrors: normalized.data.totalFailed
    });

    const validation = GenerateImportPreviewOutputSchema.safeParse(result);
    expect(validation.success).toBe(true);
  });

  it('V010: malformed output fails schema validation', () => {
    // Simulate a tool returning output with missing required field
    const malformed = {
      status: 'success',
      data: {
        rows: [],
        headers: [],
        rowCount: 0
        // missing: errors
      },
      verification: createVerificationResult()
    };

    const validation = ParseCsvOutputSchema.safeParse(malformed);
    expect(validation.success).toBe(false);
  });

  it('V011: schema validation catches wrong status enum', () => {
    const wrongStatus = {
      status: 'unknown_status', // not in enum
      data: {
        detectedBroker: 'generic',
        confidence: 0,
        allMatches: [],
        explanation: 'test'
      },
      verification: createVerificationResult()
    };

    const validation = DetectBrokerFormatOutputSchema.safeParse(wrongStatus);
    expect(validation.success).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 3. Schema Version
// ═════════════════════════════════════════════════════════════════════

describe('Schema version', () => {
  it('V012: TOOL_RESULT_SCHEMA_VERSION is defined and is a semver-like string', () => {
    expect(TOOL_RESULT_SCHEMA_VERSION).toBeDefined();
    expect(typeof TOOL_RESULT_SCHEMA_VERSION).toBe('string');
    expect(TOOL_RESULT_SCHEMA_VERSION).toMatch(/^\d+\.\d+$/);
  });

  it('V013: current version is 1.0', () => {
    expect(TOOL_RESULT_SCHEMA_VERSION).toBe('1.0');
  });
});

// ═════════════════════════════════════════════════════════════════════
// 4. Named Schemas (no inline drift)
// ═════════════════════════════════════════════════════════════════════

describe('Named schema correctness', () => {
  it('V014: ParseCsvInputSchema accepts valid input', () => {
    const result = ParseCsvInputSchema.safeParse({
      csvContent: 'a,b\n1,2',
      delimiter: ','
    });
    expect(result.success).toBe(true);
  });

  it('V015: ParseCsvInputSchema rejects empty csvContent', () => {
    const result = ParseCsvInputSchema.safeParse({
      csvContent: '',
      delimiter: ','
    });
    expect(result.success).toBe(false);
  });

  it('V016: MapBrokerFieldsInputSchema accepts valid input', () => {
    const result = MapBrokerFieldsInputSchema.safeParse({
      headers: ['Date', 'Symbol'],
      sampleRows: [{ Date: '2023-01-15', Symbol: 'MSFT' }]
    });
    expect(result.success).toBe(true);
  });

  it('V017: MapBrokerFieldsInputSchema rejects empty headers', () => {
    const result = MapBrokerFieldsInputSchema.safeParse({
      headers: [],
      sampleRows: [{ Date: '2023-01-15' }]
    });
    expect(result.success).toBe(false);
  });

  it('V018: ValidateTransactionsInputSchema accepts valid input', () => {
    const result = ValidateTransactionsInputSchema.safeParse({
      activities: [VALID_ACTIVITY]
    });
    expect(result.success).toBe(true);
  });

  it('V019: ValidateTransactionsInputSchema rejects empty activities', () => {
    const result = ValidateTransactionsInputSchema.safeParse({
      activities: []
    });
    expect(result.success).toBe(false);
  });

  it('V020: NormalizeActivitiesInputSchema accepts valid input', () => {
    const result = NormalizeActivitiesInputSchema.safeParse({
      activities: [VALID_ACTIVITY],
      accountId: 'acc-123'
    });
    expect(result.success).toBe(true);
  });

  it('V021: DetectBrokerFormatInputSchema has describe metadata for LLM', () => {
    // Verify the schemas have descriptions (needed for AI SDK tool params)
    const shape = DetectBrokerFormatInputSchema.shape;
    expect(shape.headers.description).toBeDefined();
    expect(shape.sampleRows.description).toBeDefined();
  });

  it('V022: all 6 output schemas are Zod schemas', () => {
    const schemas = [
      ParseCsvOutputSchema,
      DetectBrokerFormatOutputSchema,
      MapBrokerFieldsOutputSchema,
      ValidateTransactionsOutputSchema,
      NormalizeActivitiesOutputSchema,
      GenerateImportPreviewOutputSchema
    ];

    for (const schema of schemas) {
      expect(schema).toBeDefined();
      expect(schema.safeParse).toBeDefined();
      expect(typeof schema.safeParse).toBe('function');
    }
  });
});
