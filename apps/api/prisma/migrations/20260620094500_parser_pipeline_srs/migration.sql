-- CreateEnum
CREATE TYPE "ParserChannel" AS ENUM ('EMAIL', 'CSV', 'SMS', 'API');

-- CreateEnum
CREATE TYPE "ParserFieldType" AS ENUM ('MONEY', 'DATETIME', 'TEXT', 'NUMBER', 'DIRECTION');

-- CreateEnum
CREATE TYPE "ParserRunStatus" AS ENUM ('SUCCESS', 'FAILED', 'PARTIAL');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "emailMessageId" TEXT;

-- CreateTable
CREATE TABLE "ParserTemplate" (
    "id" TEXT NOT NULL,
    "bankProviderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "channel" "ParserChannel" NOT NULL DEFAULT 'EMAIL',
    "language" TEXT,
    "directionHint" "TransactionDirection",
    "subjectPattern" TEXT,
    "bodyPattern" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ParserTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParserField" (
    "id" TEXT NOT NULL,
    "parserTemplateId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "fieldType" "ParserFieldType" NOT NULL,
    "regexPattern" TEXT NOT NULL,
    "regexGroupIndex" INTEGER NOT NULL DEFAULT 1,
    "normalizer" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "fallbackValue" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ParserField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParserRun" (
    "id" TEXT NOT NULL,
    "emailMessageId" TEXT NOT NULL,
    "parserTemplateId" TEXT,
    "status" "ParserRunStatus" NOT NULL,
    "confidenceScore" DECIMAL(5,4),
    "extractedPayload" JSONB NOT NULL,
    "normalizedPayload" JSONB NOT NULL,
    "errorMessage" TEXT,
    "createdTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ParserRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ParserTemplate_bankProviderId_channel_isActive_priority_idx" ON "ParserTemplate"("bankProviderId", "channel", "isActive", "priority");
CREATE UNIQUE INDEX "ParserTemplate_bankProviderId_name_version_key" ON "ParserTemplate"("bankProviderId", "name", "version");
CREATE INDEX "ParserField_parserTemplateId_fieldName_priority_idx" ON "ParserField"("parserTemplateId", "fieldName", "priority");
CREATE INDEX "ParserRun_emailMessageId_createdAt_idx" ON "ParserRun"("emailMessageId", "createdAt");
CREATE INDEX "ParserRun_parserTemplateId_status_idx" ON "ParserRun"("parserTemplateId", "status");
CREATE UNIQUE INDEX "Transaction_emailMessageId_key" ON "Transaction"("emailMessageId");

ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ParserTemplate" ADD CONSTRAINT "ParserTemplate_bankProviderId_fkey" FOREIGN KEY ("bankProviderId") REFERENCES "BankProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParserField" ADD CONSTRAINT "ParserField_parserTemplateId_fkey" FOREIGN KEY ("parserTemplateId") REFERENCES "ParserTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParserRun" ADD CONSTRAINT "ParserRun_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParserRun" ADD CONSTRAINT "ParserRun_parserTemplateId_fkey" FOREIGN KEY ("parserTemplateId") REFERENCES "ParserTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ParserRun" ADD CONSTRAINT "ParserRun_createdTransactionId_fkey" FOREIGN KEY ("createdTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
