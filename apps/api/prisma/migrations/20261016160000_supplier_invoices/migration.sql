CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');
CREATE TYPE "SupplierInvoiceEventType" AS ENUM ('UPLOADED', 'RESUBMITTED', 'ACCEPTED', 'REJECTED');

CREATE TABLE "SupplierInvoice" (
  "id" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "invoiceNumber" VARCHAR(100) NOT NULL,
  "fileName" VARCHAR(140) NOT NULL,
  "mimeType" VARCHAR(80) NOT NULL DEFAULT 'application/pdf',
  "fileContent" BYTEA NOT NULL,
  "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'PENDING',
  "reviewNote" VARCHAR(1000),
  "reviewedById" UUID,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupplierInvoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupplierInvoice_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SupplierInvoice_supplierId_orderId_invoiceNumber_key" ON "SupplierInvoice"("supplierId", "orderId", "invoiceNumber");
CREATE INDEX "SupplierInvoice_supplierId_status_uploadedAt_idx" ON "SupplierInvoice"("supplierId", "status", "uploadedAt");
CREATE INDEX "SupplierInvoice_orderId_uploadedAt_idx" ON "SupplierInvoice"("orderId", "uploadedAt");

CREATE TABLE "SupplierInvoiceEvent" (
  "id" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "type" "SupplierInvoiceEventType" NOT NULL,
  "note" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierInvoiceEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierInvoiceEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupplierInvoiceEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "SupplierInvoiceEvent_invoiceId_createdAt_idx" ON "SupplierInvoiceEvent"("invoiceId", "createdAt");
