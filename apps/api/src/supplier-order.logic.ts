export type SupplierOrderAmount = number | string | { toNumber(): number };

export type SupplierOrderPriceSnapshot = {
  quantity: number;
  purchaseUnitPriceExclTaxSnapshot: SupplierOrderAmount | null;
  purchaseVatRateSnapshot: SupplierOrderAmount | null;
};

const amount = (value: SupplierOrderAmount | null | undefined) => {
  if (value == null) return null;
  return typeof value === 'object' ? value.toNumber() : Number(value);
};

/** Keeps supplier order queries scoped to the authenticated supplier's own offers. */
export const supplierOrderScope = (supplierId: string) => ({ supplierOffer: { supplierId } });

/** Calculates settlement totals only from the immutable supplier-side order snapshots. */
export const supplierPurchaseTotals = (line: SupplierOrderPriceSnapshot) => {
  const unitPrice = amount(line.purchaseUnitPriceExclTaxSnapshot);
  const vatRate = amount(line.purchaseVatRateSnapshot) ?? 0;
  const totalExclTax = unitPrice === null ? null : Math.round(unitPrice * line.quantity * 1000) / 1000;
  const totalInclTax = totalExclTax === null ? null : Math.round(totalExclTax * 1000 * (10000 + Math.round(vatRate * 100)) / 10000) / 1000;
  return {
    purchaseLineTotalExclTax: totalExclTax?.toFixed(3) ?? null,
    purchaseLineTotalInclTax: totalInclTax?.toFixed(3) ?? null,
  };
};

export type SupplierInvoiceSourceLine = SupplierOrderPriceSnapshot & {
  productNameSnapshot: string;
  supplierSkuSnapshot: string;
};

/** Creates invoice rows from the supplier's historical purchase price, never the client sale price. */
export const supplierInvoiceLines = (lines: SupplierInvoiceSourceLine[]) => lines.map((line) => {
  const unitPriceExclTax = amount(line.purchaseUnitPriceExclTaxSnapshot);
  if (unitPriceExclTax === null) throw new Error('Missing frozen supplier purchase price.');
  return {
    name: line.productNameSnapshot,
    reference: line.supplierSkuSnapshot,
    quantity: line.quantity,
    unitPriceExclTax,
    vatRate: amount(line.purchaseVatRateSnapshot) ?? 19,
  };
});
