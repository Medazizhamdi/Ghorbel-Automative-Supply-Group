CREATE TABLE "PaymentProof" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "uploadedById" UUID,
  "fileName" VARCHAR(160) NOT NULL,
  "mimeType" VARCHAR(80) NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "fileContent" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentProof_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentProof_orderId_createdAt_idx" ON "PaymentProof"("orderId", "createdAt");
CREATE INDEX "PaymentProof_uploadedById_createdAt_idx" ON "PaymentProof"("uploadedById", "createdAt");
ALTER TABLE "PaymentProof" ADD CONSTRAINT "PaymentProof_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentProof" ADD CONSTRAINT "PaymentProof_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
