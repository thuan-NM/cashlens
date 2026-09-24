-- DB-M4 (4/5), T064: alert condition lifecycle (ALERT-001–ALERT-004, ALERT-010).
-- Existing alerts become ACTIVE with no condition key, and their trigger time
-- is their creation time (ALERT-011). Read state (isRead/readAt) is unchanged.

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('ACTIVE', 'DISMISSED', 'RESOLVED');

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "conditionKey" TEXT,
ADD COLUMN     "dismissedAt" TIMESTAMP(3),
ADD COLUMN     "observedValue" DECIMAL(18,4),
ADD COLUMN     "periodEnd" TIMESTAMP(3),
ADD COLUMN     "periodStart" TIMESTAMP(3),
ADD COLUMN     "resolutionReason" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "status" "AlertStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "thresholdValue" DECIMAL(18,4),
ADD COLUMN     "triggeredAt" TIMESTAMP(3);

-- Backfill: a legacy alert was triggered when it was created. The column is
-- added nullable first so no row is stamped with the migration time.
UPDATE "Alert" SET "triggeredAt" = "createdAt";

ALTER TABLE "Alert" ALTER COLUMN "triggeredAt" SET NOT NULL,
ALTER COLUMN "triggeredAt" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Alert_userId_status_triggeredAt_idx" ON "Alert"("userId", "status", "triggeredAt");

-- CreateIndex: the cooldown lookup (latest trigger of one condition key).
CREATE INDEX "Alert_userId_conditionKey_triggeredAt_idx" ON "Alert"("userId", "conditionKey", "triggeredAt" DESC);

-- At most one open (ACTIVE or DISMISSED) occurrence per condition (ALERT-002).
-- A partial index cannot be declared in schema.prisma, so it exists only here;
-- Prisma's schema diff ignores it. Null-key rows (legacy and user-authored)
-- are outside the index.
CREATE UNIQUE INDEX "Alert_open_condition_key"
  ON "Alert" ("userId", "conditionKey")
  WHERE "conditionKey" IS NOT NULL AND "status" IN ('ACTIVE', 'DISMISSED');
