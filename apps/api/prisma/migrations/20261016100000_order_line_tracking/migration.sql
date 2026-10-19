ALTER TABLE "OrderLine"
  ADD COLUMN "carrierName" VARCHAR(80),
  ADD COLUMN "trackingReference" VARCHAR(120),
  ADD COLUMN "trackingUrl" VARCHAR(500);
