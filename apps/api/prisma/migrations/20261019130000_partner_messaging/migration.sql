CREATE TYPE "PartnerConversationStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "PartnerConversation" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "subject" VARCHAR(180) NOT NULL,
    "status" "PartnerConversationStatus" NOT NULL DEFAULT 'OPEN',
    "relatedOrderId" UUID,
    "relatedOfferId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartnerConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerConversationMessage" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "attachmentName" VARCHAR(255),
    "attachmentMimeType" VARCHAR(100),
    "attachmentBytes" BYTEA,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PartnerConversation_supplierId_status_updatedAt_idx" ON "PartnerConversation"("supplierId", "status", "updatedAt");
CREATE INDEX "PartnerConversation_relatedOrderId_idx" ON "PartnerConversation"("relatedOrderId");
CREATE INDEX "PartnerConversation_relatedOfferId_idx" ON "PartnerConversation"("relatedOfferId");
CREATE INDEX "PartnerConversationMessage_conversationId_createdAt_idx" ON "PartnerConversationMessage"("conversationId", "createdAt");
CREATE INDEX "PartnerConversationMessage_senderId_readAt_idx" ON "PartnerConversationMessage"("senderId", "readAt");

ALTER TABLE "PartnerConversation" ADD CONSTRAINT "PartnerConversation_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerConversation" ADD CONSTRAINT "PartnerConversation_relatedOrderId_fkey" FOREIGN KEY ("relatedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PartnerConversation" ADD CONSTRAINT "PartnerConversation_relatedOfferId_fkey" FOREIGN KEY ("relatedOfferId") REFERENCES "SupplierOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PartnerConversationMessage" ADD CONSTRAINT "PartnerConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "PartnerConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerConversationMessage" ADD CONSTRAINT "PartnerConversationMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
