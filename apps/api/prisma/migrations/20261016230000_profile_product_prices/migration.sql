CREATE TABLE "ProfileProductPrice" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileProductPrice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProfileProductPrice_profileId_productId_key" ON "ProfileProductPrice"("profileId", "productId");
CREATE INDEX "ProfileProductPrice_productId_idx" ON "ProfileProductPrice"("productId");

ALTER TABLE "ProfileProductPrice" ADD CONSTRAINT "ProfileProductPrice_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "PricingProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfileProductPrice" ADD CONSTRAINT "ProfileProductPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
