import { ImportService } from '@ghostfolio/api/app/import/import.service';
import { OrderService } from '@ghostfolio/api/app/order/order.service';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import {
  PROPERTY_API_KEY_OPENROUTER,
  PROPERTY_OPENROUTER_MODEL
} from '@ghostfolio/common/config';
import type { UserWithSettings } from '@ghostfolio/common/types';

import { Injectable, Logger } from '@nestjs/common';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, tool } from 'ai';
import { z } from 'zod';

import {
  BraintrustTelemetryService,
  TraceContext
} from '../endpoints/ai/telemetry/braintrust-telemetry.service';
import type { ExistingActivity } from './schemas/detect-duplicates.schema';
import { MappedActivitySchema } from './schemas/validate-transactions.schema';
import type { VerificationResult } from './schemas/verification.schema';
import { transformToCreateOrderDtos } from './tools/commit-import.tool';
import { detectDuplicates } from './tools/detect-duplicates.tool';
import {
  mapBrokerFieldsWithFallback,
  type LlmMappingResult
} from './tools/map-broker-fields.tool';
import { parseCsv } from './tools/parse-csv.tool';
import { previewImportReport } from './tools/preview-import-report.tool';
import { validateTransactions } from './tools/validate-transactions.tool';

interface SessionData {
  csvContent?: string;
  lastAccessedAt: number;
  messages: { role: 'user' | 'assistant'; content: string }[];
  toolResults: Record<string, unknown>;
  user?: UserWithSettings;
  userId: string;
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
    private readonly configurationService: ConfigurationService,
    private readonly importService: ImportService,
    private readonly orderService: OrderService,
    private readonly propertyService: PropertyService,
    private readonly telemetryService: BraintrustTelemetryService
  ) {}

  public getHealth(): { status: string } {
    return { status: 'OK' };
  }

  public async chat({
    csvContent,
    message,
    sessionId,
    user
  }: {
    csvContent?: string;
    message: string;
    sessionId: string;
    user: UserWithSettings;
  }): Promise<ChatResponse> {
    // Clean up expired sessions before processing
    this.cleanupExpiredSessions();

    // Initialize or retrieve session
    let session = this.sessions.get(sessionId);

    if (!session) {
      session = {
        lastAccessedAt: Date.now(),
        messages: [],
        toolResults: {},
        user,
        userId: user.id
      };
      this.sessions.set(sessionId, session);
    } else {
      session.lastAccessedAt = Date.now();
      session.user = user;
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
    let toolCallIndex = 0;

    // Resolve model first — needed for telemetry trace
    const openRouterApiKey = await this.propertyService.getByKey<string>(
      PROPERTY_API_KEY_OPENROUTER
    );

    const openRouterModel = await this.propertyService.getByKey<string>(
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

    // Braintrust telemetry — degradation-safe (no API key → no-op)
    const traceCtx: TraceContext = this.telemetryService.startTrace({
      sessionId,
      userId: user.id,
      queryText: message,
      model: openRouterModel
    });

    try {
      const openRouterService = createOpenRouter({
        apiKey: openRouterApiKey
      });

      const systemPrompt = this.buildSystemPrompt(session);

      // Create a timeout with proper cleanup
      let timeoutId: ReturnType<typeof setTimeout>;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Request timed out after 45 seconds')),
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
              csvContent: z.string().describe('The raw CSV content to parse'),
              delimiter: z
                .enum([',', ';', '\t', '|'])
                .default(',')
                .describe('CSV delimiter character')
            }),
            execute: async (args) => {
              const spanBuilder = traceCtx.startToolSpan(
                'parseCSV',
                {
                  delimiter: args.delimiter,
                  contentLength: args.csvContent.length
                },
                toolCallIndex++
              );
              const start = Date.now();
              const result = parseCsv({
                csvContent: args.csvContent,
                delimiter: args.delimiter
              });
              const durationMs = Date.now() - start;

              const toolSpan = spanBuilder.end({
                status: result.status === 'error' ? 'error' : 'success',
                toolOutput: {
                  status: result.status,
                  rowCount: result.data?.rowCount
                }
              });
              traceCtx.addToolSpan(toolSpan);

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
              'Map CSV column headers to Ghostfolio activity fields. Uses deterministic matching first, then LLM inference for unknown headers. Use this after parsing CSV to identify which columns correspond to date, symbol, quantity, price, etc.',
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
                ),
              useLlmFallback: z
                .boolean()
                .default(true)
                .describe(
                  'If true and deterministic matching is partial, use LLM to infer remaining field mappings'
                )
            }),
            execute: async (args) => {
              const spanBuilder = traceCtx.startToolSpan(
                'mapBrokerFields',
                {
                  headerCount: args.headers.length,
                  useLlmFallback: args.useLlmFallback
                },
                toolCallIndex++
              );
              const start = Date.now();
              const result = await mapBrokerFieldsWithFallback({
                headers: args.headers,
                sampleRows: args.sampleRows,
                brokerHint: args.brokerHint,
                useLlmFallback: args.useLlmFallback,
                llmMapper: async (context) => {
                  const prompt = [
                    'You are a CSV column mapping specialist for financial data.',
                    'Map the following unmapped CSV column headers to Ghostfolio target fields.',
                    '',
                    `Unmapped headers: ${JSON.stringify(context.unmappedHeaders)}`,
                    `Sample data: ${JSON.stringify(context.sampleRows.slice(0, 2))}`,
                    `Required unmapped fields: ${JSON.stringify(context.unmappedRequiredFields)}`,
                    `Already mapped: ${context.existingMappings.map((m) => `${m.sourceHeader} → ${m.targetField}`).join(', ')}`,
                    '',
                    'Valid target fields: currency, date, fee, quantity, symbol, type, unitPrice, account, comment, dataSource',
                    '',
                    'Respond ONLY with valid JSON: { "mappings": [{ "sourceHeader": "...", "targetField": "...", "confidence": 0.0-1.0, "reasoning": "..." }] }',
                    'Only include mappings you are confident about. Do not guess.'
                  ].join('\n');

                  const llmResponse = await generateText({
                    model: openRouterService.chat(openRouterModel),
                    messages: [
                      {
                        role: 'user',
                        content: prompt
                      }
                    ],
                    maxSteps: 1
                  });

                  try {
                    const parsed = JSON.parse(
                      llmResponse.text
                    ) as LlmMappingResult;
                    return parsed;
                  } catch {
                    return { mappings: [] };
                  }
                }
              });
              const durationMs = Date.now() - start;

              const mapSpan = spanBuilder.end({
                status: result.status === 'error' ? 'error' : 'success',
                toolOutput: {
                  status: result.status,
                  mappingCount: result.data?.mappings?.length
                }
              });
              traceCtx.addToolSpan(mapSpan);

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
              const spanBuilder = traceCtx.startToolSpan(
                'validateTransactions',
                { activityCount: args.activities.length },
                toolCallIndex++
              );
              const start = Date.now();
              const result = validateTransactions({
                activities: args.activities
              });
              const durationMs = Date.now() - start;

              const valSpan = spanBuilder.end({
                status: result.status === 'fail' ? 'error' : 'success',
                toolOutput: { status: result.status }
              });
              traceCtx.addToolSpan(valSpan);

              toolCallRecords.push({
                tool: 'validateTransactions',
                status: result.status,
                verification: result.verification,
                durationMs
              });

              session.toolResults['validateTransactions'] = result;

              if (result.status === 'pass' || result.status === 'warnings') {
                canCommit = true;
              }

              return result;
            }
          }),
          detectDuplicates: tool({
            description:
              "Detect duplicate activities within the CSV batch and optionally against the user's existing portfolio. Use this after validation to check for duplicates before importing.",
            parameters: z.object({
              activities: z
                .array(MappedActivitySchema)
                .min(1)
                .describe('Array of mapped activities to check'),
              checkDatabase: z
                .boolean()
                .default(true)
                .describe(
                  'If true, also check against existing activities in the database'
                )
            }),
            execute: async (args) => {
              const spanBuilder = traceCtx.startToolSpan(
                'detectDuplicates',
                {
                  activityCount: args.activities.length,
                  checkDatabase: args.checkDatabase
                },
                toolCallIndex++
              );
              const start = Date.now();

              let existingActivities: ExistingActivity[] = [];

              if (args.checkDatabase && session.userId) {
                try {
                  const userCurrency =
                    session.user?.settings?.settings?.baseCurrency ?? 'USD';

                  const { activities: dbActivities } =
                    await this.orderService.getOrders({
                      userCurrency,
                      userId: session.userId,
                      includeDrafts: true,
                      withExcludedAccountsAndActivities: true
                    });

                  existingActivities = dbActivities.map((a) => ({
                    accountId: a.accountId,
                    comment: a.comment,
                    currency: a.currency ?? a.SymbolProfile?.currency ?? null,
                    dataSource: a.SymbolProfile?.dataSource ?? null,
                    date: a.date.toISOString(),
                    fee: a.fee,
                    quantity: a.quantity,
                    symbol: a.SymbolProfile?.symbol ?? '',
                    type: a.type,
                    unitPrice: a.unitPrice
                  }));
                } catch (error) {
                  this.logger.warn(
                    `Failed to fetch existing activities: ${error instanceof Error ? error.message : String(error)}`
                  );
                }
              }

              const result = detectDuplicates({
                activities: args.activities,
                existingActivities
              });
              const durationMs = Date.now() - start;

              const dupSpan = spanBuilder.end({
                status: result.status === 'error' ? 'error' : 'success',
                toolOutput: {
                  status: result.status,
                  duplicatesFound:
                    result.data?.batchDuplicatesFound +
                    result.data?.databaseDuplicatesFound
                }
              });
              traceCtx.addToolSpan(dupSpan);

              toolCallRecords.push({
                tool: 'detectDuplicates',
                status: result.status,
                verification: result.verification,
                durationMs
              });

              session.toolResults['detectDuplicates'] = result;

              return result;
            }
          }),
          previewImportReport: tool({
            description:
              'Generate a human-readable import preview report showing activity counts, type breakdown, date range, currencies, and estimated total value. Use this before committing to show the user what will be imported.',
            parameters: z.object({
              activities: z
                .array(MappedActivitySchema)
                .min(1)
                .describe('Array of validated activities to preview'),
              warningsCount: z
                .number()
                .default(0)
                .describe('Number of warnings from validation'),
              errorsCount: z
                .number()
                .default(0)
                .describe('Number of errors from validation')
            }),
            execute: async (args) => {
              const spanBuilder = traceCtx.startToolSpan(
                'previewImportReport',
                { activityCount: args.activities.length },
                toolCallIndex++
              );
              const start = Date.now();
              const result = previewImportReport({
                activities: args.activities,
                warningsCount: args.warningsCount,
                errorsCount: args.errorsCount
              });
              const durationMs = Date.now() - start;

              const previewSpan = spanBuilder.end({
                status: result.status === 'error' ? 'error' : 'success',
                toolOutput: {
                  status: result.status,
                  totalCount: result.data?.totalCount
                }
              });
              traceCtx.addToolSpan(previewSpan);

              toolCallRecords.push({
                tool: 'previewImportReport',
                status: result.status,
                verification: result.verification,
                durationMs
              });

              session.toolResults['previewImportReport'] = result;

              return result;
            }
          }),
          commitImport: tool({
            description:
              'Commit validated activities to the Ghostfolio portfolio. IMPORTANT: Only use this after the user has explicitly confirmed they want to import. Supports dry-run mode to preview without saving.',
            parameters: z.object({
              activities: z
                .array(MappedActivitySchema)
                .min(1)
                .describe('Array of validated activities to import'),
              isDryRun: z
                .boolean()
                .default(false)
                .describe(
                  'If true, simulate the import without saving to the database'
                )
            }),
            execute: async (args) => {
              const commitSpanBuilder = traceCtx.startToolSpan(
                'commitImport',
                {
                  activityCount: args.activities.length,
                  isDryRun: args.isDryRun
                },
                toolCallIndex++
              );
              const start = Date.now();

              try {
                if (!session.user) {
                  const durationMs = Date.now() - start;

                  const errorResult = {
                    status: 'error' as const,
                    data: {
                      importedCount: 0,
                      skippedCount: args.activities.length,
                      errors: [{ row: 0, message: 'User session not found' }],
                      isDryRun: args.isDryRun
                    },
                    verification: {
                      passed: false,
                      confidence: 0,
                      warnings: [] as string[],
                      errors: ['User session not found'],
                      sources: ['commit-import'] as string[]
                    }
                  };

                  traceCtx.addToolSpan(
                    commitSpanBuilder.end({
                      status: 'error',
                      toolOutput: { status: 'error' },
                      error: 'User session not found'
                    })
                  );

                  toolCallRecords.push({
                    tool: 'commitImport',
                    status: 'error',
                    verification: errorResult.verification,
                    durationMs
                  });

                  return errorResult;
                }

                const { orders, errors: transformErrors } =
                  transformToCreateOrderDtos(args.activities);

                if (orders.length === 0) {
                  const durationMs = Date.now() - start;

                  const errorResult = {
                    status: 'error' as const,
                    data: {
                      importedCount: 0,
                      skippedCount: args.activities.length,
                      errors: transformErrors,
                      isDryRun: args.isDryRun
                    },
                    verification: {
                      passed: false,
                      confidence: 0,
                      warnings: [] as string[],
                      errors: transformErrors.map((e) => e.message),
                      sources: ['commit-import'] as string[]
                    }
                  };

                  traceCtx.addToolSpan(
                    commitSpanBuilder.end({
                      status: 'error',
                      toolOutput: { status: 'error' },
                      error: 'No valid orders after transformation'
                    })
                  );

                  toolCallRecords.push({
                    tool: 'commitImport',
                    status: 'error',
                    verification: errorResult.verification,
                    durationMs
                  });

                  return errorResult;
                }

                const maxActivitiesToImport = this.configurationService.get(
                  'MAX_ACTIVITIES_TO_IMPORT'
                );

                const importedActivities = await this.importService.import({
                  activitiesDto: orders,
                  isDryRun: args.isDryRun,
                  maxActivitiesToImport,
                  user: session.user,
                  accountsWithBalancesDto: [],
                  assetProfilesWithMarketDataDto: [],
                  tagsDto: []
                });

                const durationMs = Date.now() - start;
                const importedCount = importedActivities.length;
                const skippedCount = args.activities.length - importedCount;

                const status =
                  transformErrors.length > 0
                    ? 'partial'
                    : importedCount > 0
                      ? 'success'
                      : 'error';

                const result = {
                  status: status as 'success' | 'partial' | 'error',
                  data: {
                    importedCount,
                    skippedCount,
                    errors: transformErrors,
                    isDryRun: args.isDryRun
                  },
                  verification: {
                    passed: importedCount > 0,
                    confidence: importedCount / args.activities.length,
                    warnings: args.isDryRun
                      ? ['Dry run mode - no changes were saved']
                      : ([] as string[]),
                    errors: transformErrors.map((e) => e.message),
                    sources: ['commit-import'] as string[]
                  }
                };

                traceCtx.addToolSpan(
                  commitSpanBuilder.end({
                    status: result.status === 'error' ? 'error' : 'success',
                    toolOutput: { status: result.status, importedCount }
                  })
                );

                toolCallRecords.push({
                  tool: 'commitImport',
                  status: result.status,
                  verification: result.verification,
                  durationMs
                });

                session.toolResults['commitImport'] = result;

                return result;
              } catch (error) {
                const durationMs = Date.now() - start;
                const errorMessage =
                  error instanceof Error ? error.message : String(error);

                const errorResult = {
                  status: 'error' as const,
                  data: {
                    importedCount: 0,
                    skippedCount: args.activities.length,
                    errors: [{ row: 0, message: errorMessage }],
                    isDryRun: args.isDryRun
                  },
                  verification: {
                    passed: false,
                    confidence: 0,
                    warnings: [] as string[],
                    errors: [errorMessage],
                    sources: ['commit-import'] as string[]
                  }
                };

                traceCtx.addToolSpan(
                  commitSpanBuilder.end({
                    status: 'error',
                    toolOutput: { status: 'error' },
                    error: errorMessage
                  })
                );

                toolCallRecords.push({
                  tool: 'commitImport',
                  status: 'error',
                  verification: errorResult.verification,
                  durationMs
                });

                return errorResult;
              }
            }
          })
        }
      });

      traceCtx.markLlmStart();

      try {
        const result = await Promise.race([generatePromise, timeoutPromise]);

        traceCtx.markLlmEnd();

        const responseText =
          result.text ||
          'I processed your request. Check the tool results for details.';

        // Record token usage and response in trace context
        if (result.usage) {
          traceCtx.setTokens(
            result.usage.promptTokens,
            result.usage.completionTokens
          );
        }

        traceCtx.setResponse(responseText);
        traceCtx.setIterationCount(toolCallIndex);
        traceCtx.setQueryCategory('general');

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

        // Log completed trace to Braintrust (no-op if disabled)
        await this.telemetryService
          .logTrace(traceCtx.finalize())
          .catch((err) => {
            this.logger.warn(
              `Braintrust telemetry flush failed: ${err instanceof Error ? err.message : String(err)}`
            );
          });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Chat error for session ${sessionId}: ${errorMessage}`);

      traceCtx.markError(errorMessage);

      // Log error trace to Braintrust (non-blocking)
      await this.telemetryService.logTrace(traceCtx.finalize()).catch(() => {
        /* swallow telemetry errors on failure path */
      });

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
      "4. detectDuplicates - Check for duplicate activities within the CSV and against the user's existing portfolio",
      '5. previewImportReport - Generate a summary of what will be imported',
      '6. commitImport - Actually import the validated activities into Ghostfolio',
      '',
      'When a user provides a CSV file:',
      '1. First use parseCSV to parse the raw content',
      '2. Then use mapBrokerFields to map the headers to Ghostfolio fields',
      '3. Then use validateTransactions to check all activities are valid',
      '4. Use detectDuplicates to check for duplicates',
      '5. Use previewImportReport to show the user a summary',
      '6. Only use commitImport after the user explicitly confirms they want to import',
      '',
      'Important rules:',
      '- Always run tools in sequence when processing a CSV (parse → map → validate → duplicates → preview)',
      '- After mapping fields, transform the raw rows into MappedActivity objects before validating',
      '- Be concise but thorough in your responses',
      '- Report validation errors and warnings clearly with row numbers',
      '- Never display raw CSV data in full, only summaries and specific issues',
      '- NEVER call commitImport without explicitly asking the user for confirmation first',
      '- Always offer a dry-run before the real import'
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

      const toEvict = sortedEntries.slice(0, this.sessions.size - MAX_SESSIONS);

      for (const [sessionId] of toEvict) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
