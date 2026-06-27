-- CreateEnum
CREATE TYPE "EmailProvider" AS ENUM ('GMAIL', 'OUTLOOK', 'IMAP');

-- CreateEnum
CREATE TYPE "EmailConnectionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "EmailProcessingStatus" AS ENUM ('PENDING', 'IGNORED', 'PARSED', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailSyncTriggerType" AS ENUM ('MANUAL', 'SCHEDULED', 'WEBHOOK', 'BACKFILL');

-- CreateEnum
CREATE TYPE "EmailSyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL_FAILED', 'FAILED');

-- CreateEnum
CREATE TYPE "BankProviderStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'EXPERIMENTAL');

-- CreateEnum
CREATE TYPE "BankEmailSenderStatus" AS ENUM ('ACTIVE', 'DEPRECATED', 'SUSPICIOUS');

-- CreateTable
CREATE TABLE "BankProvider" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT 'VN',
    "website" TEXT,
    "logoUrl" TEXT,
    "status" "BankProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "supportedChannels" TEXT[] DEFAULT ARRAY['email']::TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankEmailSender" (
    "id" TEXT NOT NULL,
    "bankProviderId" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "senderDomain" TEXT,
    "senderName" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "confidenceScore" DECIMAL(5,4),
    "status" "BankEmailSenderStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankEmailSender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "EmailProvider" NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "providerUserId" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "EmailConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailListenRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailConnectionId" TEXT,
    "bankProviderId" TEXT,
    "name" TEXT NOT NULL,
    "senderEmail" TEXT,
    "senderDomain" TEXT,
    "subjectContains" TEXT,
    "bodyContains" TEXT,
    "syncFromDate" TIMESTAMP(3),
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "lastMatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailListenRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSyncRun" (
    "id" TEXT NOT NULL,
    "emailConnectionId" TEXT NOT NULL,
    "triggerType" "EmailSyncTriggerType" NOT NULL DEFAULT 'MANUAL',
    "status" "EmailSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "emailsFound" INTEGER NOT NULL DEFAULT 0,
    "emailsMatched" INTEGER NOT NULL DEFAULT 0,
    "emailsParsed" INTEGER NOT NULL DEFAULT 0,
    "transactionsCreated" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailConnectionId" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "providerThreadId" TEXT,
    "providerHistoryId" TEXT,
    "messageIdHeader" TEXT,
    "senderEmail" TEXT NOT NULL,
    "senderName" TEXT,
    "subject" TEXT,
    "snippet" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "bodyHash" TEXT,
    "processingStatus" "EmailProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "matchedRuleId" TEXT,
    "bankProviderId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankProvider_code_key" ON "BankProvider"("code");

-- CreateIndex
CREATE INDEX "BankProvider_status_countryCode_idx" ON "BankProvider"("status", "countryCode");

-- CreateIndex
CREATE INDEX "BankEmailSender_senderEmail_status_idx" ON "BankEmailSender"("senderEmail", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BankEmailSender_bankProviderId_senderEmail_key" ON "BankEmailSender"("bankProviderId", "senderEmail");

-- CreateIndex
CREATE INDEX "EmailConnection_userId_status_idx" ON "EmailConnection"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmailConnection_userId_provider_emailAddress_key" ON "EmailConnection"("userId", "provider", "emailAddress");

-- CreateIndex
CREATE INDEX "EmailListenRule_userId_isEnabled_priority_idx" ON "EmailListenRule"("userId", "isEnabled", "priority");

-- CreateIndex
CREATE INDEX "EmailListenRule_emailConnectionId_isEnabled_idx" ON "EmailListenRule"("emailConnectionId", "isEnabled");

-- CreateIndex
CREATE INDEX "EmailSyncRun_emailConnectionId_startedAt_idx" ON "EmailSyncRun"("emailConnectionId", "startedAt");

-- CreateIndex
CREATE INDEX "EmailSyncRun_status_startedAt_idx" ON "EmailSyncRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "EmailMessage_userId_receivedAt_idx" ON "EmailMessage"("userId", "receivedAt");

-- CreateIndex
CREATE INDEX "EmailMessage_emailConnectionId_processingStatus_idx" ON "EmailMessage"("emailConnectionId", "processingStatus");

-- CreateIndex
CREATE INDEX "EmailMessage_bankProviderId_receivedAt_idx" ON "EmailMessage"("bankProviderId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_emailConnectionId_providerMessageId_key" ON "EmailMessage"("emailConnectionId", "providerMessageId");

-- AddForeignKey
ALTER TABLE "BankEmailSender" ADD CONSTRAINT "BankEmailSender_bankProviderId_fkey" FOREIGN KEY ("bankProviderId") REFERENCES "BankProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailConnection" ADD CONSTRAINT "EmailConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailListenRule" ADD CONSTRAINT "EmailListenRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailListenRule" ADD CONSTRAINT "EmailListenRule_emailConnectionId_fkey" FOREIGN KEY ("emailConnectionId") REFERENCES "EmailConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailListenRule" ADD CONSTRAINT "EmailListenRule_bankProviderId_fkey" FOREIGN KEY ("bankProviderId") REFERENCES "BankProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSyncRun" ADD CONSTRAINT "EmailSyncRun_emailConnectionId_fkey" FOREIGN KEY ("emailConnectionId") REFERENCES "EmailConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_emailConnectionId_fkey" FOREIGN KEY ("emailConnectionId") REFERENCES "EmailConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_matchedRuleId_fkey" FOREIGN KEY ("matchedRuleId") REFERENCES "EmailListenRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_bankProviderId_fkey" FOREIGN KEY ("bankProviderId") REFERENCES "BankProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
