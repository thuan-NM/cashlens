-- Extend finance enums to match the SRS without dropping legacy values.
ALTER TYPE "TransactionDirection" ADD VALUE IF NOT EXISTS 'TRANSFER_IN';
ALTER TYPE "TransactionDirection" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';
ALTER TYPE "TransactionDirection" ADD VALUE IF NOT EXISTS 'ADJUSTMENT';

ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'BANK_ACCOUNT';
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'CLOSED';

CREATE TYPE "TransactionSourceType" AS ENUM ('EMAIL', 'MANUAL', 'CSV', 'SMS', 'API');
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'POSTED', 'IGNORED', 'DELETED', 'NEEDS_REVIEW');
CREATE TYPE "ClassificationSource" AS ENUM ('RULE', 'ML', 'LLM', 'MANUAL', 'SYSTEM', 'UNKNOWN');
CREATE TYPE "TransactionCategoryType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER', 'NEUTRAL');
CREATE TYPE "TransactionCategoryStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- Category becomes TransactionCategory and now supports system-owned defaults.
ALTER TABLE "Category" RENAME TO "TransactionCategory";
ALTER TABLE "TransactionCategory" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "TransactionCategory" ADD COLUMN "parentId" TEXT;
ALTER TABLE "TransactionCategory" ADD COLUMN "slug" TEXT;
ALTER TABLE "TransactionCategory" ADD COLUMN "icon" TEXT;
ALTER TABLE "TransactionCategory" ADD COLUMN "color" TEXT;
ALTER TABLE "TransactionCategory" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TransactionCategory" ADD COLUMN "excludeFromBudget" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TransactionCategory" ADD COLUMN "excludeFromAnalytics" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TransactionCategory" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "TransactionCategory" ADD COLUMN "status" "TransactionCategoryStatus" NOT NULL DEFAULT 'ACTIVE';

UPDATE "TransactionCategory"
SET "slug" = regexp_replace(lower(trim("name")), '[^a-z0-9]+', '-', 'g')
WHERE "slug" IS NULL;

ALTER TABLE "TransactionCategory" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "TransactionCategory" ALTER COLUMN "type" DROP DEFAULT;
UPDATE "TransactionCategory"
SET "type" = CASE
  WHEN lower("type") = 'income' THEN 'INCOME'
  WHEN lower("type") = 'expense' THEN 'EXPENSE'
  WHEN lower("type") = 'transfer' THEN 'TRANSFER'
  ELSE 'NEUTRAL'
END;
ALTER TABLE "TransactionCategory" ALTER COLUMN "type" TYPE "TransactionCategoryType" USING "type"::"TransactionCategoryType";
ALTER TABLE "TransactionCategory" ALTER COLUMN "type" SET DEFAULT 'EXPENSE';

DROP INDEX IF EXISTS "Category_userId_name_key";
CREATE UNIQUE INDEX "TransactionCategory_userId_slug_key" ON "TransactionCategory"("userId", "slug");
CREATE INDEX "TransactionCategory_userId_status_idx" ON "TransactionCategory"("userId", "status");
CREATE INDEX "TransactionCategory_parentId_idx" ON "TransactionCategory"("parentId");
ALTER TABLE "TransactionCategory" ADD CONSTRAINT "TransactionCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TransactionCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "TransactionCategory" (
  "id", "userId", "name", "slug", "type", "icon", "color", "isSystem", "sortOrder", "createdAt", "updatedAt"
) VALUES
  ('sys_cat_income_salary', NULL, 'Lương', 'salary', 'INCOME', 'wallet', '#16a34a', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('sys_cat_income_other', NULL, 'Thu nhập khác', 'other-income', 'INCOME', 'plus-circle', '#22c55e', true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('sys_cat_expense_food', NULL, 'Ăn uống', 'food', 'EXPENSE', 'utensils', '#f97316', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('sys_cat_expense_transport', NULL, 'Di chuyển', 'transport', 'EXPENSE', 'car', '#0ea5e9', true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('sys_cat_expense_shopping', NULL, 'Mua sắm', 'shopping', 'EXPENSE', 'shopping-bag', '#a855f7', true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('sys_cat_expense_bills', NULL, 'Hóa đơn', 'bills', 'EXPENSE', 'receipt', '#64748b', true, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('sys_cat_transfer', NULL, 'Chuyển khoản', 'transfer', 'TRANSFER', 'repeat', '#14b8a6', true, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('sys_cat_uncategorized', NULL, 'Chưa phân loại', 'uncategorized', 'NEUTRAL', 'circle-help', '#94a3b8', true, 999, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("userId", "slug") DO NOTHING;

-- Financial accounts get the SRS account metadata.
ALTER TABLE "FinancialAccount" ADD COLUMN "bankProviderId" TEXT;
ALTER TABLE "FinancialAccount" ADD COLUMN "accountMask" TEXT;
ALTER TABLE "FinancialAccount" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FinancialAccount" ADD COLUMN "balanceUpdatedAt" TIMESTAMP(3);
CREATE INDEX "FinancialAccount_userId_isDefault_idx" ON "FinancialAccount"("userId", "isDefault");

-- Transactions get source, status, duplicate tracking, and classification metadata.
DROP INDEX IF EXISTS "Transaction_userId_accountId_idx";
DROP INDEX IF EXISTS "Transaction_userId_externalId_key";
ALTER TABLE "Transaction" DROP CONSTRAINT IF EXISTS "Transaction_accountId_fkey";

ALTER TABLE "Transaction" RENAME COLUMN "accountId" TO "financialAccountId";
ALTER TABLE "Transaction" RENAME COLUMN "externalId" TO "externalTransactionId";

ALTER TABLE "Transaction" ADD COLUMN "bankProviderId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "counterpartyName" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "sourceType" "TransactionSourceType" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Transaction" ADD COLUMN "sourceId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "transactionCode" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "postedDate" TIMESTAMP(3);
ALTER TABLE "Transaction" ADD COLUMN "normalizedDescription" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "feeAmount" DECIMAL(18,2);
ALTER TABLE "Transaction" ADD COLUMN "status" "TransactionStatus" NOT NULL DEFAULT 'POSTED';
ALTER TABLE "Transaction" ADD COLUMN "isDuplicate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Transaction" ADD COLUMN "duplicateOfTransactionId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "classificationSource" "ClassificationSource" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Transaction" ADD COLUMN "classificationConfidence" DECIMAL(5,4);
ALTER TABLE "Transaction" ADD COLUMN "userNote" TEXT;

ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_duplicateOfTransactionId_fkey" FOREIGN KEY ("duplicateOfTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Transaction_userId_externalTransactionId_key" ON "Transaction"("userId", "externalTransactionId");
CREATE INDEX "Transaction_userId_status_idx" ON "Transaction"("userId", "status");
CREATE INDEX "Transaction_userId_sourceType_idx" ON "Transaction"("userId", "sourceType");
CREATE INDEX "Transaction_userId_categoryId_idx" ON "Transaction"("userId", "categoryId");
CREATE INDEX "Transaction_userId_financialAccountId_idx" ON "Transaction"("userId", "financialAccountId");
