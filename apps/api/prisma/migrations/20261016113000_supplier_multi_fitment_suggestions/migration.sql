ALTER TABLE "VehicleGeneration"
  ADD COLUMN "source" TEXT,
  ADD COLUMN "sourceReference" TEXT;

ALTER TABLE "Engine"
  ADD COLUMN "source" TEXT,
  ADD COLUMN "sourceReference" TEXT;

ALTER TABLE "VehicleVariant"
  ADD COLUMN "source" TEXT,
  ADD COLUMN "sourceReference" TEXT;

ALTER TABLE "PartnerFitmentSuggestion"
  ALTER COLUMN "generationId" DROP NOT NULL,
  ADD COLUMN "yearTo" INTEGER,
  ADD COLUMN "makeName" TEXT,
  ADD COLUMN "modelName" TEXT,
  ADD COLUMN "generationName" TEXT,
  ADD COLUMN "vehicleCategory" TEXT,
  ADD COLUMN "engineName" TEXT,
  ADD COLUMN "engineCode" TEXT,
  ADD COLUMN "fuel" TEXT,
  ADD COLUMN "displacementCc" INTEGER,
  ADD COLUMN "powerKw" INTEGER,
  ADD COLUMN "variantName" TEXT,
  ADD COLUMN "bodyStyle" TEXT,
  ADD COLUMN "transmission" TEXT,
  ADD COLUMN "drivetrain" TEXT;
