CREATE TYPE "SupplierLegalProfileStatus" AS ENUM ('PENDING', 'APPROVED', 'REVIEW_REQUIRED');
ALTER TABLE "User"
  ADD COLUMN "legalName" TEXT,
  ADD COLUMN "tradeName" TEXT,
  ADD COLUMN "businessAddress" TEXT,
  ADD COLUMN "businessCity" TEXT,
  ADD COLUMN "postalCode" TEXT,
  ADD COLUMN "taxIdentifier" TEXT,
  ADD COLUMN "commercialRegisterNumber" TEXT,
  ADD COLUMN "legalProfileStatus" "SupplierLegalProfileStatus" NOT NULL DEFAULT 'PENDING';
