import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import {
  PROPERTY_API_KEY_OPENROUTER,
  PROPERTY_OPENROUTER_MODEL
} from '@ghostfolio/common/config';
import { AiChatResponse, Filter } from '@ghostfolio/common/interfaces';
import type { AiPromptMode } from '@ghostfolio/common/types';

import { Injectable, Logger } from '@nestjs/common';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';
import { randomUUID } from 'node:crypto';
import type { ColumnDescriptor } from 'tablemark';

@Injectable()
export class AiService {
  private static readonly HOLDINGS_TABLE_COLUMN_DEFINITIONS: ({
    key:
      | 'ALLOCATION_PERCENTAGE'
      | 'ASSET_CLASS'
      | 'ASSET_SUB_CLASS'
      | 'CURRENCY'
      | 'NAME'
      | 'SYMBOL';
  } & ColumnDescriptor)[] = [
    { key: 'NAME', name: 'Name' },
    { key: 'SYMBOL', name: 'Symbol' },
    { key: 'CURRENCY', name: 'Currency' },
    { key: 'ASSET_CLASS', name: 'Asset Class' },
    { key: 'ASSET_SUB_CLASS', name: 'Asset Sub Class' },
    {
      align: 'right',
      key: 'ALLOCATION_PERCENTAGE',
      name: 'Allocation in Percentage'
    }
  ];

  public constructor(
    private readonly portfolioService: PortfolioService,
    private readonly propertyService: PropertyService
  ) {}

