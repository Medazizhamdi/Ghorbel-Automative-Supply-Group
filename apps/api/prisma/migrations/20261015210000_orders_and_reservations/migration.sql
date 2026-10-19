CREATE TYPE "OrderStatus" AS ENUM ('PLACED', 'PROCESSING', 'PARTIALLY_SHIPPED', 'SHIPPED', 'DELIVERED');
CREATE TYPE "OrderLineStatus" AS ENUM ('RESERVED', 'ACCEPTED', 'PREPARING', 'SHIPPED', 'DELIVERED');
ALTER TYPE "StockMovementType" ADD VALUE 'SHIPMENT';

CREATE TABLE "Order" (
  "id" UUID NOT NULL,
  "orderNumber" TEXT NOT NULL,
  "customerId" UUID NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'PLACED',
  "currency" TEXT NOT NULL DEFAULT 'TND',
  "deliveryName" VARCHAR(160) NOT NULL,
  "deliveryPhone" VARCHAR(24) NOT NULL,
  "deliveryAddress" VARCHAR(300) NOT NULL,
  "deliveryCity" VARCHAR(100) NOT NULL,
  "subtotalExclTax" DECIMAL(12,3) NOT NULL,
  "vatTotal" DECIMAL(12,3) NOT NULL,
  "totalInclTax" DECIMAL(12,3) NOT NULL,
  "customerNote" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderLine" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "supplierOfferId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL,
  "stockItemId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" "OrderLineStatus" NOT NULL DEFAULT 'RESERVED',
  "productSkuSnapshot" TEXT NOT NULL,
  "productNameSnapshot" TEXT NOT NULL,
  "supplierSkuSnapshot" TEXT NOT NULL,
  "unitPriceExclTax" DECIMAL(12,3) NOT NULL,
  "vatRateSnapshot" DECIMAL(5,2) NOT NULL,
  "discountPercent" DECIMAL(5,2) NOT NULL,
  "unitPriceInclTax" DECIMAL(12,3) NOT NULL,
  "lineSubtotalExclTax" DECIMAL(12,3) NOT NULL,
  "lineVat" DECIMAL(12,3) NOT NULL,
  "lineTotalInclTax" DECIMAL(12,3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderLine_quantity_check" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");
CREATE INDEX "OrderLine_supplierOfferId_status_createdAt_idx" ON "OrderLine"("supplierOfferId", "status", "createdAt");
CREATE INDEX "OrderLine_warehouseId_createdAt_idx" ON "OrderLine"("warehouseId", "createdAt");
CREATE INDEX "OrderLine_stockItemId_idx" ON "OrderLine"("stockItemId");

ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_supplierOfferId_fkey" FOREIGN KEY ("supplierOfferId") REFERENCES "SupplierOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;