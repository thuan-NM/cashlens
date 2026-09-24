-- DB-M1 (1/5), T038: email sync progress, connection lease, and run lifecycle
-- (EMAIL-005 to EMAIL-007). Every new column is nullable or has a default, so
-- existing connections and runs stay valid with no backfill.
--
-- EXPIRED is added here and deliberately not used in this migration:
-- PostgreSQL cannot use an enum value inside the transaction that adds it.

-- AlterEnum
ALTER TYPE "EmailSyncStatus" ADD VALUE 'EXPIRED';

-- AlterTable: opaque provider cursor, bounded backfill, one lease per connection.
ALTER TABLE "EmailConnection" ADD COLUMN     "backfillCompletedAt" TIMESTAMP(3),
ADD COLUMN     "backfillFrom" TIMESTAMP(3),
ADD COLUMN     "lastFailedAt" TIMESTAMP(3),
ADD COLUMN     "syncCursor" TEXT,
ADD COLUMN     "syncLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "syncLeaseToken" TEXT;

-- AlterTable: failure count, continuation flag, lease association, cursor evidence.
ALTER TABLE "EmailSyncRun" ADD COLUMN     "cursorAfter" TEXT,
ADD COLUMN     "cursorBefore" TEXT,
ADD COLUMN     "emailsFailed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hasMore" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leaseToken" TEXT;

-- CreateIndex: finds a connection's RUNNING runs for stale-lease recovery.
CREATE INDEX "EmailSyncRun_emailConnectionId_status_idx" ON "EmailSyncRun"("emailConnectionId", "status");
