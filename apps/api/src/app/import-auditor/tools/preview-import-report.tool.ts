import type {
  PreviewImportReportInput,
  PreviewImportReportOutput
} from '../schemas/preview-import-report.schema';
import { createVerificationResult } from '../schemas/verification.schema';

export function previewImportReport(
  input: PreviewImportReportInput
): PreviewImportReportOutput {
  const { activities, warningsCount = 0, errorsCount = 0 } = input;

  if (!activities || activities.length === 0) {
    return {
      status: 'error',
      data: {
        totalCount: 0,
        typeBreakdown: [],
        dateRange: { earliest: '', latest: '' },
        currencies: [],
        estimatedTotalValue: 0,
        warningsCount,
        errorsCount,
        summary: 'No activities to preview.'
      },
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: ['No activities provided'],
        sources: ['preview-import-report']
      })
    };
  }

  // Count by type and calculate estimated values
  const typeMap = new Map<string, { count: number; estimatedValue: number }>();

  for (const activity of activities) {
    const type = (activity.type ?? 'UNKNOWN').toUpperCase();
    const existing = typeMap.get(type) ?? { count: 0, estimatedValue: 0 };
    const quantity = activity.quantity ?? 0;
    const unitPrice = activity.unitPrice ?? 0;

    existing.count++;
    existing.estimatedValue += quantity * unitPrice;
    typeMap.set(type, existing);
  }

  const typeBreakdown = [...typeMap.entries()].map(([type, data]) => ({
    type,
    count: data.count,
    estimatedValue: Math.round(data.estimatedValue * 100) / 100
  }));

  // Find date range
  const validDates = activities
    .map((a) => a.date)
    .filter((d): d is string => d != null && d.length > 0)
    .sort();

  const dateRange = {
    earliest: validDates[0] ?? '',
    latest: validDates[validDates.length - 1] ?? ''
  };

  // Collect unique currencies
  const currencies = [
    ...new Set(
      activities
        .map((a) => a.currency)
        .filter((c): c is string => c != null && c.length > 0)
    )
  ].sort();

  // Calculate total estimated value
  const estimatedTotalValue =
    Math.round(
      typeBreakdown.reduce((sum, tb) => sum + tb.estimatedValue, 0) * 100
    ) / 100;

  // Generate summary
  const summaryParts: string[] = [];
  summaryParts.push(
    `${activities.length} activit${activities.length === 1 ? 'y' : 'ies'} ready for import.`
  );

  const typeDescriptions = typeBreakdown
    .map((tb) => `${tb.count} ${tb.type}`)
    .join(', ');
  summaryParts.push(`Types: ${typeDescriptions}.`);

  if (currencies.length > 0) {
    summaryParts.push(
      `Currenc${currencies.length === 1 ? 'y' : 'ies'}: ${currencies.join(', ')}.`
    );
  }

  if (dateRange.earliest && dateRange.latest) {
    if (dateRange.earliest === dateRange.latest) {
      summaryParts.push(`Date: ${dateRange.earliest}.`);
    } else {
      summaryParts.push(
        `Date range: ${dateRange.earliest} to ${dateRange.latest}.`
      );
    }
  }

  summaryParts.push(
    `Estimated total value: ${estimatedTotalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`
  );

  if (warningsCount > 0) {
    summaryParts.push(`${warningsCount} warning(s).`);
  }

  if (errorsCount > 0) {
    summaryParts.push(`${errorsCount} error(s).`);
  }

  const warnings: string[] = [];

  if (warningsCount > 0) {
    warnings.push(`${warningsCount} warning(s) from validation`);
  }

  if (errorsCount > 0) {
    warnings.push(`${errorsCount} error(s) from validation`);
  }

  return {
    status: 'success',
    data: {
      totalCount: activities.length,
      typeBreakdown,
      dateRange,
      currencies,
      estimatedTotalValue,
      warningsCount,
      errorsCount,
      summary: summaryParts.join(' ')
    },
    verification: createVerificationResult({
      passed: true,
      confidence: 1.0,
      warnings,
      sources: ['preview-import-report']
    })
  };
}
