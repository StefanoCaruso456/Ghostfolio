-- AlterTable
ALTER TABLE "Account" ADD COLUMN "plaidAccountId" TEXT;

-- CreateIndex
CREATE INDEX "Account_plaidAccountId_idx" ON "Account"("plaidAccountId");
