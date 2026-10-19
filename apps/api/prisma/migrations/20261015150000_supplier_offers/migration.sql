CREATE TYPE "SupplierOfferStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "SupplierOffer" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "supplierSku" TEXT NOT NULL,
    "purchasePrice" DECIMAL(12,3) NOT NULL,
    "purchaseVatRate" DECIMAL(5,2) NOT NULL DEFAULT 19,
    "currency" TEXT NOT NULL DEFAULT 'TND',
    "status" "SupplierOfferStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupplierOffer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierOffer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SupplierOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SupplierOffer_supplierId_supplierSku_key" ON "SupplierOffer"("supplierId", "supplierSku");
CREATE INDEX "SupplierOffer_supplierId_status_createdAt_idx" ON "SupplierOffer"("supplierId", "status", "createdAt");
CREATE INDEX "SupplierOffer_productId_status_idx" ON "SupplierOffer"("productId", "status");
