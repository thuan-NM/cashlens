-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GoalPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "GoalScenarioType" AS ENUM ('FULL', 'INSTALLMENT');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('BUDGET_THRESHOLD', 'LARGE_TRANSACTION', 'CATEGORY_SHIFT', 'GOAL_RISK', 'CASHFLOW_RISK', 'PARSER_ISSUE', 'SYSTEM');

-- AlterTable
ALTER TABLE "Budget" ADD COLUMN "thresholdPercent" INTEGER NOT NULL DEFAULT 80,
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "targetAmount" DECIMAL(18,2) NOT NULL,
    "savedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "targetDate" TIMESTAMP(3),
    "months" INTEGER,
    "priority" "GoalPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "threshold" DECIMAL(18,2),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Budget_userId_isActive_idx" ON "Budget"("userId", "isActive");

-- CreateIndex
CREATE INDEX "Goal_userId_status_idx" ON "Goal"("userId", "status");

-- CreateIndex
CREATE INDEX "Goal_userId_targetDate_idx" ON "Goal"("userId", "targetDate");

-- CreateIndex
CREATE INDEX "Alert_userId_isRead_createdAt_idx" ON "Alert"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_userId_severity_createdAt_idx" ON "Alert"("userId", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_resourceType_resourceId_idx" ON "Alert"("resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertSetting_userId_type_key" ON "AlertSetting"("userId", "type");

-- CreateIndex
CREATE INDEX "AlertSetting_userId_inAppEnabled_idx" ON "AlertSetting"("userId", "inAppEnabled");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertSetting" ADD CONSTRAINT "AlertSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
