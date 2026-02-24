import {
  BrokerMatch,
  DetectBrokerFormatInput,
  DetectBrokerFormatOutput,
  KnownBroker
} from '../schemas/detect-broker-format.schema';
import { createVerificationResult } from '../schemas/verification.schema';

/**
 * Tool 4: Detect Broker Format
 *
 * Atomic: Single purpose — detect which broker produced the CSV.
 * Idempotent: Same input → same detection (deterministic pattern matching).
 * Documented: Each broker has explicit header signatures.
 * Error-handled: Returns structured errors, never throws.
 * Verified: Confidence scoring based on match ratio.
 */

interface BrokerSignature {
  broker: KnownBroker;
  /** Headers that MUST be present (lowercased) */
  requiredHeaders: string[];
  /** Headers that MAY be present (boost confidence) */
  optionalHeaders: string[];
  /** File name patterns */
  fileNamePatterns: RegExp[];
  /** Data patterns: field name → regex */
  dataPatterns: Record<string, RegExp>;
}

const BROKER_SIGNATURES: BrokerSignature[] = [
  {
    broker: 'interactive_brokers',
    requiredHeaders: [
      'currencyprimary',
      'symbol',
      'tradedate',
      'tradeprice',
      'quantity'
    ],
    optionalHeaders: ['ibcommission', 'buy/sell', 'accountid'],
    fileNamePatterns: [/ibkr/i, /interactive.?broker/i],
    dataPatterns: {
      tradedate: /^\d{8}$/ // YYYYMMDD format
    }
  },
  {
    broker: 'degiro',
    requiredHeaders: ['datum', 'produkt', 'isin'],
    optionalHeaders: [
      'börsenplatz',
      'ausführungskurs',
      'wert',
      'transaktionskosten'
    ],
    fileNamePatterns: [/degiro/i],
    dataPatterns: {}
  },
  {
    broker: 'trading212',
    requiredHeaders: ['action', 'time', 'ticker', 'price', 'no. of shares'],
    optionalHeaders: ['currency (price / share)', 'exchange rate', 'result'],
    fileNamePatterns: [/trading.?212/i],
    dataPatterns: {}
  },
  {
    broker: 'swissquote',
    requiredHeaders: ['date', 'order', 'symbol', 'quantity', 'price'],
    optionalHeaders: ['currency', 'commission', 'exchange'],
    fileNamePatterns: [/swissquote/i],
    dataPatterns: {}
  },
  {
    broker: 'ghostfolio',
    requiredHeaders: [
      'date',
      'code',
      'datasource',
      'currency',
      'price',
      'quantity',
      'action',
      'fee'
    ],
    optionalHeaders: ['note', 'account'],
    fileNamePatterns: [/ghostfolio/i],
    dataPatterns: {}
  }
];

