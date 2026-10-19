CREATE TABLE "ProfileCategoryPrice" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileCategoryPrice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProfileCategoryPrice_profileId_category_key" ON "ProfileCategoryPrice"("profileId", "category");
CREATE INDEX "ProfileCategoryPrice_category_idx" ON "ProfileCategoryPrice"("category");

ALTER TABLE "ProfileCategoryPrice" ADD CONSTRAINT "ProfileCategoryPrice_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "PricingProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
