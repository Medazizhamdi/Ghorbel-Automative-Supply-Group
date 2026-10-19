import assert from 'node:assert/strict';
import test from 'node:test';
import { supplierInvoiceLines, supplierOrderScope, supplierPurchaseTotals } from '../src/supplier-order.logic.js';

test('partner order query is scoped to the authenticated supplier offer owner', () => {
  assert.deepEqual(supplierOrderScope('supplier-aziz'), { supplierOffer: { supplierId: 'supplier-aziz' } });
});

test('supplier order totals use the frozen supplier cost and VAT', () => {
  assert.deepEqual(supplierPurchaseTotals({ quantity: 2, purchaseUnitPriceExclTaxSnapshot: '120.500', purchaseVatRateSnapshot: '19.00' }), {
    purchaseLineTotalExclTax: '241.000',
    purchaseLineTotalInclTax: '286.790',
  });
});

test('generated supplier invoice rows use the supplier SKU and supplier cost snapshot only', () => {
  const [row] = supplierInvoiceLines([{
    productNameSnapshot: 'Filtre à huile',
    supplierSkuSnapshot: 'AZ-FO-01',
    quantity: 3,
    purchaseUnitPriceExclTaxSnapshot: { toNumber: () => 18.25 },
    purchaseVatRateSnapshot: 19,
  }]);
  assert.deepEqual(row, { name: 'Filtre à huile', reference: 'AZ-FO-01', quantity: 3, unitPriceExclTax: 18.25, vatRate: 19 });
});

test('missing supplier price stays explicit instead of falling back to an admin or client price', () => {
  assert.deepEqual(supplierPurchaseTotals({ quantity: 1, purchaseUnitPriceExclTaxSnapshot: null, purchaseVatRateSnapshot: null }), {
    purchaseLineTotalExclTax: null,
    purchaseLineTotalInclTax: null,
  });
  assert.throws(() => supplierInvoiceLines([{
    productNameSnapshot: 'Pièce sans coût historique', supplierSkuSnapshot: 'AZ-NA', quantity: 1,
    purchaseUnitPriceExclTaxSnapshot: null, purchaseVatRateSnapshot: null,
  }]), /Missing frozen supplier purchase price/);
});
