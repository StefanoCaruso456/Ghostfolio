-- CreateEnum
CREATE TYPE "SnapTradeConnectionStatus" AS ENUM ('ACTIVE', 'ERROR', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "SnapTradeConnection" (
    "id" TEXT NOT NULL,
    "brokerageName" TEXT,
    "userSecret" TEXT NOT NULL,
    "authorizationId" TEXT,
    "status" "SnapTradeConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SnapTradeConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SnapTradeConnection_userId_idx" ON "SnapTradeConnection"("userId");

-- AddForeignKey
ALTER TABLE "SnapTradeConnection" ADD CONSTRAINT "SnapTradeConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
