CREATE TYPE "NotificationEmailStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SENT', 'FAILED');

CREATE TABLE "Notification" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "eventKey" TEXT NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "message" VARCHAR(1000) NOT NULL,
  "link" VARCHAR(300),
  "emailTo" VARCHAR(254) NOT NULL,
  "emailStatus" "NotificationEmailStatus" NOT NULL DEFAULT 'QUEUED',
  "emailAttempts" INTEGER NOT NULL DEFAULT 0,
  "emailNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "emailLockedAt" TIMESTAMP(3),
  "emailSentAt" TIMESTAMP(3),
  "emailLastError" VARCHAR(1000),
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Notification_eventKey_key" ON "Notification"("eventKey");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX "Notification_emailStatus_emailNextAttemptAt_idx" ON "Notification"("emailStatus", "emailNextAttemptAt");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
