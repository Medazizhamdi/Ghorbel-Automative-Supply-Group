CREATE TYPE "FitmentSuggestionStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

CREATE TABLE "PartnerFitmentSuggestion" (
    "id" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "generationId" UUID NOT NULL,
    "engineId" UUID,
    "variantId" UUID,
    "year" INTEGER NOT NULL,
    "status" "FitmentSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT,
    "sourceReference" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerFitmentSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerFitmentSuggestion_offerId_generationId_engineId_variantId_year_key"
ON "PartnerFitmentSuggestion"("offerId", "generationId", "engineId", "variantId", "year");
CREATE INDEX "PartnerFitmentSuggestion_status_createdAt_idx"
ON "PartnerFitmentSuggestion"("status", "createdAt");

ALTER TABLE "PartnerFitmentSuggestion" ADD CONSTRAINT "PartnerFitmentSuggestion_offerId_fkey"
FOREIGN KEY ("offerId") REFERENCES "SupplierOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerFitmentSuggestion" ADD CONSTRAINT "PartnerFitmentSuggestion_generationId_fkey"
FOREIGN KEY ("generationId") REFERENCES "VehicleGeneration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerFitmentSuggestion" ADD CONSTRAINT "PartnerFitmentSuggestion_engineId_fkey"
FOREIGN KEY ("engineId") REFERENCES "Engine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerFitmentSuggestion" ADD CONSTRAINT "PartnerFitmentSuggestion_variantId_fkey"
FOREIGN KEY ("variantId") REFERENCES "VehicleVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
