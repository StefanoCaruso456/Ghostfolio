import { parse as csvToJson } from 'papaparse';

import { ParseCsvInput, ParseCsvOutput } from '../schemas/parse-csv.schema';
import { createVerificationResult } from '../schemas/verification.schema';

export function parseCsv(input: ParseCsvInput): ParseCsvOutput {
  const { csvContent, delimiter } = input;

  if (!csvContent || csvContent.trim().length === 0) {
    return {
      status: 'error',
      data: {
        rows: [],
        headers: [],
        rowCount: 0,
        errors: [{ row: 0, message: 'CSV content is empty' }]
      },
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: ['CSV content is empty'],
        sources: ['papaparse']
      })
    };
  }

  const result = csvToJson(csvContent, {
    delimiter,
    dynamicTyping: true,
    header: true,
    skipEmptyLines: true
  });

  const parseErrors = (result.errors || []).map((error) => ({
    row: error.row ?? 0,
    message: error.message
  }));

  const headers = result.meta?.fields || [];
  const rows = result.data as Record<string, unknown>[];
  const rowCount = rows.length;

  if (headers.length === 0) {
    return {
      status: 'error',
      data: {
        rows: [],
        headers: [],
        rowCount: 0,
        errors: [{ row: 0, message: 'No headers detected in CSV' }]
      },
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: ['No headers detected in CSV'],
        sources: ['papaparse']
      })
    };
  }

  if (rowCount === 0) {
    return {
      status: 'error',
      data: {
        rows: [],
        headers,
        rowCount: 0,
        errors: [{ row: 0, message: 'CSV contains headers but no data rows' }]
      },
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: ['CSV contains headers but no data rows'],
        sources: ['papaparse']
      })
    };
  }

  const confidence =
    parseErrors.length === 0
      ? 1.0
      : Math.max(0, 1 - parseErrors.length / rowCount);

  const warnings = parseErrors.map((e) => `Row ${e.row}: ${e.message}`);

  return {
    status: 'success',
    data: {
      rows,
      headers,
      rowCount,
      errors: parseErrors
    },
    verification: createVerificationResult({
      passed: rowCount > 0,
      confidence,
      warnings,
      sources: ['papaparse']
    })
  };
}
