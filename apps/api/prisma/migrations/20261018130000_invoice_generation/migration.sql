ALTER TABLE "Order"
    ADD COLUMN IF NOT EXISTS "invoiceNumber" VARCHAR(80),
    ADD COLUMN IF NOT EXISTS "invoiceIssuedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "invoicePdf" BYTEA;

UPDATE "Order"
SET "invoiceNumber" = 'FACT-' || "orderNumber",
    "invoiceIssuedAt" = "createdAt";

CREATE UNIQUE INDEX IF NOT EXISTS "Order_invoiceNumber_key" ON "Order"("invoiceNumber");

ALTER TABLE "OrderLine"
    ADD COLUMN IF NOT EXISTS "purchaseVatRateSnapshot" DECIMAL(5,2);
