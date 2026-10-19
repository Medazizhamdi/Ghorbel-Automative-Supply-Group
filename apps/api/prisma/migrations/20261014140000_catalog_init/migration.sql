-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DataStatus" AS ENUM ('DEMONSTRATION', 'VERIFIED');

-- CreateEnum
CREATE TYPE "ReferenceType" AS ENUM ('OEM', 'ALTERNATIVE');

-- CreateTable
CREATE TABLE "VehicleMake" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "DataStatus" NOT NULL DEFAULT 'DEMONSTRATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleMake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleModel" (
    "id" UUID NOT NULL,
    "makeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "DataStatus" NOT NULL DEFAULT 'DEMONSTRATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleGeneration" (
    "id" UUID NOT NULL,
    "modelId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "yearFrom" INTEGER NOT NULL,
    "yearTo" INTEGER,
    "status" "DataStatus" NOT NULL DEFAULT 'DEMONSTRATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Engine" (
    "id" UUID NOT NULL,
    "generationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "fuel" TEXT,
    "displacementCc" INTEGER,
    "powerKw" INTEGER,
    "engineCode" TEXT,
    "status" "DataStatus" NOT NULL DEFAULT 'DEMONSTRATION',

    CONSTRAINT "Engine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleVariant" (
    "id" UUID NOT NULL,
    "generationId" UUID NOT NULL,
    "engineId" UUID,
    "name" TEXT NOT NULL,
    "bodyStyle" TEXT,
    "transmission" TEXT,
    "drivetrain" TEXT,
    "status" "DataStatus" NOT NULL DEFAULT 'DEMONSTRATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "pieceBrand" TEXT,
    "status" "DataStatus" NOT NULL DEFAULT 'DEMONSTRATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductReference" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "type" "ReferenceType" NOT NULL,
    "source" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "ProductReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleCompatibility" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "generationId" UUID NOT NULL,
    "engineId" UUID,
    "variantId" UUID,
    "yearFrom" INTEGER NOT NULL,
    "yearTo" INTEGER,
    "source" TEXT NOT NULL,
    "sourceReference" TEXT,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleCompatibility_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleMake_name_key" ON "VehicleMake"("name");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleMake_slug_key" ON "VehicleMake"("slug");

-- CreateIndex
CREATE INDEX "VehicleModel_makeId_name_idx" ON "VehicleModel"("makeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleModel_makeId_slug_key" ON "VehicleModel"("makeId", "slug");

-- CreateIndex
CREATE INDEX "VehicleGeneration_modelId_yearFrom_yearTo_idx" ON "VehicleGeneration"("modelId", "yearFrom", "yearTo");

-- CreateIndex
CREATE INDEX "Engine_generationId_name_idx" ON "Engine"("generationId", "name");

-- CreateIndex
CREATE INDEX "Engine_engineCode_idx" ON "Engine"("engineCode");

-- CreateIndex
CREATE INDEX "VehicleVariant_generationId_name_idx" ON "VehicleVariant"("generationId", "name");

-- CreateIndex
CREATE INDEX "VehicleVariant_engineId_idx" ON "VehicleVariant"("engineId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "ProductReference_normalized_type_idx" ON "ProductReference"("normalized", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ProductReference_normalized_productId_key" ON "ProductReference"("normalized", "productId");

-- CreateIndex
CREATE INDEX "VehicleCompatibility_generationId_engineId_yearFrom_yearTo_idx" ON "VehicleCompatibility"("generationId", "engineId", "yearFrom", "yearTo");

-- CreateIndex
CREATE INDEX "VehicleCompatibility_variantId_yearFrom_yearTo_idx" ON "VehicleCompatibility"("variantId", "yearFrom", "yearTo");

-- CreateIndex
CREATE INDEX "VehicleCompatibility_productId_idx" ON "VehicleCompatibility"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCompatibility_productId_generationId_engineId_yearFr_key" ON "VehicleCompatibility"("productId", "generationId", "engineId", "yearFrom", "yearTo");


-- AddForeignKey
ALTER TABLE "VehicleModel" ADD CONSTRAINT "VehicleModel_makeId_fkey" FOREIGN KEY ("makeId") REFERENCES "VehicleMake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleGeneration" ADD CONSTRAINT "VehicleGeneration_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "VehicleModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engine" ADD CONSTRAINT "Engine_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "VehicleGeneration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleVariant" ADD CONSTRAINT "VehicleVariant_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "VehicleGeneration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleVariant" ADD CONSTRAINT "VehicleVariant_engineId_fkey" FOREIGN KEY ("engineId") REFERENCES "Engine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReference" ADD CONSTRAINT "ProductReference_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCompatibility" ADD CONSTRAINT "VehicleCompatibility_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCompatibility" ADD CONSTRAINT "VehicleCompatibility_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "VehicleGeneration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCompatibility" ADD CONSTRAINT "VehicleCompatibility_engineId_fkey" FOREIGN KEY ("engineId") REFERENCES "Engine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCompatibility" ADD CONSTRAINT "VehicleCompatibility_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "VehicleVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
