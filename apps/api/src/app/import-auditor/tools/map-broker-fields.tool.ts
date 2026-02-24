import {
  FieldMapping,
  GHOSTFOLIO_TARGET_FIELDS,
  MapBrokerFieldsInput,
  MapBrokerFieldsOutput,
  REQUIRED_TARGET_FIELDS
} from '../schemas/map-broker-fields.schema';
import { createVerificationResult } from '../schemas/verification.schema';

/**
 * Known key arrays from the existing client-side CSV parser
 * (apps/client/src/app/services/import-activities.service.ts)
 */
const FIELD_KEY_MAP: Record<
  (typeof GHOSTFOLIO_TARGET_FIELDS)[number],
  string[]
> = {
  account: ['account', 'accountid'],
  comment: ['comment', 'note'],
  currency: ['ccy', 'currency', 'currencyprimary'],
  dataSource: ['datasource'],
  date: ['date', 'tradedate'],
  fee: ['commission', 'fee', 'ibcommission'],
  quantity: ['qty', 'quantity', 'shares', 'units'],
  symbol: ['code', 'symbol', 'ticker'],
  type: ['action', 'activitytype', 'buy/sell', 'type'],
  unitPrice: ['price', 'tradeprice', 'unitprice', 'value']
};

export function mapBrokerFields(
  input: MapBrokerFieldsInput
): MapBrokerFieldsOutput {
  const { headers, sampleRows } = input;

  if (!headers || headers.length === 0) {
    return {
      status: 'error',
      data: {
        mappings: [],
        unmappedHeaders: [],
        unmappedRequiredFields: [...REQUIRED_TARGET_FIELDS],
        overallConfidence: 0,
        explanation: 'No headers provided'
      },
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: ['No headers provided'],
        sources: ['deterministic-key-matching']
      })
    };
  }

  const mappings: FieldMapping[] = [];
  const mappedTargetFields = new Set<string>();
  const mappedSourceHeaders = new Set<string>();

  // Deterministic tier: lowercase match against known key arrays
  for (const header of headers) {
    const normalizedHeader = header.toLowerCase().trim();

    for (const [targetField, keys] of Object.entries(FIELD_KEY_MAP)) {
      if (
        keys.includes(normalizedHeader) &&
        !mappedTargetFields.has(targetField)
      ) {
        mappings.push({
          sourceHeader: header,
          targetField: targetField as (typeof GHOSTFOLIO_TARGET_FIELDS)[number],
          confidence: 1.0,
          transformRule: getTransformRule(targetField, sampleRows, header)
        });
        mappedTargetFields.add(targetField);
        mappedSourceHeaders.add(header);
        break;
      }
    }
  }

  const unmappedHeaders = headers.filter((h) => !mappedSourceHeaders.has(h));

  const unmappedRequiredFields = REQUIRED_TARGET_FIELDS.filter(
    (field) => !mappedTargetFields.has(field)
  );

  const totalRequired = REQUIRED_TARGET_FIELDS.length;
  const mappedRequired = totalRequired - unmappedRequiredFields.length;
  const overallConfidence =
    totalRequired > 0 ? mappedRequired / totalRequired : 0;

  const allRequiredMapped = unmappedRequiredFields.length === 0;

  const status = allRequiredMapped
    ? 'success'
    : mappings.length > 0
      ? 'partial'
      : 'error';

  const explanationParts: string[] = [];
  explanationParts.push(
    `Mapped ${mappings.length} of ${headers.length} headers to Ghostfolio fields.`
  );

  if (allRequiredMapped) {
    explanationParts.push('All required fields are mapped.');
  } else {
    explanationParts.push(
      `Missing required fields: ${unmappedRequiredFields.join(', ')}.`
    );
  }

  if (unmappedHeaders.length > 0) {
    explanationParts.push(
      `${unmappedHeaders.length} headers were not mapped: ${unmappedHeaders.slice(0, 5).join(', ')}${unmappedHeaders.length > 5 ? '...' : ''}`
    );
  }

  return {
    status,
    data: {
      mappings,
      unmappedHeaders,
      unmappedRequiredFields,
      overallConfidence,
      explanation: explanationParts.join(' ')
    },
    verification: createVerificationResult({
      passed: allRequiredMapped,
      confidence: overallConfidence,
      warnings:
        unmappedHeaders.length > 0
          ? [`${unmappedHeaders.length} headers not mapped`]
          : [],
      errors: unmappedRequiredFields.map(
        (f) => `Required field "${f}" could not be mapped`
      ),
      sources: ['deterministic-key-matching']
    })
  };
}

function getTransformRule(
  targetField: string,
  sampleRows: Record<string, unknown>[],
  sourceHeader: string
): string | undefined {
  switch (targetField) {
    case 'date':
      return 'parse as date string';
    case 'fee':
    case 'quantity':
    case 'unitPrice':
      return 'parse as number, take absolute value';
    case 'type': {
      const sampleValue = sampleRows[0]?.[sourceHeader];
      if (
        typeof sampleValue === 'string' &&
        sampleValue.toLowerCase() !== sampleValue
      ) {
        return 'normalize to uppercase enum (BUY, SELL, DIVIDEND, FEE, INTEREST, LIABILITY)';
      }
      return 'map to activity type enum';
    }
    case 'currency':
      return 'validate as 3-character currency code';
    default:
      return undefined;
  }
}
