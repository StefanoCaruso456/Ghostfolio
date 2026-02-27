/**
 * Redaction utilities for the Reasoning Preview feature.
 *
 * Masks API keys, tokens, emails, addresses, auth headers.
 * Truncates large outputs to a configurable max size (default 5 KB).
 * Returns metadata indicating whether redaction was applied.
 */

/** Maximum detail payload size in bytes (5 KB) */
const MAX_DETAIL_BYTES = 5 * 1024;

/** Patterns to redact — order matters (most specific first) */
const REDACTION_PATTERNS: { label: string; pattern: RegExp }[] = [
  // Bearer / Authorization headers
  {
    label: 'auth_header',
    pattern:
      /(Authorization|Bearer|X-Api-Key|X-Auth-Token)\s*[:=]\s*["']?[A-Za-z0-9\-._~+/=]{8,}["']?/gi
  },
  // API keys (common formats: sk-, pk_, ghp_, gho_, key-, etc.)
  {
    label: 'api_key',
    pattern:
      /\b(sk|pk|ghp|gho|key|token|secret|apikey|api_key|access_token|refresh_token)[_-]?[A-Za-z0-9._-]{12,}\b/gi
  },
  // JWT tokens (three base64 segments separated by dots)
  {
    label: 'jwt',
    pattern:
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
  },
  // Email addresses
  {
    label: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g
  },
  // IP addresses (IPv4)
  {
    label: 'ipv4',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
  },
  // Credit card numbers (basic 13-19 digit sequences)
  {
    label: 'credit_card',
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7}\b/g
  },
  // US Social Security Numbers
  {
    label: 'ssn',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g
  },
  // US phone numbers
  {
    label: 'phone',
    pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g
  }
];

export interface RedactionResult {
  /** The redacted (and possibly truncated) text */
  text: string;
  /** Whether any redaction pattern matched */
  redactionApplied: boolean;
  /** Whether the output was truncated */
  truncated: boolean;
}

/**
 * Redact sensitive data and truncate to max size.
 */
export function redact(
  input: unknown,
  maxBytes: number = MAX_DETAIL_BYTES
): RedactionResult {
  let text: string;

  if (input === null || input === undefined) {
    return { text: '', redactionApplied: false, truncated: false };
  }

  if (typeof input === 'string') {
    text = input;
  } else {
    try {
      text = JSON.stringify(input, null, 2);
    } catch {
      text = String(input);
    }
  }

  let redactionApplied = false;

  for (const { pattern } of REDACTION_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      redactionApplied = true;
      pattern.lastIndex = 0;
      text = text.replace(pattern, '[REDACTED]');
    }
  }

  let truncated = false;

  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    // Binary search isn't needed — just slice characters conservatively
    while (Buffer.byteLength(text, 'utf8') > maxBytes - 30) {
      text = text.slice(0, Math.floor(text.length * 0.9));
    }

    text += '\n... [TRUNCATED]';
    truncated = true;
  }

  return { text, redactionApplied, truncated };
}

/**
 * Redact a record of key-value pairs (e.g. tool args).
 * Returns a new object with values redacted.
 */
export function redactRecord(
  record: Record<string, unknown> | undefined,
  maxBytes: number = MAX_DETAIL_BYTES
): { data: Record<string, unknown>; redactionApplied: boolean } {
  if (!record || typeof record !== 'object') {
    return { data: {}, redactionApplied: false };
  }

  const result: Record<string, unknown> = {};
  let anyRedaction = false;

  for (const [key, value] of Object.entries(record)) {
    const { text, redactionApplied } = redact(value, maxBytes);
    result[key] = text;

    if (redactionApplied) {
      anyRedaction = true;
    }
  }

  return { data: result, redactionApplied: anyRedaction };
}
