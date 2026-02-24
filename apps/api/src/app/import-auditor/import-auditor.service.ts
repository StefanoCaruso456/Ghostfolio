import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import {
  PROPERTY_API_KEY_OPENROUTER,
  PROPERTY_OPENROUTER_MODEL
} from '@ghostfolio/common/config';

import { Injectable, Logger } from '@nestjs/common';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, tool } from 'ai';
import { z } from 'zod';

import { MappedActivitySchema } from './schemas/validate-transactions.schema';
import type { VerificationResult } from './schemas/verification.schema';
import { mapBrokerFields } from './tools/map-broker-fields.tool';
import { parseCsv } from './tools/parse-csv.tool';
import { validateTransactions } from './tools/validate-transactions.tool';

interface SessionData {
  csvContent?: string;
  lastAccessedAt: number;
  messages: { role: 'user' | 'assistant'; content: string }[];
  toolResults: Record<string, unknown>;
}

interface ToolCallRecord {
  tool: string;
  status: string;
  verification: VerificationResult;
  durationMs: number;
}

interface ChatResponse {
  sessionId: string;
  response: string;
  toolCalls: ToolCallRecord[];
  canCommit: boolean;
  stateHash?: string;
}

const MAX_ITERATIONS = 10;
const TIMEOUT_MS = 45_000;
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_SESSIONS = 100;

@Injectable()
export class ImportAuditorService {
  private readonly logger = new Logger(ImportAuditorService.name);
  private readonly sessions = new Map<string, SessionData>();

  public constructor(
    private readonly propertyService: PropertyService
  ) {}

  public getHealth(): { status: string } {
    return { status: 'OK' };
  }