  public async chat({
    conversationId,
    history,
    languageCode,
    message,
    userCurrency,
    userId
  }: {
    conversationId?: string;
    history: { content: string; role: 'assistant' | 'user' }[];
    languageCode: string;
    message: string;
    userCurrency: string;
    userId: string;
  }): Promise<AiChatResponse> {
    const openRouterApiKey = await this.propertyService.getByKey<string>(
      PROPERTY_API_KEY_OPENROUTER
    );

    const openRouterModel = await this.propertyService.getByKey<string>(
      PROPERTY_OPENROUTER_MODEL
    );

    if (!openRouterApiKey) {
      Logger.error(
        'OpenRouter API key not configured. Set API_KEY_OPENROUTER in the Property table.',
        'AiService'
      );
      throw new Error('AI chat is not configured. Missing OpenRouter API key.');
    }

    if (!openRouterModel) {
      Logger.error(
        'OpenRouter model not configured. Set OPENROUTER_MODEL in the Property table.',
        'AiService'
      );
      throw new Error(
        'AI chat is not configured. Missing OpenRouter model setting.'
      );
    }

    const openRouterService = createOpenRouter({
      apiKey: openRouterApiKey
    });

    let portfolioContext = '';

    try {
      const portfolioPrompt = await this.getPrompt({
        filters: [],
        impersonationId: undefined,
        languageCode,
        mode: 'portfolio',
        userCurrency,
        userId
      });

      portfolioContext = `\n\nThe user's current portfolio (base currency: ${userCurrency}):\n${portfolioPrompt}`;
    } catch (error) {
      Logger.warn('Could not fetch portfolio for AI chat context', 'AiService');
    }

    const systemMessage = [
      'You are Ghostfolio AI, a knowledgeable and helpful financial assistant integrated into the Ghostfolio portfolio management application.',
      'You help users understand their portfolio, answer financial questions, and provide investment insights.',
      '',
      '## Response Guidelines',
      '- Be concise but thorough. Use markdown formatting for better readability.',
      "- When discussing the user's portfolio, reference specific holdings by name and symbol.",
      '- Structure longer responses with clear sections and bullet points.',
      `- Respond in the following language: ${languageCode}.`,
      '',
      '## Safety Guardrails (MUST FOLLOW)',
      '- NEVER give specific buy/sell recommendations or price targets.',
      '- NEVER fabricate financial data. Only reference holdings and allocations from the portfolio context below.',
      '- If asked about holdings NOT in the portfolio, respond: "That asset is not currently in your portfolio."',
      '- If asked for predictions or forecasts, caveat: "Past performance does not guarantee future results."',
      '- Always provide balanced, neutral financial guidance with multiple perspectives.',
      '- If you are uncertain about something, say so explicitly rather than guessing.',
      '',
      '## Anti-Hallucination Rules',
      '- Only cite portfolio data that appears in the context table below.',
      '- Do not invent allocation percentages, prices, or performance figures.',
      '- If the portfolio context is empty or unavailable, tell the user: "I don\'t have access to your portfolio data right now."',
      '- When performing calculations (e.g., sector totals), show your work so the user can verify.',
      '',
      '## Confidence & Escalation',
      '- For complex tax, legal, or compliance questions, recommend the user consult a qualified professional.',
      '- For questions about specific financial products or strategies, include appropriate risk disclaimers.',
      '- If the user asks about making large portfolio changes, recommend they review with a financial advisor.',
      '',
      '## Domain Constraints',
      '- This is a portfolio tracking and analysis tool, not a trading platform.',
      '- You can analyze allocations, diversification, risk exposure, and historical composition.',
      '- You cannot execute trades, modify the portfolio, or access real-time market data.',
      portfolioContext
    ].join('\n');

    const messages: {
      content: string;
      role: 'assistant' | 'system' | 'user';
    }[] = [
      { content: systemMessage, role: 'system' },
      ...history.map((msg) => ({
        content: msg.content,
        role: msg.role as 'assistant' | 'user'
      })),
      { content: message, role: 'user' as const }
    ];

    try {
      const result = await generateText({
        messages,
        model: openRouterService.chat(openRouterModel)
      });

      return {
        conversationId: conversationId || randomUUID(),
        message: {
          content: result.text,
          role: 'assistant',
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      Logger.error(
        `OpenRouter API call failed: ${error instanceof Error ? error.message : String(error)}`,
        'AiService'
      );

      throw error;
    }
  }

  public async generateText({ prompt }: { prompt: string }) {
    const openRouterApiKey = await this.propertyService.getByKey<string>(
      PROPERTY_API_KEY_OPENROUTER
    );

    const openRouterModel = await this.propertyService.getByKey<string>(
      PROPERTY_OPENROUTER_MODEL
    );

    const openRouterService = createOpenRouter({
      apiKey: openRouterApiKey
    });

    return generateText({
      prompt,
      model: openRouterService.chat(openRouterModel)
    });
  }

  public async getPrompt({
    filters,
    impersonationId,
    languageCode,
    mode,
    userCurrency,
    userId
  }: {
    filters?: Filter[];
    impersonationId: string;
    languageCode: string;
    mode: AiPromptMode;
    userCurrency: string;
    userId: string;
  }) {
    const { holdings } = await this.portfolioService.getDetails({
      filters,
      impersonationId,
      userId
    });

    const holdingsTableColumns: ColumnDescriptor[] =
      AiService.HOLDINGS_TABLE_COLUMN_DEFINITIONS.map(({ align, name }) => {
        return { name, align: align ?? 'left' };
      });

    const holdingsTableRows = Object.values(holdings)
      .sort((a, b) => {
        return b.allocationInPercentage - a.allocationInPercentage;
      })
      .map(
        ({
          allocationInPercentage,
          assetClass,
          assetSubClass,
          currency,
          name: label,
          symbol
        }) => {
          return AiService.HOLDINGS_TABLE_COLUMN_DEFINITIONS.reduce(
            (row, { key, name }) => {
              switch (key) {
                case 'ALLOCATION_PERCENTAGE':
                  row[name] = `${(allocationInPercentage * 100).toFixed(3)}%`;
                  break;

                case 'ASSET_CLASS':
                  row[name] = assetClass ?? '';
                  break;

                case 'ASSET_SUB_CLASS':
                  row[name] = assetSubClass ?? '';
                  break;

                case 'CURRENCY':
                  row[name] = currency;
                  break;

                case 'NAME':
                  row[name] = label;
                  break;

                case 'SYMBOL':
                  row[name] = symbol;
                  break;

                default:
                  row[name] = '';
                  break;
              }

              return row;
            },
            {} as Record<string, string>
          );
        }
      );

    // Dynamic import to load ESM module from CommonJS context
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicImport = new Function('s', 'return import(s)') as (
      s: string
    ) => Promise<typeof import('tablemark')>;
    const { tablemark } = await dynamicImport('tablemark');

    const holdingsTableString = tablemark(holdingsTableRows, {
      columns: holdingsTableColumns
    });

    if (mode === 'portfolio') {
      return holdingsTableString;
    }

    return [
      `You are a neutral financial assistant. Please analyze the following investment portfolio (base currency being ${userCurrency}) in simple words.`,
      holdingsTableString,
      'Structure your answer with these sections:',
      "Overview: Briefly summarize the portfolio's composition and allocation rationale.",
      'Risk Assessment: Identify potential risks, including market volatility, concentration, and sectoral imbalances.',
      'Advantages: Highlight strengths, focusing on growth potential, diversification, or other benefits.',
      'Disadvantages: Point out weaknesses, such as overexposure or lack of defensive assets.',
      'Target Group: Discuss who this portfolio might suit (e.g., risk tolerance, investment goals, life stages, and experience levels).',
      'Optimization Ideas: Offer ideas to complement the portfolio, ensuring they are constructive and neutral in tone.',
      'Conclusion: Provide a concise summary highlighting key insights.',
      `Provide your answer in the following language: ${languageCode}.`
    ].join('\n');
  }
}
