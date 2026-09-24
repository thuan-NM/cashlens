-- DB-M5 (5/5), T065: the email outcome of an evaluator-created alert
-- (ALERT-005–ALERT-007). Schema only: no delivery row is backfilled for
-- existing alerts, and AlertSetting is not touched (I2: existing email
-- preferences are preserved unchanged).

-- CreateEnum
CREATE TYPE "AlertDeliveryChannel" AS ENUM ('EMAIL', 'IN_APP');

-- CreateEnum
CREATE TYPE "AlertDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "AlertDelivery" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "AlertDeliveryChannel" NOT NULL DEFAULT 'EMAIL',
    "provider" TEXT NOT NULL,
    "status" "AlertDeliveryStatus" NOT NULL,
    "skipReason" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertDelivery_userId_status_idx" ON "AlertDelivery"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AlertDelivery_alertId_channel_key" ON "AlertDelivery"("alertId", "channel");

-- AddForeignKey
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most three attempts per delivery (ALERT-006).
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_attemptCount_check"
  CHECK ("attemptCount" BETWEEN 0 AND 3);
