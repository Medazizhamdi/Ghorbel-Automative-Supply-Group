CREATE TABLE "CompanySettings" (
  "id" VARCHAR(40) NOT NULL DEFAULT 'default',
  "bankTransferEnabled" BOOLEAN NOT NULL DEFAULT false,
  "bankAccountHolder" VARCHAR(160),
  "bankName" VARCHAR(120),
  "bankRib" VARCHAR(64),
  "bankInstructions" VARCHAR(1000),
  "updatedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanySettings_updatedById_idx" ON "CompanySettings"("updatedById");
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