  public async chat({
    csvContent,
    message,
    sessionId
  }: {
    csvContent?: string;
    message: string;
    sessionId: string;
    userId: string;
  }): Promise<ChatResponse> {
    // Clean up expired sessions before processing
    this.cleanupExpiredSessions();

    // Initialize or retrieve session
    let session = this.sessions.get(sessionId);

    if (!session) {
      session = {
        lastAccessedAt: Date.now(),
        messages: [],
        toolResults: {}
      };
      this.sessions.set(sessionId, session);
    } else {
      session.lastAccessedAt = Date.now();
    }

    // Store CSV content if provided
    if (csvContent) {
      session.csvContent = csvContent;
    }

    // Add user message to history
    session.messages.push({ role: 'user', content: message });

    const toolCallRecords: ToolCallRecord[] = [];
    let canCommit = false;
    let stateHash: string | undefined;

    try {
      const openRouterApiKey =
        await this.propertyService.getByKey<string>(
          PROPERTY_API_KEY_OPENROUTER
        );

      const openRouterModel =
        await this.propertyService.getByKey<string>(
          PROPERTY_OPENROUTER_MODEL
        );

      if (!openRouterApiKey || !openRouterModel) {
        const response =
          'The AI service is not configured. Please set the OpenRouter API key and model in the admin settings.';

        session.messages.push({
          role: 'assistant',
          content: response
        });

        return {
          sessionId,
          response,
          toolCalls: [],
          canCommit: false
        };
      }

      const openRouterService = createOpenRouter({
        apiKey: openRouterApiKey
      });

      const systemPrompt = this.buildSystemPrompt(session);

      // Create a timeout with proper cleanup
      let timeoutId: ReturnType<typeof setTimeout>;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(new Error('Request timed out after 45 seconds')),
          TIMEOUT_MS
        );
      });

      const generatePromise = generateText({
        maxSteps: MAX_ITERATIONS,
        model: openRouterService.chat(openRouterModel),
        messages: [
          { role: 'system', content: systemPrompt },
          ...session.messages
        ],
        tools: {
          parseCSV: tool({
            description:
              'Parse raw CSV content into structured rows with headers. Use this when the user provides a CSV file or asks to import/parse a CSV.',
            parameters: z.object({
              csvContent: z
                .string()
                .describe('The raw CSV content to parse'),
              delimiter: z
                .enum([',', ';', '\t', '|'])
                .default(',')
                .describe('CSV delimiter character')
            }),
            execute: async (args) => {
              const start = Date.now();
              const result = parseCsv({
                csvContent: args.csvContent,
                delimiter: args.delimiter
              });
              const durationMs = Date.now() - start;

              toolCallRecords.push({
                tool: 'parseCSV',
                status: result.status,
                verification: result.verification,
                durationMs
              });

              session.toolResults['parseCSV'] = result;

              return result;
            }
          }),
          mapBrokerFields: tool({
            description:
              'Map CSV column headers to Ghostfolio activity fields using deterministic matching. Use this after parsing CSV to identify which columns correspond to date, symbol, quantity, price, etc.',
            parameters: z.object({
              headers: z
                .array(z.string())
                .describe('CSV column headers to map'),
              sampleRows: z
                .array(z.record(z.unknown()))
                .min(1)
                .max(5)
                .describe('1-5 sample data rows for context'),
              brokerHint: z
                .string()
                .optional()
                .describe(
                  'Optional hint about the broker (e.g., "Interactive Brokers")'
                )
            }),
            execute: async (args) => {
              const start = Date.now();
              const result = mapBrokerFields({
                headers: args.headers,
                sampleRows: args.sampleRows,
                brokerHint: args.brokerHint
              });
              const durationMs = Date.now() - start;

              toolCallRecords.push({
                tool: 'mapBrokerFields',
                status: result.status,
                verification: result.verification,
                durationMs
              });

              session.toolResults['mapBrokerFields'] = result;

              return result;
            }
          }),
          validateTransactions: tool({
            description:
              'Validate mapped activities against financial rules: required fields, valid types, numeric invariants (fee >= 0, quantity >= 0), date validity, and currency codes. Use this after mapping broker fields.',
            parameters: z.object({
              activities: z
                .array(MappedActivitySchema)
                .min(1)
                .describe('Array of mapped activities to validate')
            }),
            execute: async (args) => {
              const start = Date.now();
              const result = validateTransactions({
                activities: args.activities
              });
              const durationMs = Date.now() - start;

              toolCallRecords.push({
                tool: 'validateTransactions',
                status: result.status,
                verification: result.verification,
                durationMs
              });

              session.toolResults['validateTransactions'] = result;

              if (
                result.status === 'pass' ||
                result.status === 'warnings'
              ) {
                canCommit = true;
              }

              return result;
            }
          })
        }
      });

      try {
        const result = await Promise.race([
          generatePromise,
          timeoutPromise
        ]);

        const responseText =
          result.text ||
          'I processed your request. Check the tool results for details.';

        session.messages.push({
          role: 'assistant',
          content: responseText
        });

        return {
          sessionId,
          response: responseText,
          toolCalls: toolCallRecords,
          canCommit,
          stateHash
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Chat error for session ${sessionId}: ${errorMessage}`
      );

      const errorResponse = `I encountered an error: ${errorMessage}. Please try again.`;

      session.messages.push({
        role: 'assistant',
        content: errorResponse
      });

      return {
        sessionId,
        response: errorResponse,
        toolCalls: toolCallRecords,
        canCommit: false
      };
    }
  }

  private buildSystemPrompt(session: SessionData): string {
    const parts = [
      'You are the Ghostfolio CSV Import Auditor, a financial data validation assistant.',
      'You help users safely import broker CSV files into their Ghostfolio portfolio.',
      '',
      'Your capabilities:',
      '1. parseCSV - Parse raw CSV content into structured rows',
      '2. mapBrokerFields - Map CSV headers to Ghostfolio fields (date, symbol, quantity, price, fee, currency, type)',
      '3. validateTransactions - Validate activities against financial rules',
      '',
      'When a user provides a CSV file:',
      '1. First use parseCSV to parse the raw content',
      '2. Then use mapBrokerFields to map the headers to Ghostfolio fields',
      '3. Then use validateTransactions to check all activities are valid',
      '4. Report the results clearly, including any errors or warnings',
      '',
      'Important rules:',
      '- Always run all 3 tools in sequence when processing a CSV',
      '- After mapping fields, transform the raw rows into MappedActivity objects before validating',
      '- Be concise but thorough in your responses',
      '- Report validation errors and warnings clearly with row numbers',
      '- Never display raw CSV data in full, only summaries and specific issues'
    ];

    if (session.csvContent) {
      parts.push(
        '',
        `The user has uploaded a CSV file (${session.csvContent.length} characters).`,
        'When you need to parse it, pass the CSV content to the parseCSV tool.'
      );
    }

    return parts.join('\n');
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastAccessedAt > SESSION_TTL_MS) {
        this.sessions.delete(sessionId);
      }
    }

    // Hard cap: evict oldest sessions if over limit
    if (this.sessions.size > MAX_SESSIONS) {
      const sortedEntries = [...this.sessions.entries()].sort(
        (a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt
      );

      const toEvict = sortedEntries.slice(
        0,
        this.sessions.size - MAX_SESSIONS
      );

      for (const [sessionId] of toEvict) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
