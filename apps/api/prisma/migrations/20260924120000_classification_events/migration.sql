-- DB-M3 (3/5), T050: deterministic classification (CLASS-001–CLASS-007).
-- MerchantRule becomes user-owned (userId set) or system-owned (userId NULL);
-- each transaction records the rule that won its current decision; category
-- decisions gain an append-only history. The new ClassificationSource values
-- are not used in this migration (PostgreSQL cannot use an enum value in the
-- transaction that adds it).

-- CreateEnum
CREATE TYPE "CategoryDecisionSource" AS ENUM ('MANUAL', 'USER_RULE', 'SYSTEM_RULE', 'FALLBACK');

-- CreateEnum
CREATE TYPE "CategoryDecisionTrigger" AS ENUM ('CREATE', 'IMPORT', 'MANUAL_CORRECTION', 'EXPLICIT_RECLASSIFY', 'AUTOMATIC_RERUN');

-- CreateEnum
CREATE TYPE "CategoryDecisionReason" AS ENUM ('MANUAL_SET', 'MANUAL_CLEARED', 'RULE_MATCHED', 'NO_RULE_MATCHED');

-- AlterEnum
ALTER TYPE "ClassificationSource" ADD VALUE 'USER_RULE';
ALTER TYPE "ClassificationSource" ADD VALUE 'SYSTEM_RULE';
ALTER TYPE "ClassificationSource" ADD VALUE 'FALLBACK';

-- AlterTable
ALTER TABLE "MerchantRule" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "classificationRuleId" TEXT,
ADD COLUMN     "classifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TransactionCategoryEvent" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "previousCategoryId" TEXT,
    "newCategoryId" TEXT,
    "source" "CategoryDecisionSource" NOT NULL,
    "trigger" "CategoryDecisionTrigger" NOT NULL,
    "reason" "CategoryDecisionReason" NOT NULL,
    "merchantRuleId" TEXT,
    "actorType" "AuditActorType" NOT NULL,
    "actorUserId" TEXT,
    "explanation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionCategoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransactionCategoryEvent_userId_createdAt_idx" ON "TransactionCategoryEvent"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionCategoryEvent_transactionId_sequence_key" ON "TransactionCategoryEvent"("transactionId", "sequence");

-- CreateIndex
CREATE INDEX "MerchantRule_isActive_userId_idx" ON "MerchantRule"("isActive", "userId");

-- CreateIndex
CREATE INDEX "Transaction_classificationRuleId_idx" ON "Transaction"("classificationRuleId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_classificationRuleId_fkey" FOREIGN KEY ("classificationRuleId") REFERENCES "MerchantRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionCategoryEvent" ADD CONSTRAINT "TransactionCategoryEvent_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionCategoryEvent" ADD CONSTRAINT "TransactionCategoryEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Protection backfill (no history is fabricated). The manual lock is
-- classificationSource = 'MANUAL'. Before US4 no automatic classifier
-- existed, so a category on a row still marked 'UNKNOWN' (set before the
-- column existed) was chosen by its owner: protect it as MANUAL. No
-- TransactionCategoryEvent rows are inserted for past decisions.
UPDATE "Transaction"
SET "classificationSource" = 'MANUAL'
WHERE "categoryId" IS NOT NULL AND "classificationSource" = 'UNKNOWN';

-- Rule target invariant (data-model "MerchantRule ownership"): a system rule
-- targets a system category; a user rule targets a system category or one of
-- its owner's categories. Category status (ACTIVE) is checked at evaluation.
CREATE FUNCTION "merchant_rule_target_scope"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_user TEXT;
  target_system BOOLEAN;
BEGIN
  IF NEW."categoryId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "userId", "isSystem" INTO target_user, target_system
  FROM "TransactionCategory" WHERE "id" = NEW."categoryId";
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports a missing category
  END IF;
  IF NEW."userId" IS NULL THEN
    IF target_user IS NOT NULL OR NOT target_system THEN
      RAISE EXCEPTION 'A system classification rule must target a system category'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT ((target_user IS NULL AND target_system) OR target_user = NEW."userId") THEN
    RAISE EXCEPTION 'A user classification rule must target a system category or one of its owner''s categories'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "MerchantRule_target_scope"
BEFORE INSERT OR UPDATE OF "userId", "categoryId" ON "MerchantRule"
FOR EACH ROW EXECUTE FUNCTION "merchant_rule_target_scope"();

-- Append-only history (CLASS-005, "immutable explanation"): rows are never
-- updated, and are deleted only by a foreign-key cascade from their
-- transaction or user (pg_trigger_depth() > 0 inside the cascade).
CREATE FUNCTION "transaction_category_event_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TransactionCategoryEvent rows are append-only'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "TransactionCategoryEvent_no_update"
BEFORE UPDATE ON "TransactionCategoryEvent"
FOR EACH ROW EXECUTE FUNCTION "transaction_category_event_append_only"();

CREATE TRIGGER "TransactionCategoryEvent_no_direct_delete"
BEFORE DELETE ON "TransactionCategoryEvent"
FOR EACH ROW WHEN (pg_trigger_depth() < 1)
EXECUTE FUNCTION "transaction_category_event_append_only"();
