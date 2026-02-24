import { z } from 'zod';

import { VerificationResultSchema } from './verification.schema';

/**
 * Standardized ToolResult — every tool MUST return this shape.
 *
 * Includes:
 * - status: "success" | "error"
 * - data: typed payload
 * - message: human-readable summary
 * - executionTimeMs: wall-clock execution duration
 * - error: structured error (code + message + optional details)
 * - verification: VerificationResult for high-stakes domains
 * - schemaVersion: contract version for forward compatibility
 */

/**
 * Schema version for all tool results.
 * Increment when the ToolResult contract changes to support
 * backward-compatible evolution without breaking clients/tests.
 */
export const TOOL_RESULT_SCHEMA_VERSION = '1.0';

export const ToolErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional()
});

export type ToolError = z.infer<typeof ToolErrorSchema>;

export const ToolResultSchema = z.object({
  status: z.enum(['success', 'error']),
  data: z.unknown().optional(),
  message: z.string(),
  executionTimeMs: z.number(),
  error: ToolErrorSchema.optional(),
  verification: VerificationResultSchema,
  schemaVersion: z.string().default(TOOL_RESULT_SCHEMA_VERSION)
});

export interface ToolResult<T = unknown> {
  status: 'success' | 'error';
  data?: T;
  message: string;
  executionTimeMs: number;
  error?: ToolError;
  verification: {
    passed: boolean;
    confidence: number;
    warnings: string[];
    errors: string[];
    sources: string[];
  };
  schemaVersion: string;
}

/**
 * Helper to create a success ToolResult.
 */
export function createSuccessResult<T>(
  data: T,
  message: string,
  executionTimeMs: number,
  verification: ToolResult['verification']
): ToolResult<T> {
  return {
    status: 'success',
    data,
    message,
    executionTimeMs,
    verification,
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION
  };
}

/**
 * Helper to create an error ToolResult.
 * Never throw raw exceptions — always convert to ToolResult(status="error").
 */
export function createErrorResult(
  errorCode: string,
  errorMessage: string,
  executionTimeMs: number,
  details?: unknown
): ToolResult<never> {
  return {
    status: 'error',
    message: errorMessage,
    executionTimeMs,
    error: {
      code: errorCode,
      message: errorMessage,
      details
    },
    verification: {
      passed: false,
      confidence: 0,
      warnings: [],
      errors: [errorMessage],
      sources: []
    },
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION
  };
}
