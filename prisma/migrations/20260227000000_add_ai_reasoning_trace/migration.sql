-- CreateTable
CREATE TABLE "AiReasoningTrace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "stepsJson" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "totalDurationMs" INTEGER NOT NULL DEFAULT 0,
    "stepCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiReasoningTrace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiReasoningTrace_userId_idx" ON "AiReasoningTrace"("userId");
CREATE INDEX "AiReasoningTrace_conversationId_idx" ON "AiReasoningTrace"("conversationId");
CREATE INDEX "AiReasoningTrace_createdAt_idx" ON "AiReasoningTrace"("createdAt");
