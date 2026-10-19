CREATE TYPE "ProductPricingMode" AS ENUM ('MANUAL', 'MARGIN');
ALTER TABLE "Product" ADD COLUMN "pricingMode" "ProductPricingMode" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "CompanySettings" ADD COLUMN "defaultMarginPercent" DECIMAL(6,2) NOT NULL DEFAULT 0;
CREATE TABLE "CategoryMargin" (
  "id" UUID NOT NULL,
  "category" VARCHAR(100) NOT NULL,
  "marginPercent" DECIMAL(6,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CategoryMargin_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CategoryMargin_category_key" ON "CategoryMargin"("category");
CREATE INDEX "CategoryMargin_category_idx" ON "CategoryMargin"("category");
