ALTER TABLE "Order" ALTER COLUMN "customerId" DROP NOT NULL;
ALTER TABLE "Order"
  ADD COLUMN "guestEmail" VARCHAR(254),
  ADD COLUMN "guestAccessTokenHash" VARCHAR(64),
  ADD COLUMN "guestAccessExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Order_guestAccessTokenHash_key" ON "Order"("guestAccessTokenHash");
CREATE INDEX "Order_guestEmail_createdAt_idx" ON "Order"("guestEmail", "createdAt");

ALTER TABLE "Notification" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Notification" ADD COLUMN "emailSecretEncrypted" VARCHAR(300);

ALTER TABLE "Order" ADD CONSTRAINT "Order_customer_or_guest_check" CHECK (
  ("customerId" IS NOT NULL AND "guestEmail" IS NULL AND "guestAccessTokenHash" IS NULL AND "guestAccessExpiresAt" IS NULL)
  OR
  ("customerId" IS NULL AND "guestEmail" IS NOT NULL AND "guestAccessTokenHash" IS NOT NULL AND "guestAccessExpiresAt" IS NOT NULL)
);
