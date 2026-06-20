-- Rename constraints left behind after Category was renamed to TransactionCategory.
ALTER TABLE "TransactionCategory" RENAME CONSTRAINT "Category_pkey" TO "TransactionCategory_pkey";

ALTER TABLE "TransactionCategory" RENAME CONSTRAINT "Category_userId_fkey" TO "TransactionCategory_userId_fkey";
