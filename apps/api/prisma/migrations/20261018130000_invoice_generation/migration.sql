ALTER TABLE "Order"
    ADD COLUMN "invoiceNumber" VARCHAR(80),
    ADD COLUMN "invoiceIssuedAt" TIMESTAMP(3),
    ADD COLUMN "invoicePdf" BYTEA;

UPDATE "Order"
SET "invoiceNumber" = 'FACT-' || "orderNumber",
    "invoiceIssuedAt" = "createdAt";

CREATE UNIQUE INDEX "Order_invoiceNumber_key" ON "Order"("invoiceNumber");

ALTER TABLE "OrderLine"
    ADD COLUMN "purchaseVatRateSnapshot" DECIMAL(5,2);

\n