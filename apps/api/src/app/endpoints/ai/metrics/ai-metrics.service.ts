import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';

import { Injectable, Logger } from '@nestjs/common';
import type { AiFeedbackRating } from '@prisma/client';
import { Prisma } from '@prisma/client';

// ─── Pure-function percentile computation ─────────────────────────────────

/**
 * Compute percentile from a sorted array of numbers.
 * Uses linear interpolation (same as NumPy default / "inclusive" method).
 */
export function computePercentile(
  sorted: number[],
  percentile: number
): number {
  if (sorted.length === 0) {
    return 0;
  }

  if (sorted.length === 1) {
    return sorted[0];
  }

  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (upper >= sorted.length) {
    return sorted[sorted.length - 1];
  }

  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Compute p50 and p95 from an unsorted array.
 */
export function computeLatencyPercentiles(values: number[]): {
  p50: number;
  p95: number;
  count: number;
  min: number;
  max: number;
  mean: number;
} {
  if (values.length === 0) {
    return { p50: 0, p95: 0, count: 0, min: 0, max: 0, mean: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);

  return {
    p50: computePercentile(sorted, 50),
    p95: computePercentile(sorted, 95),
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length
  };
}

// ─── Service ──────────────────────────────────────────────────────────────

@Injectable()
export class AiMetricsService {
  private readonly logger = new Logger(AiMetricsService.name);

  public constructor(private readonly prismaService: PrismaService) {}

  // ── Feedback ─────────────────────────────────────────────────────────

  public async createFeedback(params: {
    userId: string;
    rating: AiFeedbackRating;
    conversationId?: string;
    traceId?: string;
    messageId?: string;
    comment?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    return this.prismaService.aiFeedback.create({
      data: {
        userId: params.userId,
        rating: params.rating,
        conversationId: params.conversationId ?? null,
        traceId: params.traceId ?? null,
        messageId: params.messageId ?? null,
        comment: params.comment ?? null,
        metadata: params.metadata ?? Prisma.JsonNull
      }
    });
  }

  // ── Trace Metric Persistence (called from telemetry service) ─────────

  public async persistTraceMetric(params: {
    traceId: string;
    userId: string;
    totalLatencyMs: number;
    llmLatencyMs: number;
    toolLatencyTotalMs: number;
    toolCallCount: number;
    usedTools: boolean;
    hallucinationFlagCount: number;
    verificationPassed: boolean;
    estimatedCostUsd: number;
  }) {
    try {
      await this.prismaService.aiTraceMetric.create({
        data: {
          traceId: params.traceId,
          userId: params.userId,
          totalLatencyMs: Math.round(params.totalLatencyMs),
          llmLatencyMs: Math.round(params.llmLatencyMs),
          toolLatencyTotalMs: Math.round(params.toolLatencyTotalMs),
          toolCallCount: params.toolCallCount,
          usedTools: params.usedTools,
          hallucinationFlagCount: params.hallucinationFlagCount,
          verificationPassed: params.verificationPassed,
          estimatedCostUsd: params.estimatedCostUsd
        }
      });
    } catch (error) {
      // Best-effort — never fail the chat response
      this.logger.warn(
        `Failed to persist trace metric: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ── Latency Baselines (p50/p95) ──────────────────────────────────────

  public async getLatencyBaselines(days: number = 7) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const metrics = await this.prismaService.aiTraceMetric.findMany({
      where: { createdAt: { gte: since } },
      select: {
        totalLatencyMs: true,
        llmLatencyMs: true,
        toolLatencyTotalMs: true
      }
    });

    const totalLatencies = metrics.map((m) => m.totalLatencyMs);
    const llmLatencies = metrics.map((m) => m.llmLatencyMs);
    const toolLatencies = metrics.map((m) => m.toolLatencyTotalMs);

    return {
      days,
      traceCount: metrics.length,
      totalLatency: computeLatencyPercentiles(totalLatencies),
      llmLatency: computeLatencyPercentiles(llmLatencies),
      toolLatency: computeLatencyPercentiles(toolLatencies)
    };
  }

  // ── Hallucination Rate ───────────────────────────────────────────────

  public async getHallucinationRate(days: number = 7) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const metrics = await this.prismaService.aiTraceMetric.findMany({
      where: { createdAt: { gte: since } },
      select: { hallucinationFlagCount: true }
    });

    const total = metrics.length;
    const withHallucinations = metrics.filter(
      (m) => m.hallucinationFlagCount > 0
    ).length;

    return {
      days,
      traceCount: total,
      tracesWithHallucinations: withHallucinations,
      hallucinationRate: total > 0 ? withHallucinations / total : 0,
      definition:
        'Percentage of traces where verificationSummary.hallucinationFlags.length > 0'
    };
  }

  // ── Verification Label ───────────────────────────────────────────────

  public async createVerificationLabel(params: {
    labeledByUserId: string;
    traceId: string;
    isHallucination: boolean;
    verificationShouldHavePassed: boolean;
    notes?: string;
  }) {
    return this.prismaService.aiVerificationLabel.create({
      data: {
        traceId: params.traceId,
        labeledByUserId: params.labeledByUserId,
        isHallucination: params.isHallucination,
        verificationShouldHavePassed: params.verificationShouldHavePassed,
        notes: params.notes ?? null
      }
    });
  }

  // ── Verification Accuracy ────────────────────────────────────────────

  public async getVerificationAccuracy(days: number = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Get all labels in the window
    const labels = await this.prismaService.aiVerificationLabel.findMany({
      where: { createdAt: { gte: since } },
      select: {
        traceId: true,
        isHallucination: true,
        verificationShouldHavePassed: true
      }
    });

    if (labels.length === 0) {
      return {
        days,
        labelCount: 0,
        accuracy: null,
        details: {
          correctVerificationDecisions: 0,
          correctHallucinationDetections: 0,
          total: 0
        },
        definition:
          'Among labeled traces: accuracy = (correct verification + correct hallucination detection) / (2 * total labeled)'
      };
    }

    // Get matching trace metrics
    const traceIds = labels.map((l) => l.traceId);

    const metrics = await this.prismaService.aiTraceMetric.findMany({
      where: { traceId: { in: traceIds } },
      select: {
        traceId: true,
        verificationPassed: true,
        hallucinationFlagCount: true
      }
    });

    const metricsByTraceId = new Map(metrics.map((m) => [m.traceId, m]));

    let correctVerification = 0;
    let correctHallucination = 0;
    let matchedCount = 0;

    for (const label of labels) {
      const metric = metricsByTraceId.get(label.traceId);

      if (!metric) {
        continue; // No metric data for this label
      }

      matchedCount++;

      // Verification accuracy: did system's verificationPassed match the label?
      if (metric.verificationPassed === label.verificationShouldHavePassed) {
        correctVerification++;
      }

      // Hallucination detection accuracy: did system detect hallucination when label says it's one?
      const systemDetectedHallucination = metric.hallucinationFlagCount > 0;

      if (systemDetectedHallucination === label.isHallucination) {
        correctHallucination++;
      }
    }

    const totalChecks = matchedCount * 2; // 2 checks per label
    const totalCorrect = correctVerification + correctHallucination;

    return {
      days,
      labelCount: labels.length,
      matchedCount,
      accuracy: totalChecks > 0 ? totalCorrect / totalChecks : null,
      details: {
        correctVerificationDecisions: correctVerification,
        correctHallucinationDetections: correctHallucination,
        total: matchedCount
      },
      definition:
        'Among labeled traces: accuracy = (correct verification + correct hallucination detection) / (2 * total matched)'
    };
  }
}
