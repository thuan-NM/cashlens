-- DB-M2 (2/5), T040: transaction identity for layered deduplication
-- (EMAIL-007, EMAIL-008). Precedence: provider message identity (the existing
-- unique email message), then the provider transaction code, then a
-- deterministic fingerprint. The canonical row of an event holds its key;
-- uniqueness per user is the concurrency defence.

-- CreateEnum
CREATE TYPE "TransactionDeduplicationStrategy" AS ENUM ('TRANSACTION_CODE', 'FINGERPRINT');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "deduplicationFingerprint" TEXT,
ADD COLUMN     "deduplicationStrategy" "TransactionDeduplicationStrategy";

-- Legacy email imports with a provider transaction code receive the same key
-- the application computes (normalizeTransactionCode in
-- src/modules/email-ingestion/transaction-identity.ts: ASCII whitespace
-- removed, upper case), scoped to the bank.
CREATE TEMP TABLE "_dedup_candidates" ON COMMIT DROP AS
SELECT "id",
       "userId",
       'code:v1:' || "bankProviderId" || ':' ||
         upper(regexp_replace("transactionCode", '[ \t\n\r\f\v]', '', 'g')) AS "key"
FROM "Transaction"
WHERE "sourceType" = 'EMAIL'
  AND "bankProviderId" IS NOT NULL
  AND "transactionCode" IS NOT NULL
  AND regexp_replace("transactionCode", '[ \t\n\r\f\v]', '', 'g') <> '';

-- Collision audit, before uniqueness is enforced: a code imported more than
-- once for the same user is reported and left without a key on every one of
-- its rows (no row is guessed canonical), so existing data never fails here.
DO $$
DECLARE
  colliding integer;
BEGIN
  SELECT count(*) INTO colliding
  FROM (
    SELECT "userId", "key"
    FROM "_dedup_candidates"
    GROUP BY "userId", "key"
    HAVING count(*) > 1
  ) AS groups;
  IF colliding > 0 THEN
    RAISE NOTICE 'Deduplication audit: % legacy transaction-code group(s) collide and keep no fingerprint', colliding;
  END IF;
END $$;

UPDATE "Transaction" AS t
SET "deduplicationFingerprint" = c."key",
    "deduplicationStrategy" = 'TRANSACTION_CODE'
FROM (
  SELECT "id", "key",
         count(*) OVER (PARTITION BY "userId", "key") AS "rows"
  FROM "_dedup_candidates"
) AS c
WHERE t."id" = c."id" AND c."rows" = 1;

-- Defensive check: the backfill must never produce a collision.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Transaction"
    WHERE "deduplicationFingerprint" IS NOT NULL
    GROUP BY "userId", "deduplicationFingerprint"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Deduplication audit failed: duplicate fingerprints after backfill';
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_userId_deduplicationFingerprint_key" ON "Transaction"("userId", "deduplicationFingerprint");