export function detectBrokerFormat(
  input: DetectBrokerFormatInput
): DetectBrokerFormatOutput {
  const { headers, sampleRows, fileName } = input;

  if (!headers || headers.length === 0) {
    return {
      status: 'error',
      data: {
        detectedBroker: 'generic',
        confidence: 0,
        allMatches: [],
        explanation: 'No headers provided for broker detection'
      },
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: ['No headers provided'],
        sources: ['broker-pattern-matching'],
        verificationType: 'confidence_scoring'
      })
    };
  }

  const normalizedHeaders = headers.map((h) => h.toLowerCase().trim());
  const matches: BrokerMatch[] = [];

  for (const sig of BROKER_SIGNATURES) {
    const matchedSignatures: string[] = [];
    const unmatchedExpected: string[] = [];

    // Check required headers
    for (const reqHeader of sig.requiredHeaders) {
      if (normalizedHeaders.includes(reqHeader)) {
        matchedSignatures.push(`header:${reqHeader}`);
      } else {
        unmatchedExpected.push(`header:${reqHeader}`);
      }
    }

    // Check optional headers (boost confidence)
    let optionalMatches = 0;

    for (const optHeader of sig.optionalHeaders) {
      if (normalizedHeaders.includes(optHeader)) {
        matchedSignatures.push(`optional:${optHeader}`);
        optionalMatches++;
      }
    }

    // Check file name patterns
    if (fileName) {
      for (const pattern of sig.fileNamePatterns) {
        if (pattern.test(fileName)) {
          matchedSignatures.push(`filename:${pattern.source}`);
        }
      }
    }

    // Check data patterns
    if (sampleRows.length > 0) {
      for (const [field, pattern] of Object.entries(sig.dataPatterns)) {
        const value = String(sampleRows[0][field] ?? '');

        if (pattern.test(value)) {
          matchedSignatures.push(`data:${field}`);
        }
      }
    }

    // Calculate confidence
    const requiredMatchRatio =
      sig.requiredHeaders.length > 0
        ? (sig.requiredHeaders.length - unmatchedExpected.length) /
          sig.requiredHeaders.length
        : 0;

    const optionalBoost =
      sig.optionalHeaders.length > 0
        ? (optionalMatches / sig.optionalHeaders.length) * 0.1
        : 0;

    const fileNameBoost = matchedSignatures.some((s) =>
      s.startsWith('filename:')
    )
      ? 0.1
      : 0;

    const confidence = Math.min(
      1.0,
      requiredMatchRatio * 0.8 + optionalBoost + fileNameBoost
    );

    if (matchedSignatures.length > 0) {
      matches.push({
        broker: sig.broker,
        confidence,
        matchedSignatures,
        unmatchedExpected
      });
    }
  }

  // Sort by confidence descending
  matches.sort((a, b) => b.confidence - a.confidence);

  const bestMatch = matches[0];
  const detectedBroker: KnownBroker =
    bestMatch?.confidence >= 0.5 ? bestMatch.broker : 'generic';
  const confidence = bestMatch?.confidence ?? 0;

  const explanation =
    detectedBroker === 'generic'
      ? `Could not confidently detect broker format. Best guess: ${bestMatch?.broker ?? 'none'} (confidence: ${(confidence * 100).toFixed(0)}%). Using generic format.`
      : `Detected ${detectedBroker} format with ${(confidence * 100).toFixed(0)}% confidence. Matched signatures: ${bestMatch.matchedSignatures.join(', ')}.`;

  // Hallucination detection: if the model claims a specific broker but
  // confidence is below the hallucination threshold, flag it.
  // This is a real check — not schema-only.
  const HALLUCINATION_CONFIDENCE_THRESHOLD = 0.6;
  const hallucinationFlags: string[] = [];

  if (
    detectedBroker !== 'generic' &&
    confidence < HALLUCINATION_CONFIDENCE_THRESHOLD
  ) {
    hallucinationFlags.push(
      `Broker "${detectedBroker}" detected with only ${(confidence * 100).toFixed(0)}% confidence — may be hallucinated`
    );
  }

  // If we fell back to generic but had a best guess, that's also a risk
  if (detectedBroker === 'generic' && bestMatch && bestMatch.confidence > 0) {
    hallucinationFlags.push(
      `No confident broker match. Best guess "${bestMatch.broker}" at ${(bestMatch.confidence * 100).toFixed(0)}% is below threshold`
    );
  }

  const requiresHumanReview = confidence < 0.5 || hallucinationFlags.length > 0;

  return {
    status: 'success',
    data: {
      detectedBroker,
      confidence,
      allMatches: matches,
      explanation
    },
    verification: createVerificationResult({
      passed: confidence >= 0.5,
      confidence,
      warnings:
        confidence < 0.7
          ? ['Low confidence broker detection — review mappings carefully']
          : [],
      sources: ['broker-pattern-matching'],
      verificationType: 'confidence_scoring',
      hallucinationFlags:
        hallucinationFlags.length > 0 ? hallucinationFlags : undefined,
      allClaimsSupported: hallucinationFlags.length === 0,
      requiresHumanReview,
      escalationReason: requiresHumanReview
        ? hallucinationFlags.length > 0
          ? `Hallucination risk: ${hallucinationFlags.join('; ')}`
          : 'Broker format could not be confidently detected'
        : undefined
    })
  };
}
