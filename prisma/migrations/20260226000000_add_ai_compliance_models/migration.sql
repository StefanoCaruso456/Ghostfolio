-- CreateEnum
CREATE TYPE "AiFeedbackRating" AS ENUM ('UP', 'DOWN');

-- CreateTable
CREATE TABLE "AiFeedback" (
    "comment" TEXT,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "metadata" JSONB,
    "rating" "AiFeedbackRating" NOT NULL,
    "traceId" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "AiFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTraceMetric" (
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hallucinationFlagCount" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL,
    "llmLatencyMs" INTEGER NOT NULL DEFAULT 0,
    "toolCallCount" INTEGER NOT NULL DEFAULT 0,
    "toolLatencyTotalMs" INTEGER NOT NULL DEFAULT 0,
    "totalLatencyMs" INTEGER NOT NULL DEFAULT 0,
    "traceId" TEXT NOT NULL,
    "usedTools" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT NOT NULL,
    "verificationPassed" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AiTraceMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiVerificationLabel" (
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" TEXT NOT NULL,
    "isHallucination" BOOLEAN NOT NULL,
    "labeledByUserId" TEXT NOT NULL,
    "notes" TEXT,
    "traceId" TEXT NOT NULL,
    "verificationShouldHavePassed" BOOLEAN NOT NULL,

    CONSTRAINT "AiVerificationLabel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiFeedback_conversationId_idx" ON "AiFeedback"("conversationId");
CREATE INDEX "AiFeedback_createdAt_idx" ON "AiFeedback"("createdAt");
CREATE INDEX "AiFeedback_traceId_idx" ON "AiFeedback"("traceId");
CREATE INDEX "AiFeedback_userId_idx" ON "AiFeedback"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AiTraceMetric_traceId_key" ON "AiTraceMetric"("traceId");
CREATE INDEX "AiTraceMetric_createdAt_idx" ON "AiTraceMetric"("createdAt");
CREATE INDEX "AiTraceMetric_userId_idx" ON "AiTraceMetric"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AiVerificationLabel_traceId_key" ON "AiVerificationLabel"("traceId");
CREATE INDEX "AiVerificationLabel_createdAt_idx" ON "AiVerificationLabel"("createdAt");
CREATE INDEX "AiVerificationLabel_traceId_idx" ON "AiVerificationLabel"("traceId");

-- AddForeignKey
ALTER TABLE "AiFeedback" ADD CONSTRAINT "AiFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiVerificationLabel" ADD CONSTRAINT "AiVerificationLabel_labeledByUserId_fkey" FOREIGN KEY ("labeledByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
