CREATE TABLE "CustomerAddress" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "recipientName" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(24) NOT NULL,
    "address" VARCHAR(300) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerAddress_userId_isDefault_createdAt_idx" ON "CustomerAddress"("userId", "isDefault", "createdAt");
CREATE UNIQUE INDEX "CustomerAddress_one_default_per_user_idx" ON "CustomerAddress"("userId") WHERE "isDefault" = true;

ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
