-- Keep completed customer orders and their immutable line snapshots when a
-- supplier and its live catalog are deleted.
ALTER TABLE "SupplierOffer" ALTER COLUMN "supplierId" DROP NOT NULL;
ALTER TABLE "SupplierOffer" DROP CONSTRAINT "SupplierOffer_supplierId_fkey";
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ImportJob" ALTER COLUMN "uploadedById" DROP NOT NULL;
ALTER TABLE "ImportJob" DROP CONSTRAINT "ImportJob_uploadedById_fkey";
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Order" DROP CONSTRAINT "Order_customerId_fkey";
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderLine" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "OrderLine" ALTER COLUMN "supplierOfferId" DROP NOT NULL;
ALTER TABLE "OrderLine" ALTER COLUMN "warehouseId" DROP NOT NULL;
ALTER TABLE "OrderLine" ALTER COLUMN "stockItemId" DROP NOT NULL;
ALTER TABLE "OrderLine" DROP CONSTRAINT "OrderLine_productId_fkey";
ALTER TABLE "OrderLine" DROP CONSTRAINT "OrderLine_supplierOfferId_fkey";
ALTER TABLE "OrderLine" DROP CONSTRAINT "OrderLine_warehouseId_fkey";
ALTER TABLE "OrderLine" DROP CONSTRAINT "OrderLine_stockItemId_fkey";
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_supplierOfferId_fkey"
  FOREIGN KEY ("supplierOfferId") REFERENCES "SupplierOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_stockItemId_fkey"
  FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
