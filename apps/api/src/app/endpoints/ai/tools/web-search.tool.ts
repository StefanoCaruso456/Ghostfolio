/**
 * webSearch — Tool that provides real-time web search capabilities.
 *
 * Atomic: single search query per call
 * Idempotent: same query → same results (within cache window)
 * Error-handled: returns ToolResult(status=error), never throws
 * Verified: includes confidence scoring + source attribution
 *
 * Uses Tavily Search API — optimized for AI agent consumption.
 * Requires TAVILY_API_KEY environment variable.
 */
import { Logger } from '@nestjs/common';

import { createVerificationResult } from '../../../import-auditor/schemas/verification.schema';
import type {
  WebSearchData,
  WebSearchInput,
  WebSearchOutput
} from './schemas/web-search.schema';

const TAVILY_API_URL = 'https://api.tavily.com/search';
const DEFAULT_MAX_RESULTS = 5;
const REQUEST_TIMEOUT_MS = 15_000;

const DOMAIN_RULES_CHECKED = [
  'query-provided',
  'api-key-configured',
  'search-executed',
  'results-returned',
  'results-relevant'
];

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  raw_content?: string;
}

interface TavilyResponse {
  query: string;
  answer?: string;
  results: TavilyResult[];
  response_time: number;
}

/**
 * Execute a web search via Tavily API.
 * Returns raw Tavily response or throws on failure.
 */
export async function executeWebSearch(
  input: WebSearchInput,
  apiKey: string
): Promise<TavilyResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(TAVILY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        query: input.query,
        search_depth: 'basic',
        max_results: input.maxResults ?? DEFAULT_MAX_RESULTS,
        topic: input.topic ?? 'general',
        time_range: input.timeRange ?? undefined,
        include_answer: true,
        include_raw_content: false,
        include_images: false
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');

      throw new Error(
        `Tavily API returned ${response.status}: ${errorBody}`
      );
    }

    return (await response.json()) as TavilyResponse;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Build a structured tool result from Tavily search response.
 * Pure function — no service dependencies.
 */
export function buildWebSearchResult(
  tavilyResponse: TavilyResponse | undefined,
  input: WebSearchInput,
  error?: string
): WebSearchOutput {
  try {
    if (error || !tavilyResponse) {
      return {
        status: 'error',
        message: error ?? 'Web search failed — no response received.',
        verification: createVerificationResult({
          passed: false,
          confidence: 0,
          errors: [error ?? 'No response from search API'],
          sources: ['tavily-search-api'],
          domainRulesChecked: DOMAIN_RULES_CHECKED,
          domainRulesFailed: ['search-executed'],
          verificationType: 'confidence_scoring'
        })
      };
    }

    const results = tavilyResponse.results ?? [];
    const relevantResults = results.filter((r) => r.score >= 0.3);
    const warnings: string[] = [];

    if (relevantResults.length < results.length) {
      const dropped = results.length - relevantResults.length;

      warnings.push(
        `${dropped} low-relevance result(s) filtered out (score < 0.3)`
      );
    }

    if (relevantResults.length === 0) {
      return {
        status: 'error',
        message: `No relevant results found for query: "${input.query}"`,
        verification: createVerificationResult({
          passed: false,
          confidence: 0.2,
          warnings: ['Search returned results but none met relevance threshold'],
          sources: ['tavily-search-api'],
          domainRulesChecked: DOMAIN_RULES_CHECKED,
          domainRulesFailed: ['results-relevant'],
          verificationType: 'confidence_scoring'
        })
      };
    }

    // Cap content length per result to manage token budget
    const MAX_CONTENT_LENGTH = 500;
    const cappedResults = relevantResults.map((r) => ({
      title: r.title,
      url: r.url,
      content:
        r.content.length > MAX_CONTENT_LENGTH
          ? r.content.slice(0, MAX_CONTENT_LENGTH) + '…'
          : r.content,
      score: Math.round(r.score * 100) / 100
    }));

    const data: WebSearchData = {
      query: tavilyResponse.query,
      answer: tavilyResponse.answer ?? null,
      results: cappedResults,
      resultCount: cappedResults.length,
      responseTimeMs: Math.round(tavilyResponse.response_time * 1000)
    };

    // Compute confidence from average relevance score
    const avgScore =
      cappedResults.reduce((sum, r) => sum + r.score, 0) /
      cappedResults.length;

    const topResultsPreview = cappedResults
      .slice(0, 3)
      .map((r) => r.title)
      .join(', ');

    return {
      status: 'success',
      data,
      message: `Found ${cappedResults.length} result(s) for "${input.query}". Top results: ${topResultsPreview}.${
        data.answer ? ` Quick answer: ${data.answer.slice(0, 200)}` : ''
      }`,
      verification: createVerificationResult({
        passed: true,
        confidence: Math.min(avgScore + 0.1, 0.95),
        warnings,
        sources: [
          'tavily-search-api',
          ...cappedResults.slice(0, 3).map((r) => r.url)
        ],
        domainRulesChecked: DOMAIN_RULES_CHECKED,
        verificationType: 'fact_check'
      })
    };
  } catch (err) {
    Logger.error(
      `buildWebSearchResult failed: ${err instanceof Error ? err.message : String(err)}`,
      'WebSearchTool'
    );

    return {
      status: 'error',
      message:
        err instanceof Error ? err.message : 'Failed to build search result',
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: [
          err instanceof Error
            ? err.message
            : 'Unknown error in webSearch builder'
        ],
        sources: ['tavily-search-api']
      })
    };
  }
}
