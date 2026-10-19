CREATE TYPE "PaymentMethod" AS ENUM ('CASH_ON_DELIVERY', 'BANK_TRANSFER');
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'TRANSFER_SUBMITTED', 'PAID');

ALTER TABLE "Order"
  ADD COLUMN "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH_ON_DELIVERY',
  ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN "transferReference" TEXT,
  ADD COLUMN "paymentConfirmedAt" TIMESTAMP(3);

CREATE TABLE "PaymentEvent" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "fromStatus" "PaymentStatus" NOT NULL,
  "toStatus" "PaymentStatus" NOT NULL,
  "transferReference" TEXT,
  "note" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentEvent_orderId_createdAt_idx" ON "PaymentEvent"("orderId", "createdAt");
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;