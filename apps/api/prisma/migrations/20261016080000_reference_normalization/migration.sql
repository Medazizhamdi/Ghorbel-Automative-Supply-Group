-- Normalize case and whitespace only; punctuation can be significant in automotive references.
UPDATE "ProductReference"
SET "normalized" = upper(regexp_replace("value", '[[:space:]]+', '', 'g'));
