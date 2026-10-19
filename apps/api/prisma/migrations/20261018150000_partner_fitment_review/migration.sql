-- Align the generated fitment suggestion index name with the current Prisma model.
ALTER INDEX "PartnerFitmentSuggestion_offerId_generationId_engineId_variantI"
  RENAME TO "PartnerFitmentSuggestion_offerId_generationId_engineId_vari_key";
