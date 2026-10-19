CREATE TABLE "PricingProfile" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PricingProfile_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "User" ADD COLUMN "pricingProfileId" UUID;
ALTER TABLE "Product" ADD COLUMN "listPrice" DECIMAL(12,3), ADD COLUMN "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 19;

CREATE UNIQUE INDEX "PricingProfile_name_key" ON "PricingProfile"("name");
CREATE INDEX "User_pricingProfileId_idx" ON "User"("pricingProfileId");
ALTER TABLE "User" ADD CONSTRAINT "User_pricingProfileId_fkey" FOREIGN KEY ("pricingProfileId") REFERENCES "PricingProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
