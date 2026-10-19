ALTER TABLE "VehicleMake"
  ADD COLUMN "source" TEXT,
  ADD COLUMN "sourceReference" TEXT;

ALTER TABLE "VehicleModel"
  ADD COLUMN "category" VARCHAR(50),
  ADD COLUMN "source" TEXT,
  ADD COLUMN "sourceReference" TEXT;
