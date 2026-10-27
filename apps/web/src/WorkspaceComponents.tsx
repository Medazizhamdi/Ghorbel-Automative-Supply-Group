import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, BadgeCheck, Bell, Box, CarFront, CheckCheck, ChevronDown, CircleHelp, Eye, FileSearch, Gauge, Menu, PackageSearch, Search, ShieldCheck, ShoppingCart, X, Truck, Wrench } from 'lucide-react';

const isLocalDevelopment = import.meta.env.DEV && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API = (isLocalDevelopment ? '' : (import.meta.env.VITE_API_URL || '')).replace(/\/$/, '');
const imageSource = (value: string) => value.startsWith('/uploads/') ? `${API}${value}${value.includes('?') ? '&' : '?'}v=2` : value;
type Row = { id: string; name: string; category?: string | null; yearFrom?: number; yearTo?: number | null; fuel?: string | null; displacementCc?: number | null; powerKw?: number | null; engineCode?: string | null; bodyStyle?: string | null; transmission?: string | null; drivetrain?: string | null };
const engineLabel = (item: Row) => [item.engineCode, item.fuel, item.displacementCc && item.displacementCc + ' cm³', item.powerKw && item.powerKw + ' kW'].filter(Boolean).join(' · ');
type Product = { id: string; sku: string; name: string; description?: string | null; category?: string | null; pieceBrand?: string | null; images?: string[]; references: { value: string; type: string; verifiedAt?: string | null; source?: string | null }[]; compatibilities?: { yearFrom: number; yearTo: number | null; source?: string; generation: { name: string; model: { name: string; make: { name: string } } }; engine: { name: string; engineCode: string | null; fuel: string | null; displacementCc: number | null; powerKw: number | null } | null; variant: { name: string; bodyStyle: string | null; transmission: string | null; drivetrain: string | null } | null }[]; availableQuantity?: number; pricing?: { currency: string; listPriceExclTax: string; discountPercent: string; unitPriceExclTax: string; vatRate: string; unitPriceInclTax: string } | null };
type PartnerFitmentSuggestion = { id: string; generationId?: string | null; engineId?: string | null; variantId?: string | null; year: number; yearTo?: number | null; makeName?: string | null; modelName?: string | null; generationName?: string | null; vehicleCategory?: string | null; engineName?: string | null; engineCode?: string | null; fuel?: string | null; displacementCc?: number | null; powerKw?: number | null; variantName?: string | null; bodyStyle?: string | null; transmission?: string | null; drivetrain?: string | null; status: string; source?: string | null; sourceReference?: string | null; generation?: { id: string; name: string; model: { id: string; name: string; category?: string | null; make: { id: string; name: string } } } | null; engine: { name: string; engineCode?: string | null; fuel?: string | null } | null; variant: { name: string; bodyStyle?: string | null; transmission?: string | null } | null };
const fitmentSuggestionLabel = (item: PartnerFitmentSuggestion) => {
  const make = item.generation?.model.make.name || item.makeName || '';
  const model = item.generation?.model.name || item.modelName || '';
  const generation = item.generation?.name || item.generationName || '';
  const engine = item.engine?.engineCode || item.engine?.name || item.engineCode || item.engineName;
  const variant = item.variant?.name || item.variantName;
  return [make, model, generation, `${item.year}${item.yearTo && item.yearTo !== item.year ? `–${item.yearTo}` : ''}`, engine, item.fuel || item.engine?.fuel, item.displacementCc && `${item.displacementCc} cm³`, item.powerKw && `${item.powerKw} kW`, variant, item.bodyStyle, item.transmission, item.drivetrain].filter(Boolean).join(' · ');
};
type AdminSupplierOffer = { id: string; supplierSku: string; purchasePrice: string | number; pendingPurchasePrice?: string | number | null; purchaseVatRate: string | number; status: string; product: { name: string; references: { value: string; type: string }[] }; supplier: { companyName?: string | null; email: string }; fitmentSuggestions: PartnerFitmentSuggestion[] };
type CartLine = { product: Product; quantity: number };
function CartToast() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    let timer = 0;
    const show = (event: Event) => {
      const productName = (event as CustomEvent<string>).detail;
      setMessage(`${productName} ajouté au panier.`);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMessage(''), 3200);
    };
    window.addEventListener('ap360:cart-added', show);
    return () => { window.clearTimeout(timer); window.removeEventListener('ap360:cart-added', show); };
  }, []);
  return message ? <div className="cart-confirmation-toast" role="status" aria-live="polite"><CheckCheck size={18}/><span>{message}</span></div> : null;
}
async function getRows<T>(path: string): Promise<T[]> {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error('API indisponible');
  return (await response.json()).data as T[];
}

type AppNotification = { id: string; title: string; message: string; link?: string | null; readAt?: string | null; createdAt: string };
function NotificationCenter() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]); const [unread, setUnread] = useState(0); const [open, setOpen] = useState(false); const [error, setError] = useState('');
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const positionPopover = () => {
    const rect = toggleRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(0, Math.min(370, window.innerWidth - 24));
    const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
    const below = Math.max(0, window.innerHeight - rect.bottom - 22);
    const above = Math.max(0, rect.top - 22);
    const maxHeight = Math.min(440, Math.max(100, window.innerHeight - 24), Math.max(below, above));
    const preferredTop = below >= above ? rect.bottom + 10 : rect.top - maxHeight - 10;
    const top = Math.max(12, Math.min(preferredTop, window.innerHeight - maxHeight - 12));
    setPopoverPosition({ top, left, width, maxHeight });
  };
  useEffect(() => {
    if (!open) { setPopoverPosition(null); return; }
    positionPopover();
    const update = () => positionPopover();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [open]);
  const load = async () => { const token = sessionStorage.getItem('ap360-token') || ''; if (!token) return; const response = await fetch(`${API}/api/notifications`, { headers: { Authorization: `Bearer ${token}` } }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Chargement des notifications impossible.'); setItems(result.data); setUnread(result.unreadCount); };
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'API indisponible.')); const timer = window.setInterval(() => { void load().catch(() => undefined); }, 60_000); return () => window.clearInterval(timer); }, []);
  const markRead = async (id: string) => { const token = sessionStorage.getItem('ap360-token') || ''; try { const response = await fetch(`${API}/api/notifications/${id}/read`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } }); if (!response.ok && response.status !== 404) throw new Error('Mise à jour impossible.'); setItems((current) => current.map((item) => item.id === id ? { ...item, readAt: item.readAt || new Date().toISOString() } : item)); setUnread((count) => Math.max(0, count - (items.find((item) => item.id === id && !item.readAt) ? 1 : 0))); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Mise à jour impossible.'); } };
  const markAllRead = async () => { const token = sessionStorage.getItem('ap360-token') || ''; try { const response = await fetch(`${API}/api/notifications/read-all`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error('Mise à jour impossible.'); setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() }))); setUnread(0); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Mise à jour impossible.'); } };
  return <div className="notification-center"><button ref={toggleRef} className="notification-toggle" aria-label={`Notifications${unread ? `, ${unread} non lue(s)` : ''}`} aria-expanded={open} onClick={() => { setOpen((value) => !value); setError(''); }}><Bell size={17}/>{unread > 0 && <span>{unread > 99 ? '99+' : unread}</span>}</button>{open && popoverPosition && createPortal(<section className="notification-popover" aria-label="Centre de notifications" style={{ position: 'fixed', top: popoverPosition.top, left: popoverPosition.left, right: 'auto', width: popoverPosition.width, maxHeight: popoverPosition.maxHeight, zIndex: 3000 }}><header><strong>Notifications</strong><button onClick={() => void markAllRead()} disabled={!unread}><CheckCheck size={15}/> Tout lire</button></header>{error && <p className="notification-error">{error}</p>}{items.length === 0 ? <p className="notification-empty">Aucune notification pour le moment.</p> : <div>{items.map((item) => <a key={item.id} href={item.link || '#'} className={item.readAt ? '' : 'unread'} onClick={(event) => { event.preventDefault(); void (async () => { if (!item.readAt) await markRead(item.id); setOpen(false); if (item.link) navigate(item.link); })(); }}><strong>{item.title}</strong><span>{item.message}</span><small>{new Date(item.createdAt).toLocaleString('fr-FR')}</small></a>)}</div>}</section>, document.body)}</div>;
}

type AdminDashboardData = {
  periodDays: number;
  sales: { orderCount: number; totalInclTax: string; averageBasketInclTax: string };
  previousPeriod: { orderCount: number; totalInclTax: string; changePercent: number | null };
  today: { orderCount: number; totalInclTax: string; collectedOrderCount: number; collectedInclTax: string };
  month: { orderCount: number; totalInclTax: string };
  year: { orderCount: number; totalInclTax: string };
  orderFlow: { total: number; cancelled: number; toProcess: number; shippedOrDelivered: number; awaitingPayment: number };
  attention: { transfersToReview: number; pendingOffers: number; invoicesToReview: number; missingSupplierInvoices: number };
  partners: { activeAccounts: number; activeCustomers: number; activeSuppliers: number };
  catalog: { verified: number; demonstration: number; referencesAvailable: number };
  stock: { physical: number; reserved: number; damaged: number; onOrder: number; outOfStockProducts: number; lowStockProducts: number };
  grossMargin: { salesExclTax: string; purchaseCostExclTax: string; amountExclTax: string; ratePercent: number | null; coveredLineCount: number; missingCostLineCount: number };
  dailySales: { day: string; orderCount: number; total: number }[];
  topProducts: { name: string; sku: string; quantity: number; total: number }[];
  categorySales: { category: string; total: number }[];
  salesByBuyer: { buyer: string; role: string; orderCount: number; total: number }[];
  salesBySupplier: { supplier: string; orderCount: number; quantity: number; total: number }[];
};
const formatTnd = (value: number | string) => `${Number(value).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} TND`;
function AdminDashboard() {
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');
  const query = useQuery({ queryKey: ['admin-dashboard', days], queryFn: async () => {
    const token = sessionStorage.getItem('ap360-token') || '';
    const response = await fetch(`${API}/api/admin/dashboard/summary?days=${days}`, { headers: { Authorization: `Bearer ${token}` } });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Chargement du tableau de bord impossible.');
    return result.data as AdminDashboardData;
  } });
  const exportSales = async () => {
    setExportBusy(true); setExportError('');
    try {
      const token = sessionStorage.getItem('ap360-token') || '';
      const response = await fetch(`${API}/api/admin/reports/sales.csv?days=${days}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'Export impossible.'); }
      const href = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = href; anchor.download = `autopieces-ventes-${days}j.csv`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (reason) { setExportError(reason instanceof Error ? reason.message : 'Export impossible.'); }
    finally { setExportBusy(false); }
  };
  const data = query.data;
  const maxDailyTotal = Math.max(1, ...(data?.dailySales.map((item) => item.total) ?? [1]));
  const maxCategoryTotal = Math.max(1, ...(data?.categorySales.map((item) => item.total) ?? [1]));
  const comparison = data?.previousPeriod.changePercent ?? null;
  return <section className="admin-analytics" id="admin-dashboard" aria-label="Indicateurs de gestion">
    <header><div><span className="partner-panel-eyebrow">PILOTAGE COMMERCIAL</span><h3>Vue d’ensemble</h3><p>Les ventes enregistrées sont distinctes des paiements réellement confirmés.</p></div><div><label htmlFor="admin-dashboard-period">Période</label><select id="admin-dashboard-period" value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>7 jours</option><option value={30}>30 jours</option><option value={90}>90 jours</option></select><button onClick={() => void query.refetch()} disabled={query.isFetching}>{query.isFetching ? 'Actualisation…' : 'Actualiser'}</button><button onClick={() => void exportSales()} disabled={exportBusy}>{exportBusy ? 'Export…' : 'Exporter ventes CSV'}</button></div></header>
    {exportError && <div className="auth-alert error">{exportError}</div>}{query.isPending ? <div className="admin-empty">Chargement des indicateurs…</div> : query.isError ? <div className="auth-alert error">{query.error instanceof Error ? query.error.message : 'Chargement impossible.'}</div> : data && <>
      <div className="admin-kpis analytics-kpis">
        <article><span>Chiffre d’affaires aujourd’hui</span><strong>{formatTnd(data.today.totalInclTax)}</strong><small>{data.today.orderCount} commande(s) · jour tunisien</small></article>
        <article><span>Chiffre d’affaires du mois</span><strong>{formatTnd(data.month.totalInclTax)}</strong><small>{data.month.orderCount} commande(s) non annulée(s)</small></article>
        <article><span>Chiffre d’affaires de l’année</span><strong>{formatTnd(data.year.totalInclTax)}</strong><small>{data.year.orderCount} commande(s) non annulée(s)</small></article>
        <article><span>Ventes TTC · {days} jours</span><strong>{formatTnd(data.sales.totalInclTax)}</strong><small className={comparison === null ? '' : comparison >= 0 ? 'kpi-change positive' : 'kpi-change negative'}>{comparison === null ? 'Comparaison précédente indisponible' : `${comparison > 0 ? '+' : ''}${comparison.toLocaleString('fr-FR')} % vs période précédente`} · {data.sales.orderCount} commande(s)</small></article>
        <article><span>Panier moyen TTC</span><strong>{formatTnd(data.sales.averageBasketInclTax)}</strong><small>Ventes enregistrées ÷ commandes non annulées</small></article>
        <article><span>Commandes à traiter</span><strong>{data.orderFlow.toProcess}</strong><small>Placées ou en cours de préparation</small></article>
        <article><span>Commandes en attente de paiement</span><strong>{data.orderFlow.awaitingPayment}</strong><small>Les virements déclarés restent à vérifier</small></article>
        <article><span>Commandes expédiées ou livrées</span><strong>{data.orderFlow.shippedOrDelivered}</strong><small>Sur {data.orderFlow.total} commande(s) non annulée(s)</small></article>
        <article><span>Commandes annulées</span><strong>{data.orderFlow.cancelled}</strong><button type="button" className="admin-kpi-link" onClick={() => navigate('/admin/orders?status=CANCELLED')}>Afficher les commandes annulées</button></article>
        <article><span>Encaissements confirmés aujourd’hui</span><strong>{formatTnd(data.today.collectedInclTax)}</strong><small>{data.today.collectedOrderCount} commande(s) payée(s), validation enregistrée</small></article>
        <article><span>Clients particuliers actifs</span><strong>{data.partners.activeCustomers}</strong><small>Comptes actifs</small></article>
        <article><span>Fournisseurs actifs</span><strong>{data.partners.activeSuppliers}</strong><small>{data.partners.activeAccounts} partenaire(s) actif(s), revendeurs inclus</small></article>
        <article><span>Références disponibles</span><strong>{data.catalog.referencesAvailable.toLocaleString('fr-FR')}</strong><small>Pièces vérifiées avec stock vendable</small></article>
        <article><span>Produits en rupture</span><strong>{data.stock.outOfStockProducts}</strong><small>Offre approuvée sans quantité disponible</small></article>
        <article><span>Produits en stock faible</span><strong>{data.stock.lowStockProducts}</strong><small>Quantité vendable sous le seuil configuré</small></article>
        <article><span>Stock · approuvé</span><strong>{data.stock.physical.toLocaleString('fr-FR')}</strong><small>{data.stock.reserved} réservé(s) · {data.stock.damaged} endommagé(s) · {data.stock.onOrder} en commande</small></article>
        <article><span>Catalogue vérifié</span><strong>{data.catalog.verified.toLocaleString('fr-FR')}</strong><small>{data.catalog.demonstration} pièce(s) en démonstration</small></article>
        <article><span>Marge brute estimée HT</span><strong>{formatTnd(data.grossMargin.amountExclTax)}</strong><small>{formatTnd(data.grossMargin.salesExclTax)} couverts · {data.grossMargin.ratePercent === null ? 'taux indisponible' : `${data.grossMargin.ratePercent.toLocaleString('fr-FR')} %`} · {data.grossMargin.missingCostLineCount} ligne(s) sans coût figé</small></article>
      </div>
      <div className="admin-attention-grid"><article><span>Virements à contrôler</span><b>{data.attention.transfersToReview}</b></article><article><span>Offres à valider</span><b>{data.attention.pendingOffers}</b></article><article><span>Factures à examiner</span><b>{data.attention.invoicesToReview}</b></article><article><span>Factures fournisseur manquantes</span><b>{data.attention.missingSupplierInvoices}</b><small>Commandes expédiées ou livrées, sur {days} jours</small></article><article><span>Partenaires actifs</span><b>{data.partners.activeAccounts}</b></article></div>
      <div className="admin-analytics-panels"><article><h4>Ventes quotidiennes TTC</h4><div className="admin-chart-scroll"><div className="admin-sales-chart">{data.dailySales.length === 0 ? <p className="admin-empty">Aucune vente sur cette période.</p> : data.dailySales.map((item) => <button type="button" key={item.day} title={`${item.day} · ${formatTnd(item.total)} · ${item.orderCount} commande(s) — cliquer pour afficher les commandes`} aria-label={`Voir les commandes du ${new Date(`${item.day}T00:00:00`).toLocaleDateString('fr-FR')} : ${formatTnd(item.total)}, ${item.orderCount} commande(s)`} onClick={() => navigate(`/admin/orders?from=${encodeURIComponent(item.day)}&to=${encodeURIComponent(item.day)}`)}><span style={{ height: `${Math.max(4, item.total / maxDailyTotal * 100)}%` }}/><small>{new Date(`${item.day}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</small></button>)}</div></div><small>Montants TTC de commandes créées, hors annulations; cliquez sur une journée pour afficher ses commandes. Les paiements sont suivis séparément.</small></article>
      <article><h4>Ventes TTC par catégorie</h4>{data.categorySales.length === 0 ? <p className="admin-empty">Aucune vente catégorisée.</p> : <div className="admin-category-chart">{data.categorySales.map((item) => <div key={item.category}><span>{item.category}</span><div><i style={{ width: `${Math.max(2, item.total / maxCategoryTotal * 100)}%` }}/></div><b>{formatTnd(item.total)}</b></div>)}</div>}</article>
      <article><h4>Pièces les plus vendues</h4>{data.topProducts.length === 0 ? <p className="admin-empty">Aucune pièce vendue sur cette période.</p> : <div className="admin-top-products">{data.topProducts.map((item, index) => <div key={`${item.sku}-${index}`}><b>{index + 1}</b><span>{item.name}<small>Réf. {item.sku} · {item.quantity} vendue(s)</small></span><strong>{formatTnd(item.total)}</strong></div>)}</div>}</article>
      <article><h4>Ventes par client ou revendeur</h4>{data.salesByBuyer.length === 0 ? <p className="admin-empty">Aucune commande sur cette période.</p> : <div className="admin-top-products">{data.salesByBuyer.map((item, index) => <div key={`${item.role}-${item.buyer}-${index}`}><b>{index + 1}</b><span>{item.buyer}<small>{item.role === 'RESELLER' ? 'Revendeur' : item.role === 'CUSTOMER' ? 'Particulier' : 'Invité'} · {item.orderCount} commande(s)</small></span><strong>{formatTnd(item.total)}</strong></div>)}</div>}</article>
      <article><h4>Ventes attribuées par fournisseur</h4>{data.salesBySupplier.length === 0 ? <p className="admin-empty">Aucune ligne exécutée sur cette période.</p> : <div className="admin-top-products">{data.salesBySupplier.map((item, index) => <div key={`${item.supplier}-${index}`}><b>{index + 1}</b><span>{item.supplier}<small>{item.orderCount} commande(s) · {item.quantity} pièce(s)</small></span><strong>{formatTnd(item.total)}</strong></div>)}</div>}<small>Part TTC des lignes attribuées; ceci ne représente ni les achats fournisseur ni la marge.</small></article></div>
    </>}
  </section>;
}

type AuditEntry = { id: string; action: string; entityType: string; entityId: string; details?: Record<string, unknown> | null; createdAt: string; actor: { firstName: string; lastName: string; email: string; role: string } };
type BankTransferDetails = { accountHolder: string; bankName: string; rib: string; instructions?: string | null };
type CompanyPaymentSettings = { id: string; bankTransferEnabled: boolean; bankAccountHolder?: string | null; bankName?: string | null; bankRib?: string | null; bankInstructions?: string | null; updatedAt?: string | null };
function AdminCompanyPaymentSettings() {
  const [settings, setSettings] = useState<CompanyPaymentSettings>({ id: 'default', bankTransferEnabled: false });
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const load = async () => { const token = sessionStorage.getItem('ap360-token') || ''; const response = await fetch(`${API}/api/admin/company-settings/payment`, { headers: { Authorization: `Bearer ${token}` } }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Chargement impossible.'); setSettings(result.data); };
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'API indisponible.')); }, []);
  const save = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const fields = new FormData(event.currentTarget); setBusy(true); setError(''); setMessage(''); try { const response = await fetch(`${API}/api/admin/company-settings/payment`, { method: 'PATCH', headers: { Authorization: `Bearer ${sessionStorage.getItem('ap360-token') || ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ bankTransferEnabled: fields.get('bankTransferEnabled') === 'on', bankAccountHolder: fields.get('bankAccountHolder'), bankName: fields.get('bankName'), bankRib: fields.get('bankRib'), bankInstructions: fields.get('bankInstructions') }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Enregistrement impossible.'); setSettings(result.data); setMessage(result.message); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Enregistrement impossible.'); } finally { setBusy(false); } };
  return <section className="admin-section" id="admin-payment-settings"><h3>Coordonnées de virement</h3><p className="auth-intro">Les informations sont enregistrées dans PostgreSQL. Elles sont visibles aux clients uniquement quand le virement est activé. Le paiement reste à vérifier manuellement.</p>{error && <div className="auth-alert error">{error}</div>}{message && <div className="auth-alert success">{message}</div>}<form className="company-payment-form" onSubmit={save}><label className="company-payment-toggle"><input type="checkbox" name="bankTransferEnabled" checked={settings.bankTransferEnabled} onChange={(event) => setSettings((current) => ({ ...current, bankTransferEnabled: event.target.checked }))}/> Activer le paiement par virement</label><button type="button" className="partner-secondary-action demo-rib-button" onClick={() => { setSettings((current) => ({ ...current, bankTransferEnabled: false, bankAccountHolder: "GHORBEL - COMPTE FICTIF", bankName: "Banque de demonstration", bankRib: "RIB-DEMO-000000000000", bankInstructions: "DONNEES FICTIVES - NE PAS EFFECTUER DE VIREMENT" })); setMessage("Coordonnees de demonstration pretes. Le virement reste desactive."); setError(""); }}>Préremplir des coordonnées fictives</button>{settings.bankRib?.startsWith("RIB-DEMO-") && <div className="auth-alert error">RIB fictif de démonstration : il est enregistré hors ligne de paiement et ne peut pas être activé.</div>}<div className="partner-create-grid"><label>Titulaire du compte<input name="bankAccountHolder" required={settings.bankTransferEnabled} maxLength={160} value={settings.bankAccountHolder || ''} onChange={(event) => setSettings((current) => ({ ...current, bankAccountHolder: event.target.value }))}/></label><label>Banque<input name="bankName" required={settings.bankTransferEnabled} maxLength={120} value={settings.bankName || ''} onChange={(event) => setSettings((current) => ({ ...current, bankName: event.target.value }))}/></label><label>RIB<input name="bankRib" required={settings.bankTransferEnabled} maxLength={64} value={settings.bankRib || ''} onChange={(event) => setSettings((current) => ({ ...current, bankRib: event.target.value }))}/></label><label className="company-payment-instructions">Instructions de paiement<textarea name="bankInstructions" maxLength={1000} value={settings.bankInstructions || ''} onChange={(event) => setSettings((current) => ({ ...current, bankInstructions: event.target.value }))}/></label></div><button className="auth-submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer les coordonnées'}</button>{settings.updatedAt && <small>Dernière mise à jour : {new Date(settings.updatedAt).toLocaleString('fr-FR')}</small>}</form></section>;
}

type AdminCatalogProduct = { id: string; sku: string; name: string; description?: string | null; category?: string | null; pieceBrand?: string | null; images: string[]; status: string; listPrice?: string | number | null; vatRate: string | number; availableQuantity?: number | null; hasPartnerOffer: boolean; partnerSuppliers: { id: string; name: string; email: string }[]; archivedAt?: string | null };
function AdminProductCatalog() {
  const token = sessionStorage.getItem('ap360-token') || '';
  const [products, setProducts] = useState<AdminCatalogProduct[]>([]);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<AdminCatalogProduct | null>(null);
  const [editingImages, setEditingImages] = useState<string[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const headers = { Authorization: `Bearer ${token}` };
  const load = async () => {
    const response = await fetch(`${API}/api/admin/products?includeArchived=true${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`, { headers });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Chargement du catalogue impossible.');
    setProducts(result.data);
    setSelectedIds([]);
  };
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'API indisponible.')); }, [search]);
  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!editing) return;
    const fields = new FormData(event.currentTarget);
    const body = { sku: String(fields.get('sku') || ''), name: String(fields.get('name') || ''), description: String(fields.get('description') || '').trim() || null, category: String(fields.get('category') || '').trim() || null, pieceBrand: String(fields.get('pieceBrand') || '').trim() || null, images: editingImages };
    setBusy(editing.id); setError('');
    try {
      const response = await fetch(`${API}/api/admin/products/${editing.id}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Modification impossible.');
      const manualPrice = String(fields.get('listPrice') || '').trim();
      if (!editing.hasPartnerOffer && manualPrice) {
        const pricingResponse = await fetch(`${API}/api/admin/products/${editing.id}/pricing`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'MANUAL', listPrice: Number(manualPrice), vatRate: 19 }) });
        const pricingResult = await pricingResponse.json(); if (!pricingResponse.ok) throw new Error(pricingResult.error || 'La fiche a été enregistrée, mais le prix n’a pas pu être modifié.');
      }
      const availableQuantity = String(fields.get('availableQuantity') ?? '').trim();
      if (!editing.hasPartnerOffer && availableQuantity !== '') {
        const stockResponse = await fetch(`${API}/api/admin/products/${editing.id}/stock`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ availableQuantity: Number(availableQuantity) }) });
        const stockResult = await stockResponse.json(); if (!stockResponse.ok) throw new Error(stockResult.error || 'La fiche est enregistrée, mais le stock n’a pas pu être modifié.');
      }
      setEditing(null); await load();
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Modification impossible.'); }
    finally { setBusy(''); }
  };
  const toggle = async (product: AdminCatalogProduct) => {
    const archived = !product.archivedAt;
    if (archived && !window.confirm(`Retirer « ${product.name} » du catalogue public ? Les commandes existantes seront conservées.`)) return;
    setBusy(product.id); setError('');
    try {
      const response = await fetch(`${API}/api/admin/products/${product.id}/archive`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ archived }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Mise à jour impossible.');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'API indisponible.'); }
    finally { setBusy(''); }
  };
  const togglePublication = async (product: AdminCatalogProduct) => {
    const published = product.status !== 'VERIFIED';
    setBusy(product.id); setError('');
    try { const response = await fetch(`${API}/api/admin/products/${product.id}/publication`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ published }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Publication impossible.'); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Publication impossible.'); }
    finally { setBusy(''); }
  };
  const selectAllVisible = products.length > 0 && products.every((product) => selectedIds.includes(product.id));
  const toggleAllVisible = () => setSelectedIds(selectAllVisible ? [] : products.map((product) => product.id));
  const deleteProducts = async (allDirect = false) => {
    const ids = selectedIds;
    if (!allDirect && !ids.length) return;
    const confirmation = allDirect
      ? 'Supprimer définitivement toutes les pièces gérées directement par GHORBEL ? Les pièces partenaires seront conservées. Les commandes garderont leurs désignations et montants enregistrés.'
      : `Supprimer définitivement les ${ids.length} pièce(s) sélectionnée(s) ? Les pièces partenaires seront protégées. Les commandes garderont leurs désignations et montants enregistrés.`;
    if (!window.confirm(confirmation)) return;
    setBusy('bulk-delete'); setError(''); setMessage('');
    try {
      const response = await fetch(`${API}/api/admin/products/bulk`, { method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(allDirect ? { allDirect: true } : { ids }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Suppression impossible.');
      setMessage(result.message || 'Suppression terminée.');
      setSelectedIds([]);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Suppression impossible.'); }
    finally { setBusy(''); }
  };
  return <section className="admin-section" id="admin-product-catalog"><div className="admin-audit-heading"><div><h3>Catalogue des pièces</h3><p className="auth-intro">Modifiez les fiches, leurs photos, et retirez du catalogue public sans effacer l’historique des commandes.</p></div><button className="partner-secondary-action" onClick={() => void load()} disabled={busy !== ''}>Actualiser</button></div>
    <label className="admin-audit-filter">Rechercher une pièce<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nom ou référence SKU" maxLength={100}/></label>
    {error && <div className="auth-alert error">{error}</div>}
    {message && <div className="auth-alert success">{message}</div>}
    <div className="admin-catalog-bulk"><label><input type="checkbox" checked={selectAllVisible} disabled={!products.length || busy !== ''} onChange={toggleAllVisible}/> Tout sélectionner parmi les résultats ({products.length})</label><span>{selectedIds.length} sélectionnée(s)</span><div><button type="button" className="partner-secondary-action" disabled={!selectedIds.length || busy !== ''} onClick={() => void deleteProducts()}>Supprimer la sélection</button><button type="button" className="decline" disabled={busy !== ''} onClick={() => void deleteProducts(true)}>Supprimer tout</button></div><small>« Supprimer tout » efface définitivement les pièces gérées par GHORBEL. Les pièces liées à des offres partenaires sont protégées.</small></div>
    {editing && <form className="partner-create-form admin-catalog-edit" onSubmit={(event) => void saveEdit(event)}><strong>Modifier « {editing.name} »</strong><div className="partner-create-grid"><label>Référence catalogue<input name="sku" required maxLength={100} defaultValue={editing.sku}/></label><label>Nom de la pièce<input name="name" required minLength={2} maxLength={180} defaultValue={editing.name}/></label><label>Catégorie<input name="category" maxLength={100} defaultValue={editing.category || ''}/></label><label>Marque de la pièce<input name="pieceBrand" maxLength={100} defaultValue={editing.pieceBrand || ''}/></label>{!editing.hasPartnerOffer && <><label>Prix de vente HT (TND)<input name="listPrice" type="number" min="0.001" step="0.001" defaultValue={editing.listPrice ?? ''} placeholder="Optionnel"/><small>Prix client GHORBEL modifiable directement ici.</small></label><label>Stock disponible GHORBEL<input name="availableQuantity" type="number" min="0" max="1000000" step="1" defaultValue={editing.availableQuantity ?? 0}/><small>Stock géré directement par GHORBEL, sans entrepôt.</small></label></>}<label className="company-payment-instructions">Description<textarea name="description" maxLength={5000} defaultValue={editing.description || ''}/></label><PartnerPhotoUpload endpoint="/api/admin/uploads/images" value={editingImages} onChange={setEditingImages} onUploading={setPhotoUploading}/></div>{editing.hasPartnerOffer && <small>Pièce partenaire : le fournisseur garde la gestion de son prix d’achat et de son stock dans son entrepôt. Le prix client est déterminé par la marge GHORBEL, dans « Prix et marges ».</small>}<div className="admin-actions"><button type="button" className="partner-secondary-action" onClick={() => setEditing(null)}>Annuler</button><button disabled={busy === editing.id || photoUploading}>{photoUploading ? 'Envoi des photos…' : busy === editing.id ? 'Enregistrement…' : 'Enregistrer les modifications'}</button></div></form>}
    {!products.length ? <div className="admin-empty">Aucune pièce ne correspond à la recherche.</div> : <div className="admin-list">{products.map((product) => <article className="admin-account" key={product.id}><div><label className="admin-catalog-select"><input type="checkbox" checked={selectedIds.includes(product.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, product.id] : current.filter((id) => id !== product.id))}/> Sélectionner</label><strong>{product.name} · {product.sku}</strong><span>{product.category || 'Sans catégorie'} · {product.status === 'VERIFIED' ? 'Publiée' : 'Démonstration'}{product.hasPartnerOffer ? ' · Partenaire' : ' · GHORBEL'}{product.archivedAt ? ' · Archivée' : ''}</span>{product.partnerSuppliers.map((partner) => <small key={partner.id}>Proposée par : {partner.name} · {partner.email}</small>)}{!product.hasPartnerOffer && <small>Stock GHORBEL : {product.availableQuantity ?? 0} disponible(s) · sans entrepôt</small>}<small>{product.listPrice == null ? 'Prix à confirmer' : `${Number(product.listPrice).toFixed(3)} TND HT · TVA 19 % (Taux normal)`}</small></div><div className="admin-actions">{!product.hasPartnerOffer && !product.archivedAt && <button className="partner-secondary-action" disabled={busy !== ''} onClick={() => void togglePublication(product)}>{busy === product.id ? 'Mise à jour…' : product.status === 'VERIFIED' ? 'Dépublier' : 'Publier'}</button>}<button className="partner-secondary-action" disabled={busy !== ''} onClick={() => { setEditing(product); setEditingImages(product.images || []); }}>Modifier</button><button className={product.archivedAt ? '' : 'decline'} disabled={busy === product.id} onClick={() => void toggle(product)}>{busy === product.id ? 'Mise à jour…' : product.archivedAt ? 'Rétablir' : 'Archiver'}</button></div></article>)}</div>}
    {products.length === 250 && <small>Affichage limité à 250 pièces. Utilisez la recherche pour affiner.</small>}
  </section>;
}

type VehicleImportPreviewRow = { line: number; make: string; model: string; category?: string; generation: string; yearFrom: number; yearTo?: number; engine?: string; engineCode?: string; fuel?: string; displacementCc?: number; powerKw?: number; variant?: string; bodyStyle?: string; transmission?: string; drivetrain?: string; source?: string; sourceReference?: string; verified: boolean; errors: string[] };
function VehicleCatalogImporter({ onImported }: { onImported: () => void }) {
  const [csv, setCsv] = useState(''); const [fileName, setFileName] = useState('catalogue-vehicules.csv'); const [preview, setPreview] = useState<{ jobId: string; acceptedRows: number; rejectedRows: number; rowCount: number; previewTruncated: boolean; rows: VehicleImportPreviewRow[] } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const token = sessionStorage.getItem('ap360-token') || '';
  const previewImport = async () => {
    if (!csv.trim()) return;
    if (new TextEncoder().encode(csv).byteLength > 2_000_000) { setError('Le fichier dépasse 2 Mo.'); return; }
    setBusy(true); setError(''); setMessage(''); setPreview(null);
    try {
      const response = await fetch(`${API}/api/admin/catalog/vehicles/imports/preview`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName, csv }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Prévisualisation impossible.'); setPreview(result.data); onImported();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Prévisualisation impossible.'); }
    finally { setBusy(false); }
  };
  const commitImport = async () => {
    if (!preview) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${API}/api/admin/catalog/vehicles/imports/${preview.jobId}/commit`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Import impossible.');
      setMessage(result.message || `${result.data.acceptedRows} véhicule(s) importé(s).`); setPreview(null); setCsv(''); onImported();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Import impossible.'); }
    finally { setBusy(false); }
  };
  return <section className="admin-section" id="admin-vehicle-import"><h3>Importer un référentiel de véhicules</h3><p className="auth-intro">Importez les véhicules sans créer de fiches pièce. Les lignes avec <code>verified=true</code> exigent une source vérifiable; les autres restent contributives jusqu’à vérification.</p><div className="import-toolbar"><a href="/vehicle-catalog-import-template.csv" download>Télécharger le modèle CSV</a><a href="/vehicle-catalog-import-guide.txt" download>Guide de remplissage</a><label className="import-file">Choisir un CSV<input type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 2_000_000) { setError('Le fichier dépasse 2 Mo.'); return; } setFileName(file.name); setPreview(null); setError(''); void file.text().then(setCsv); event.currentTarget.value = ''; }}/></label></div><textarea className="import-editor" aria-label="Contenu CSV véhicules" value={csv} onChange={(event) => { setCsv(event.target.value); setPreview(null); }} placeholder="Chargez un fichier CSV ou collez les lignes du référentiel…" spellCheck={false}/><div className="import-footer"><span>{fileName} · 2 Mo maximum · jusqu’à 2 000 variantes véhicule</span><button type="button" className="auth-submit import-preview-button" disabled={busy || !csv.trim()} onClick={() => void previewImport()}>{busy ? 'Traitement…' : 'Prévisualiser'}</button></div>{error && <div className="auth-alert error">{error}</div>}{message && <div className="auth-alert success">{message}</div>}{preview && <div className="import-preview"><div className="import-summary">{preview.acceptedRows} valide(s) · {preview.rejectedRows} avec erreur(s)</div><div className="import-preview-rows">{preview.rows.map((row) => <div className={`import-preview-row ${row.errors.length ? 'invalid' : ''}`} key={row.line}><b>L{row.line}</b><span>{row.make} · {row.model} · {row.generation} · {row.yearFrom}–{row.yearTo ?? '…'}</span><small>{row.errors.length ? row.errors.join(' ') : [row.category, row.engineCode || row.engine, row.fuel, row.displacementCc && `${row.displacementCc} cm³`, row.powerKw && `${row.powerKw} kW`, row.variant, row.bodyStyle, row.transmission, row.drivetrain, row.source && `Source : ${row.source}`, row.verified ? 'Vérifié' : 'À vérifier'].filter(Boolean).join(' · ')}</small></div>)}</div>{preview.previewTruncated && <small>Aperçu limité à 50 lignes sur {preview.rowCount}.</small>}<button type="button" className="auth-submit import-confirm-button" disabled={busy || preview.acceptedRows === 0} onClick={() => void commitImport()}>{busy ? 'Import en cours…' : `Importer ${preview.acceptedRows} véhicule(s)`}</button></div>}</section>;
}

type VehicleContribution = {
  id: string; name: string; yearFrom: number; yearTo: number | null; status: string; source: string | null; sourceReference: string | null;
  model: { id: string; name: string; status: string; source: string | null; sourceReference: string | null; make: { id: string; name: string; status: string; source: string | null; sourceReference: string | null } };
  engines: Array<{ id: string; name: string; engineCode: string | null; fuel: string | null; displacementCc: number | null; powerKw: number | null; source: string | null; sourceReference: string | null }>;
  variants: Array<{ id: string; name: string; bodyStyle: string | null; transmission: string | null; drivetrain: string | null; source: string | null; sourceReference: string | null; engine: { name: string; engineCode: string | null } | null }>;
};
function VehicleCatalogReview({ onReviewed }: { onReviewed: () => void }) {
  const [items, setItems] = useState<VehicleContribution[]>([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [sources, setSources] = useState<Record<string, string>>({}); const [references, setReferences] = useState<Record<string, string>>({});
  const load = async () => {
    setLoading(true); setError('');
    try {
      const token = sessionStorage.getItem('ap360-token') || '';
      const response = await fetch(`${API}/api/admin/catalog/vehicles/contributions`, { headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Chargement des contributions impossible.');
      setItems(result.data); setSources((current) => Object.fromEntries(result.data.map((item: VehicleContribution) => [item.id, current[item.id] || ''])));
      setReferences((current) => Object.fromEntries(result.data.map((item: VehicleContribution) => [item.id, current[item.id] || ''])));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'API indisponible.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const review = async (item: VehicleContribution, status: 'VERIFIED' | 'REJECTED') => {
    if (status === 'VERIFIED' && (sources[item.id] || '').trim().length < 3) { setError('Indiquez une source vérifiable d’au moins 3 caractères avant la publication.'); return; }
    setBusy(item.id); setError(''); setMessage('');
    try {
      const token = sessionStorage.getItem('ap360-token') || '';
      const response = await fetch(`${API}/api/admin/catalog/vehicles/contributions/${item.id}/review`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status, ...(status === 'VERIFIED' ? { source: sources[item.id].trim(), ...(references[item.id]?.trim() ? { sourceReference: references[item.id].trim() } : {}) } : {}) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Mise à jour impossible.');
      setMessage(result.message); await load(); onReviewed();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'API indisponible.'); }
    finally { setBusy(''); }
  };
  return <section className="admin-section" id="admin-vehicle-review"><div className="admin-audit-heading"><div><h3>Vérifier les données véhicule</h3><p className="auth-intro">Les entrées contributives sont signalées comme non vérifiées dans les choix véhicule. Vérifiez les sources avant de les publier; cela ne valide jamais automatiquement les compatibilités des pièces.</p></div><button type="button" className="partner-secondary-action" onClick={() => void load()} disabled={loading || busy !== ''}>{loading ? 'Chargement…' : 'Actualiser'}</button></div>
    {error && <div className="auth-alert error">{error}</div>}{message && <div className="auth-alert success">{message}</div>}
    {loading ? <div className="admin-empty">Chargement des contributions…</div> : items.length === 0 ? <div className="admin-empty">Aucune donnée véhicule à examiner.</div> : <div className="admin-list">{items.map((item) => <article className="admin-account" key={item.id}><div><strong>{item.model.make.name} · {item.model.name} · {item.name}</strong><span>{item.yearFrom}–{item.yearTo ?? '…'} · {[item.status === 'CONTRIBUTED' ? 'Génération à vérifier' : '', item.engines.length ? `${item.engines.length} motorisation(s)` : '', item.variants.length ? `${item.variants.length} version(s)` : ''].filter(Boolean).join(' · ')}</span>
      {item.engines.map((engine) => <small key={engine.id}>Moteur : {engine.name}{engine.engineCode ? ` (${engine.engineCode})` : ''}{engine.fuel ? ` · ${engine.fuel}` : ''}{engine.displacementCc ? ` · ${engine.displacementCc} cm³` : ''}{engine.powerKw ? ` · ${engine.powerKw} kW` : ''}</small>)}
      {item.variants.map((variant) => <small key={variant.id}>Version : {variant.name}{variant.engine ? ` · ${variant.engine.name}` : ''}{variant.bodyStyle ? ` · ${variant.bodyStyle}` : ''}{variant.transmission ? ` · ${variant.transmission}` : ''}{variant.drivetrain ? ` · ${variant.drivetrain}` : ''}</small>)}
      <label className="vehicle-review-source">Source de vérification<input maxLength={240} value={sources[item.id] || ''} onChange={(event) => setSources((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Catalogue constructeur, documentation technique…"/></label><label className="vehicle-review-source">Référence ou lien de la source<input maxLength={500} value={references[item.id] || ''} onChange={(event) => setReferences((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="URL ou référence documentaire (facultatif)"/></label>
      {(() => { const declared = [...(item.status === 'CONTRIBUTED' && item.source ? [item.source] : []), ...item.engines.map((engine) => engine.source), ...item.variants.map((variant) => variant.source)].filter((value): value is string => Boolean(value)); return declared.length ? <small>Provenance déclarée, à contrôler : {[...new Set(declared)].join(' · ')}</small> : null; })()}</div><div className="admin-actions"><button disabled={busy !== '' || (sources[item.id] || '').trim().length < 3} onClick={() => void review(item, 'VERIFIED')}>{busy === item.id ? 'Traitement…' : 'Vérifier et publier'}</button><button className="decline" disabled={busy !== ''} onClick={() => void review(item, 'REJECTED')}>Écarter</button></div></article>)}</div>}
    {items.length === 500 && <small>Limite de 500 générations atteinte. Traitez les contributions actuelles puis actualisez.</small>}
  </section>;
}

function AdminAuditLogs() {
  const [cursor, setCursor] = useState(''); const [action, setAction] = useState('');
  const query = useQuery({ queryKey: ['admin-audit-logs', cursor, action], queryFn: async () => {
    const token = sessionStorage.getItem('ap360-token') || ''; const params = new URLSearchParams({ limit: '30' });
    if (cursor) params.set('cursor', cursor); if (action.trim().length >= 2) params.set('action', action.trim());
    const response = await fetch(`${API}/api/admin/audit-logs?${params}`, { headers: { Authorization: `Bearer ${token}` } }); const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Chargement du journal impossible.'); return result as { data: AuditEntry[]; nextCursor: string | null };
  } });
  const labels: Record<string, string> = { PARTNER_ACCOUNT_CREATED: 'Compte partenaire créé', ACCOUNT_ACTIVATED: 'Compte activé', ACCOUNT_SUSPENDED: 'Compte suspendu', PRODUCT_PRICE_UPDATED: 'Prix produit modifié', PRODUCT_ARCHIVED: 'Pièce retirée du catalogue', PRODUCT_RESTORED: 'Pièce rétablie dans le catalogue', SUPPLIER_OFFER_APPROVED: 'Offre fournisseur approuvée', SUPPLIER_OFFER_REJECTED: 'Offre fournisseur refusée', STOCK_MOVEMENT_RECORDED: 'Mouvement de stock enregistré', PAYMENT_CONFIRMED: 'Paiement confirmé', PAYMENT_PROOF_UPLOADED: 'Justificatif de virement déposé', PAYMENT_REJECTED: 'Paiement rejeté', ADMIN_ORDER_CANCELLED: 'Commande annulée par admin', CUSTOMER_ORDER_CANCELLED: 'Commande annulée par client', SUPPLIER_INVOICE_ACCEPTED: 'Facture fournisseur acceptée', SUPPLIER_INVOICE_REJECTED: 'Facture fournisseur refusée', CATALOG_IMPORT_COMPLETED: 'Import catalogue terminé', VEHICLE_CATALOG_IMPORT_COMPLETED: 'Import du référentiel véhicule terminé', VEHICLE_CATALOG_CONTRIBUTION_VERIFIED: 'Données véhicule vérifiées', VEHICLE_CATALOG_CONTRIBUTION_REJECTED: 'Données véhicule écartées', BANK_TRANSFER_SETTINGS_UPDATED: 'Coordonnées de virement modifiées', ORDERS_CSV_EXPORTED: 'Export CSV des commandes' };
  return <section className="admin-section" id="admin-audit"><div className="admin-audit-heading"><div><h3>Journal d’audit</h3><p className="auth-intro">Actions sensibles enregistrées avec leur acteur, leur cible et leur date. Les secrets et données de livraison ne sont pas journalisés.</p></div><button className="partner-secondary-action" onClick={() => void query.refetch()} disabled={query.isFetching}>{query.isFetching ? 'Actualisation…' : 'Actualiser'}</button></div><label className="admin-audit-filter">Filtrer par action<input value={action} onChange={(event) => { setAction(event.target.value); setCursor(''); }} placeholder="Ex. PAYMENT_CONFIRMED" maxLength={80}/></label>{query.isPending ? <div className="admin-empty">Chargement du journal…</div> : query.isError ? <div className="auth-alert error">{query.error instanceof Error ? query.error.message : 'Chargement impossible.'}</div> : <>{query.data?.data.length ? <div className="admin-audit-list">{query.data.data.map((entry) => <article key={entry.id}><div><strong>{labels[entry.action] || entry.action}</strong><span>{entry.actor.firstName} {entry.actor.lastName} · {entry.actor.role} · {entry.actor.email}</span><small>{entry.entityType} · {entry.entityId} · {new Date(entry.createdAt).toLocaleString('fr-FR')}</small>{entry.details && <small className="admin-audit-details">{Object.entries(entry.details).map(([key, value]) => `${key} : ${typeof value === 'string' ? value : JSON.stringify(value)}`).join(' · ')}</small>}</div></article>)}</div> : <div className="admin-empty">Aucune action ne correspond à ce filtre.</div>}<div className="admin-audit-pagination"><button className="partner-secondary-action" onClick={() => setCursor('')} disabled={!cursor}>Première page</button><span>30 événements maximum par page</span><button className="partner-secondary-action" onClick={() => setCursor(query.data?.nextCursor || '')} disabled={!query.data?.nextCursor || query.isFetching}>Événements suivants →</button></div></>}</section>;
}

type AdminWarehouse = { id: string; code: string; name: string; city?: string | null };
type AdminStock = { id: string; onHand: number; reserved: number; damaged: number; onOrder: number; minimumStock: number; available: number; warehouse: AdminWarehouse; offer: { id: string; status: string; supplierSku: string; product: { sku: string; name: string }; supplier: { companyName?: string | null; email: string } } };
type AdminOffer = { id: string; supplierSku: string; status: string; product: { name: string }; supplier: { companyName?: string | null; email: string } };
type AdminMovement = { id: string; type: string; quantity: number; reason: string; createdAt: string; warehouse: { name: string; code: string }; offer: { supplierSku: string; product: { name: string } }; actor: { firstName: string; lastName: string } };
type PartnerInventoryData = { warehouses: AdminWarehouse[]; items: AdminStock[]; movements: Omit<AdminMovement, 'actor'>[] };

function StockMinimumControl({ stockItemId, minimumStock, available, endpoint }: { stockItemId: string; minimumStock: number; available: number; endpoint: string }) {
  const [value, setValue] = useState(String(minimumStock)); const [savedValue, setSavedValue] = useState(String(minimumStock)); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { setValue(String(minimumStock)); setSavedValue(String(minimumStock)); }, [minimumStock]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const token = sessionStorage.getItem('ap360-token') || '';
      const response = await fetch(`${API}${endpoint}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ minimumStock: Number(value) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Enregistrement du seuil impossible.'); setValue(String(result.data.minimumStock)); setSavedValue(String(result.data.minimumStock));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'API indisponible.'); }
    finally { setBusy(false); }
  };
  const low = Number(value) > 0 && available <= Number(value);
  return <div className="stock-minimum-control"><form onSubmit={(event) => void submit(event)}><label>Seuil d’alerte<input aria-label="Seuil minimum de stock" type="number" min="0" max="1000000" step="1" value={value} onChange={(event) => setValue(event.target.value)}/></label><button type="submit" disabled={busy || savedValue === value}>{busy ? '…' : 'Enregistrer'}</button></form>{low && <b className="stock-low-alert">Stock bas</b>}{error && <small className="stock-minimum-error">{error}</small>}</div>;
}

function PartnerAvailabilityControl({ available, busy, onSave }: { available: number; busy: boolean; onSave: (quantity: number) => void }) {
  const [value, setValue] = useState(String(available));
  useEffect(() => setValue(String(available)), [available]);
  const quantity = Number(value);
  return <form className="partner-availability-control" onSubmit={(event) => { event.preventDefault(); onSave(quantity); }}>
    <label>Unités vendables<input aria-label="Unités disponibles à la vente" type="number" min="0" max="1000000" step="1" value={value} onChange={(event) => setValue(event.target.value)} disabled={busy}/></label>
    <button type="submit" disabled={busy || !Number.isInteger(quantity) || quantity < 0 || quantity > 1000000 || quantity === available}>{busy ? '…' : 'Enregistrer'}</button>
    {available > 0 ? <button type="button" className="availability-toggle off" disabled={busy} onClick={() => { setValue('0'); onSave(0); }}>Mettre hors stock</button> : <button type="button" className="availability-toggle on" disabled={busy} onClick={() => { setValue('1'); onSave(1); }}>Mettre en stock</button>}
  </form>;
}

function PartnerOfferAvailabilityControl({ offerId, warehouses, items, busy, onSave }: { offerId: string; warehouses: AdminWarehouse[]; items: AdminStock[]; busy: boolean; onSave: (offerId: string, warehouseId: string, quantity: number) => void }) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  useEffect(() => { if (!warehouses.some((warehouse) => warehouse.id === warehouseId) && warehouses[0]) setWarehouseId(warehouses[0].id); }, [warehouses, warehouseId]);
  const current = items.find((item) => item.offer.id === offerId && item.warehouse.id === warehouseId);
  const [value, setValue] = useState(String(current?.available ?? 0));
  useEffect(() => setValue(String(current?.available ?? 0)), [current?.available, warehouseId]);
  const quantity = Number(value);
  if (!warehouses.length) return <small className="partner-stock-inline-note">Aucun entrepôt disponible pour gérer les quantités.</small>;
  return <div className="partner-availability-control partner-offer-availability">
    <label>Entrepôt<select aria-label="Entrepôt de la pièce" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} disabled={busy}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}{warehouse.city ? ` · ${warehouse.city}` : ''}</option>)}</select></label>
    <label>Unités disponibles<input aria-label="Unités disponibles pour cette offre" type="number" min="0" max="1000000" step="1" value={value} onChange={(event) => setValue(event.target.value)} disabled={busy}/></label>
    <button type="button" disabled={busy || !Number.isInteger(quantity) || quantity < 0 || quantity > 1000000 || quantity === (current?.available ?? 0)} onClick={() => onSave(offerId, warehouseId, quantity)}>{busy ? '…' : 'Enregistrer le stock'}</button>
    {(current?.available ?? 0) > 0 ? <button type="button" className="availability-toggle off" disabled={busy} onClick={() => onSave(offerId, warehouseId, 0)}>Mettre hors stock</button> : <button type="button" className="availability-toggle on" disabled={busy} onClick={() => onSave(offerId, warehouseId, 1)}>Mettre en stock</button>}
    <small>{current ? `${current.available} unité(s) actuellement disponibles dans cet entrepôt.` : 'Aucune ligne de stock : enregistrez une quantité pour créer le stock.'}</small>
  </div>;
}

function StockManagement() {
  const token = sessionStorage.getItem('ap360-token') || '';
  const [warehouses, setWarehouses] = useState<AdminWarehouse[]>([]);
  const [stock, setStock] = useState<AdminStock[]>([]);
  const [offers, setOffers] = useState<AdminOffer[]>([]);
  const [movements, setMovements] = useState<AdminMovement[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const headers = { Authorization: `Bearer ${token}` };
    const [warehouseResponse, stockResponse, offerResponse, movementResponse] = await Promise.all([
      fetch(`${API}/api/admin/warehouses`, { headers }), fetch(`${API}/api/admin/stock`, { headers }), fetch(`${API}/api/admin/supplier-offers`, { headers }), fetch(`${API}/api/admin/stock/movements?limit=20`, { headers }),
    ]);
    const [warehouseData, stockData, offerData, movementData] = await Promise.all([warehouseResponse.json(), stockResponse.json(), offerResponse.json(), movementResponse.json()]);
    for (const [response, data] of [[warehouseResponse, warehouseData], [stockResponse, stockData], [offerResponse, offerData], [movementResponse, movementData]] as const) if (!response.ok) throw new Error(data.error || 'Chargement du stock impossible.');
    setWarehouses(warehouseData.data); setStock(stockData.data); setOffers(offerData.data.filter((offer: AdminOffer) => offer.status === 'APPROVED')); setMovements(movementData.data);
  };
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Chargement impossible.')); }, []);
  const submit = async (event: FormEvent<HTMLFormElement>, path: string) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const body = Object.fromEntries(new FormData(event.currentTarget).entries());
      const response = await fetch(`${API}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Opération impossible.');
      event.currentTarget.reset(); await load(); setMessage('Mise à jour enregistrée.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Opération impossible.'); }
    finally { setBusy(false); }
  };
  return <div className="admin-section" id="admin-stock"><h3>Stocks par entrepôt</h3><p className="auth-intro">Chaque quantité est rattachée à une offre fournisseur et à un entrepôt. Les coûts fournisseurs restent privés.</p>
    {error && <div className="auth-alert error">{error}</div>}{message && <div className="auth-alert success">{message}</div>}
    <form className="partner-create-form" onSubmit={(event) => void submit(event, '/api/admin/warehouses')}><strong>Ajouter un entrepôt</strong><div className="partner-create-grid"><label>Code<input name="code" required minLength={2} maxLength={32} placeholder="TUN-CENTRE"/></label><label>Nom<input name="name" required minLength={2} maxLength={120} placeholder="Entrepôt central"/></label><label>Ville<input name="city" maxLength={100}/></label></div><button disabled={busy}>{busy ? 'Enregistrement…' : 'Créer l’entrepôt'}</button></form>
    <form className="partner-create-form" onSubmit={(event) => void submit(event, '/api/admin/stock/movements')}><strong>Enregistrer un mouvement</strong><div className="partner-create-grid"><label>Entrepôt<select name="warehouseId" required defaultValue=""><option value="" disabled>Choisir…</option>{warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.name} ({warehouse.code})</option>)}</select></label><label>Offre approuvée<select name="offerId" required defaultValue=""><option value="" disabled>Choisir…</option>{offers.map((offer) => <option value={offer.id} key={offer.id}>{offer.product.name} · {offer.supplier.companyName || offer.supplier.email} · {offer.supplierSku}</option>)}</select></label><label>Type<select name="type" defaultValue="RECEIPT"><option value="RECEIPT">Réception</option><option value="ADJUSTMENT">Ajustement (+/-)</option><option value="DAMAGE">Déclarer endommagé</option><option value="RESERVATION">Réservation</option><option value="RELEASE">Libérer une réservation</option></select></label><label>Quantité<input name="quantity" type="number" required min="-1000000" max="1000000" defaultValue="1"/></label><label>Motif<input name="reason" required minLength={3} maxLength={240} placeholder="Réception bon de livraison…"/></label></div><button disabled={busy || !warehouses.length || !offers.length}>{busy ? 'Enregistrement…' : 'Enregistrer le mouvement'}</button></form>
    {stock.length === 0 ? <div className="admin-empty">Aucun stock enregistré.</div> : <div className="admin-list">{stock.map((item) => <article className="admin-account" key={item.id}><div><strong>{item.offer.product.name} · {item.offer.supplierSku}</strong><span>{item.offer.supplier.companyName || item.offer.supplier.email} · {item.warehouse.name} ({item.warehouse.code})</span><small>Physique {item.onHand} · Réservé {item.reserved} · Endommagé {item.damaged} · En commande {item.onOrder} · Disponible {item.available}</small><StockMinimumControl stockItemId={item.id} minimumStock={item.minimumStock} available={item.available} endpoint={`/api/admin/stock/${item.id}/minimum-stock`}/></div></article>)}</div>}
    <h4>Derniers mouvements</h4>{movements.length === 0 ? <div className="admin-empty">Aucun mouvement pour le moment.</div> : <div className="admin-list">{movements.map((movement) => <article className="admin-account" key={movement.id}><div><strong>{movement.type} · {movement.quantity > 0 ? '+' : ''}{movement.quantity} · {movement.offer.product.name}</strong><span>{movement.warehouse.name} · {movement.offer.supplierSku} · {movement.reason}</span><small>{new Date(movement.createdAt).toLocaleString('fr-FR')} · {movement.actor.firstName} {movement.actor.lastName}</small></div></article>)}</div>}
  </div>;
}

type PricingProfileRow = { id: string; name: string; description?: string | null; discountPercent: string | number; active: boolean; _count: { users: number }; productPrices?: { productId: string; discountPercent: string | number; product: { id: string; sku: string; name: string } }[]; categoryPrices?: { category: string; discountPercent: string | number }[] };
type PricingProductRow = { id: string; sku: string; name: string; category?: string | null; status: string; hasPartnerOffer: boolean; listPrice?: string | number | null; pricingMode?: 'MANUAL' | 'MARGIN'; marginPercent?: string | number | null; lowestSupplierCost?: string | number | null; effectiveMarginPercent?: string | number; vatRate: string | number };
type PricingAccountRow = { id: string; email: string; companyName?: string | null; role: string; status: string; pricingProfileId?: string | null };
type CategoryMarginRow = { category: string; marginPercent: string | number };

function PricingManagement() {
  const queryClient = useQueryClient();
  const token = sessionStorage.getItem('ap360-token') || '';
  const [profiles, setProfiles] = useState<PricingProfileRow[]>([]);
  const [products, setProducts] = useState<PricingProductRow[]>([]);
  const [accounts, setAccounts] = useState<PricingAccountRow[]>([]);
  const [defaultMarginPercent, setDefaultMarginPercent] = useState('0');
  const [categoryMargins, setCategoryMargins] = useState<CategoryMarginRow[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedPricingMode, setSelectedPricingMode] = useState<'MANUAL' | 'MARGIN'>('MANUAL');
  const [marginProductId, setMarginProductId] = useState('');
  const [marginRate, setMarginRate] = useState('');
  const [ruleProductId, setRuleProductId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const load = async () => {
    const [profileResponse, productResponse, accountResponse, publicPricingResponse] = await Promise.all([
      fetch(`${API}/api/admin/pricing-profiles`, { headers }), fetch(`${API}/api/admin/products`, { headers }), fetch(`${API}/api/admin/accounts`, { headers }), fetch(`${API}/api/admin/public-pricing`, { headers }),
    ]);
    const [profileData, productData, accountData, publicPricingData] = await Promise.all([profileResponse.json(), productResponse.json(), accountResponse.json(), publicPricingResponse.json()]);
    for (const [response, data] of [[profileResponse, profileData], [productResponse, productData], [accountResponse, accountData], [publicPricingResponse, publicPricingData]] as const) if (!response.ok) throw new Error(data.error || 'Chargement des tarifs impossible.');
    setProfiles(profileData.data); setProducts(productData.data); setAccounts(accountData.data.filter((account: PricingAccountRow) => account.role === 'RESELLER' && account.status === 'ACTIVE'));
    setDefaultMarginPercent(String(publicPricingData.data.defaultMarginPercent)); setCategoryMargins(publicPricingData.data.categoryMargins);
  };
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'API indisponible.')); }, []);
  const save = async (event: FormEvent<HTMLFormElement>, path: string, method = 'POST') => {
    event.preventDefault(); const form = event.currentTarget; setBusy(true); setError(''); setMessage('');
    const formValues = Object.fromEntries(new FormData(form).entries());
    const body = path.endsWith('/public-pricing/default')
      ? { marginPercent: Number(formValues.marginPercent) }
      : path.endsWith('/public-pricing/categories')
      ? { category: String(formValues.category || ''), marginPercent: Number(formValues.marginPercent), applyToExisting: formValues.applyToExisting === 'on' }
      : path.includes('/admin/products/') && path.endsWith('/pricing')
      ? { mode: String(formValues.mode || 'MANUAL'), ...(formValues.mode === 'MANUAL' ? { listPrice: Number(formValues.listPrice) } : {}), vatRate: 19 }
      : path.includes('/categories')
      ? { category: String(formValues.category || ''), discountPercent: Number(formValues.discountPercent) }
      : path.includes('/products/')
      ? { discountPercent: formValues.discountPercent === '' ? null : Number(formValues.discountPercent) }
      : path.endsWith('/pricing-profile')
      ? { pricingProfileId: formValues.pricingProfileId ? String(formValues.pricingProfileId) : null }
      : Object.fromEntries(Object.entries(formValues).filter(([key]) => key !== 'accountId'));
    try { const response = await fetch(`${API}${path}`, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Enregistrement impossible.'); await load(); await queryClient.invalidateQueries({ queryKey: ['search'] }); setMessage('Tarification mise à jour.'); if (method === 'POST') form.reset(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'API indisponible.'); }
    finally { setBusy(false); }
  };
  const selectedProduct = products.find((product) => product.id === selectedProductId);
  const selectedMarginProduct = products.find((product) => product.id === marginProductId);
  const setMarginProduct = (productId: string) => {
    setMarginProductId(productId);
    const product = products.find((item) => item.id === productId);
    setMarginRate(product?.marginPercent == null ? '' : String(product.marginPercent));
  };
  const changeProductMargin = async (productId: string, marginPercent: number | null) => {
    if (!productId) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${API}/api/admin/products/${productId}/margin`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ marginPercent }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Mise à jour de la marge impossible.');
      await load(); await queryClient.invalidateQueries({ queryKey: ['search'] });
      setMarginRate(marginPercent === null ? '' : String(marginPercent)); setMessage(result.message || 'Marge de la pièce mise à jour.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'API indisponible.'); }
    finally { setBusy(false); }
  };
  return <section className="admin-section pricing-admin" id="admin-pricing"><div className="pricing-section-heading"><div><span className="partner-panel-eyebrow">PRIX DE VENTE ET MARGES</span><h3>Tarifs et marges GHORBEL</h3><p>Configure la marge générale, une marge par catégorie (ex. pneumatiques à 20 %) ou un prix manuel pour chaque pièce. Le prix client est calculé côté serveur.</p></div></div>
    {error && <div className="auth-alert error">{error}</div>}{message && <div className="auth-alert success">{message}</div>}
    <form className="pricing-product-form" onSubmit={(event) => void save(event, '/api/admin/public-pricing/default', 'PATCH')}><div><strong>Marge générale GHORBEL</strong><span>Appliquée au coût d’achat fournisseur HT pour les pièces en mode « marge » qui n’ont pas de règle de catégorie.</span></div><label>Marge sur coût fournisseur (%)<input name="marginPercent" type="number" min="0" max="500" step="0.01" required value={defaultMarginPercent} onChange={(event) => setDefaultMarginPercent(event.target.value)}/></label><button className="auth-submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer la marge générale'}</button></form>
    <form className="pricing-product-form" onSubmit={(event) => void save(event, '/api/admin/public-pricing/categories', 'PATCH')}><div><strong>Marge par catégorie de pièces</strong><span>Exemple : Pneumatiques · 20 %. Cette règle remplace la marge générale pour cette catégorie. En cochant l’option, les pièces existantes basculent sur le calcul automatique; tu peux ensuite garder des exceptions en prix manuel par pièce.</span></div><label>Catégorie<input name="category" required minLength={2} maxLength={100} list="pricing-category-options" placeholder="Pneumatiques"/><datalist id="pricing-category-options">{Array.from(new Set(products.map((product) => product.category).filter((category): category is string => Boolean(category)))).sort().map((category) => <option value={category} key={category}/>)}</datalist></label><label>Marge (%)<input name="marginPercent" type="number" min="0" max="500" step="0.01" required/></label><label className="pricing-apply-existing"><input name="applyToExisting" type="checkbox" defaultChecked/>Appliquer aussi aux pièces existantes de cette catégorie</label><button className="auth-submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer la marge de catégorie'}</button></form>
    {categoryMargins.length > 0 && <div className="pricing-product-list"><h4>Marges par catégorie</h4>{categoryMargins.map((rule) => <div key={rule.category}><span>{rule.category}</span><b>{Number(rule.marginPercent).toFixed(2)} %</b><button type="button" className="partner-secondary-action" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const response = await fetch(`${API}/api/admin/public-pricing/categories`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ category: rule.category, marginPercent: null }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Suppression impossible.'); await load(); setMessage(`Règle de marge supprimée pour ${rule.category}.`); } catch (reason) { setError(reason instanceof Error ? reason.message : 'API indisponible.'); } finally { setBusy(false); } }}>Supprimer</button></div>)}</div>}
    <form className="pricing-product-form" onSubmit={(event) => { event.preventDefault(); void changeProductMargin(marginProductId, Number(marginRate)); }}><div><strong>Marge spécifique à une pièce</strong><span>Cette marge remplace la marge de catégorie et la marge générale pour cette pièce. La retirer rétablit automatiquement la marge héritée.</span></div><label>Pièce<select value={marginProductId} onChange={(event) => setMarginProduct(event.target.value)} required><option value="">Choisir une pièce</option>{products.map((product) => <option value={product.id} key={product.id}>{product.name} · {product.sku}</option>)}</select></label><label>Taux de marge (%)<input type="number" min="0" max="500" step="0.01" value={marginRate} onChange={(event) => setMarginRate(event.target.value)} required/></label><button className="auth-submit" disabled={busy || !marginProductId}>{busy ? 'Enregistrement…' : selectedMarginProduct?.marginPercent != null ? 'Modifier la marge' : 'Appliquer à cette pièce'}</button>{selectedMarginProduct?.marginPercent != null && <button type="button" className="partner-secondary-action" disabled={busy} onClick={() => void changeProductMargin(marginProductId, null)}>Retirer cette marge</button>}</form>
    {products.some((product) => product.marginPercent != null) && <div className="pricing-product-list"><h4>Marges spécifiques aux pièces</h4>{products.filter((product) => product.marginPercent != null).map((product) => <div key={product.id}><span>{product.name} · {product.sku}{product.category ? ` · ${product.category}` : ''}</span><b>{Number(product.marginPercent).toFixed(2)} %</b><button type="button" className="partner-secondary-action" disabled={busy} onClick={() => { setMarginProduct(product.id); setMessage(''); }}>Modifier</button><button type="button" className="partner-secondary-action" disabled={busy} onClick={() => void changeProductMargin(product.id, null)}>Supprimer</button></div>)}</div>}
    <div className="pricing-admin-grid"><form id="pricing-profile-create" className="partner-create-form pricing-form" onSubmit={(event) => void save(event, '/api/admin/pricing-profiles')}><strong>Créer un profil revendeur</strong><label>Nom du profil<input name="name" required minLength={2} maxLength={100} placeholder="Garage partenaire"/></label><label>Remise (%)<input name="discountPercent" type="number" required min="0" max="100" step="0.01" defaultValue="0"/></label><label>Description<input name="description" maxLength={500} placeholder="Conditions commerciales…"/></label><button disabled={busy}>{busy ? 'Enregistrement…' : 'Créer le profil'}</button></form>
      <form className="partner-create-form pricing-form" onSubmit={(event) => { const accountId = String(new FormData(event.currentTarget).get('accountId') || ''); void save(event, `/api/admin/accounts/${accountId}/pricing-profile`, 'PATCH'); }}><strong>Attribuer un profil à un revendeur</strong><label>Revendeur<select name="accountId" required defaultValue=""><option value="" disabled>Choisir un compte actif</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.companyName || account.email}</option>)}</select></label><label>Profil tarifaire<select name="pricingProfileId" defaultValue=""><option value="">Aucun profil · tarif public</option>{profiles.filter((profile) => profile.active).map((profile) => <option value={profile.id} key={profile.id}>{profile.name} · −{Number(profile.discountPercent).toFixed(2)}%</option>)}</select></label><button disabled={busy || !accounts.length}>{busy ? 'Enregistrement…' : 'Affecter le profil'}</button></form></div>
    <div className="pricing-profile-list">{profiles.length === 0 ? <p className="admin-empty">Aucun profil tarifaire. Créez un profil pour accorder une remise spécifique à vos revendeurs.</p> : profiles.map((profile) => <article key={profile.id}><div><strong>{profile.name}</strong><span>{profile.description || 'Profil revendeur'}</span><small>{profile._count.users} compte(s) associé(s) · remise par défaut {Number(profile.discountPercent).toFixed(2)} %</small>{profile.categoryPrices?.map((rule) => <small key={rule.category}>Catégorie {rule.category} · remise {Number(rule.discountPercent).toFixed(2)} %</small>)}{profile.productPrices?.map((rule) => <small key={rule.productId}>Pièce spécifique : {rule.product.name} ({rule.product.sku}) · remise {Number(rule.discountPercent).toFixed(2)} %</small>)}</div><b>−{Number(profile.discountPercent).toFixed(2)}%</b></article>)}</div>
      <form className="pricing-product-form" onSubmit={(event) => { const profileId = String(new FormData(event.currentTarget).get('profileId') || ''); if (profileId) void save(event, `/api/admin/pricing-profiles/${profileId}/categories`, 'PATCH'); }}><div><strong>Remise par catégorie</strong><span>Elle s’applique après une éventuelle remise propre à la pièce.</span></div><label>Profil revendeur<select name="profileId" required defaultValue="" disabled={!profiles.some((profile) => profile.active)}><option value="">{profiles.some((profile) => profile.active) ? 'Choisir un profil' : 'Aucun profil actif'}</option>{profiles.filter((profile) => profile.active).map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select>{!profiles.some((profile) => profile.active) && <small>Aucun profil n’existe encore. <a href="#pricing-profile-create">Créez d’abord un profil revendeur.</a></small>}</label><label>Catégorie<input name="category" required minLength={2} maxLength={100} list="pricing-category-options" placeholder="Freinage"/><datalist id="pricing-category-options">{Array.from(new Set(products.map((product) => product.category).filter((category): category is string => Boolean(category)))).sort().map((category) => <option value={category} key={category}/>)}</datalist></label><label>Remise (%)<input name="discountPercent" type="number" min="0" max="100" step="0.01" required/></label><button className="auth-submit" disabled={busy || !profiles.some((profile) => profile.active)}>{busy ? 'Enregistrement…' : 'Appliquer à cette catégorie'}</button></form>
    <form className="pricing-product-form" onSubmit={(event) => { const fields = new FormData(event.currentTarget); const profileId = String(fields.get('profileId') || ''); if (profileId && ruleProductId) void save(event, `/api/admin/pricing-profiles/${profileId}/products/${ruleProductId}`, 'PATCH'); }}><div><strong>Remise spécifique à une pièce</strong><span>Cette remise remplace la remise par défaut du profil choisi.</span></div><label>Profil revendeur<select name="profileId" required defaultValue="" disabled={!profiles.some((profile) => profile.active)}><option value="">{profiles.some((profile) => profile.active) ? 'Choisir un profil' : 'Aucun profil actif'}</option>{profiles.filter((profile) => profile.active).map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select>{!profiles.some((profile) => profile.active) && <small>Créez un profil revendeur dans la section ci-dessus.</small>}</label><label>Pièce<select value={ruleProductId} onChange={(event) => setRuleProductId(event.target.value)} required><option value="">Choisir une pièce</option>{products.map((product) => <option value={product.id} key={product.id}>{product.name} · {product.sku}</option>)}</select></label><label>Remise (%)<input name="discountPercent" type="number" min="0" max="100" step="0.01" required/></label><button className="auth-submit" disabled={busy || !profiles.some((profile) => profile.active) || !products.length}>{busy ? 'Enregistrement…' : 'Appliquer à cette pièce'}</button></form>    <form className="pricing-product-form" onSubmit={(event) => { if (selectedProductId) void save(event, `/api/admin/products/${selectedProductId}/pricing`, 'PATCH'); }}><div><strong>Prix de vente client GHORBEL</strong><span>Les pièces GHORBEL peuvent avoir un prix HT manuel. Pour les pièces partenaire, le prix client suit le coût fournisseur privé et la marge GHORBEL.</span></div><label>Pièce<select value={selectedProductId} onChange={(event) => { const id = event.target.value; const product = products.find((item) => item.id === id); setSelectedProductId(id); setSelectedPricingMode(product?.hasPartnerOffer ? 'MARGIN' : product?.pricingMode || 'MANUAL'); }} required><option value="">Choisir une pièce</option>{products.map((product) => <option value={product.id} key={product.id}>{product.name} · {product.sku}</option>)}</select></label><label>Calcul du prix<select name="mode" value={selectedPricingMode} onChange={(event) => setSelectedPricingMode(event.target.value as 'MANUAL' | 'MARGIN')}><option value="MANUAL" disabled={Boolean(selectedProduct?.hasPartnerOffer)}>Prix fixé manuellement</option><option value="MARGIN">Marge sur coût fournisseur</option></select></label><label>Prix de vente HT (TND) · mode manuel<input name="listPrice" type="number" min="0.001" step="0.001" defaultValue={selectedProduct?.listPrice ?? ''} key={`${selectedProductId}-price`} disabled={selectedPricingMode !== 'MANUAL'} required={selectedPricingMode === 'MANUAL'}/>{selectedProduct?.hasPartnerOffer ? <small>Pièce partenaire : fixez une marge GHORBEL. Pas de prix manuel.</small> : selectedPricingMode === 'MARGIN' && <small>Le prix saisi ici est désactivé en mode marge.</small>}</label><label>TVA 19 % (Taux normal)<input name="vatRate" type="number" value={19} readOnly/></label><button className="auth-submit" disabled={busy || !selectedProductId || !products.length}>{busy ? 'Enregistrement…' : 'Enregistrer le prix'}</button></form>
    {products.filter((product) => product.listPrice !== null).length > 0 && <div className="pricing-product-list"><h4>Prix définis · coût visible uniquement par GHORBEL</h4>{products.filter((product) => product.listPrice !== null).slice(0, 12).map((product) => <div key={product.id}><span>{product.name} · {product.sku}{product.category ? ` · ${product.category}` : ''}{product.lowestSupplierCost != null ? ` · Coût fournisseur min. ${Number(product.lowestSupplierCost).toFixed(3)} TND HT` : ' · Aucune offre fournisseur approuvée'}</span><b>{Number(product.listPrice).toFixed(3)} TND HT · {product.pricingMode === 'MARGIN' ? `Marge ${Number(product.effectiveMarginPercent ?? 0).toFixed(2)} %` : 'Prix manuel'} · TVA 19 % (Taux normal)</b></div>)}</div>}
  </section>;
}

type CustomerOrder = { id: string; orderNumber: string; status: string; paymentMethod: string; paymentStatus: string; transferReference?: string | null; paymentProofs?: { id: string; fileName: string; mimeType: string; fileSize: number; createdAt: string }[]; currency: string; subtotalExclTax: string | number; vatTotal: string | number; totalInclTax: string | number; createdAt: string; guestAccessToken?: string; lines: { id: string; quantity: number; status: string; productNameSnapshot: string; carrierName?: string | null; trackingReference?: string | null; trackingUrl?: string | null; lineTotalInclTax: string | number }[] };
type DeliveryAddress = { id: string; label: string; recipientName: string; phone: string; address: string; city: string; isDefault: boolean };

function OrderCenter({ cart, setCart, initialView = 'cart', onClose, onLogin, signedIn }: { cart: CartLine[]; setCart: (cart: CartLine[]) => void; initialView?: 'cart' | 'orders' | 'addresses'; onClose: () => void; onLogin: () => void; signedIn: boolean }) {
  const [view, setView] = useState<'cart' | 'orders' | 'addresses'>(initialView);
  const [paymentMethod, setPaymentMethod] = useState<'CASH_ON_DELIVERY' | 'BANK_TRANSFER'>('CASH_ON_DELIVERY');
  const [bankDetails, setBankDetails] = useState<BankTransferDetails | null>(null);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [addresses, setAddresses] = useState<DeliveryAddress[]>([]);
  const [delivery, setDelivery] = useState({ recipientName: '', phone: '', address: '', city: '' });
  const [addressLabel, setAddressLabel] = useState('Adresse principale');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [guestOrders, setGuestOrders] = useState<{ orderNumber: string; accessToken: string }[]>(() => { try { return JSON.parse(sessionStorage.getItem('ap360-guest-orders') || '[]'); } catch { return []; } });
  const token = sessionStorage.getItem('ap360-token') || '';
  const loadOrders = async () => {
    if (!token) return;
    const response = await fetch(`${API}/api/orders`, { headers: { Authorization: `Bearer ${token}` } });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Impossible de charger les commandes.'); setOrders(result.data);
  };
  const loadAddresses = async () => {
    if (!token) return;
    const response = await fetch(`${API}/api/account/addresses`, { headers: { Authorization: `Bearer ${token}` } });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Impossible de charger les adresses.');
    setAddresses(result.data);
    const preferred = result.data.find((item: DeliveryAddress) => item.isDefault) || result.data[0];
    if (preferred) setDelivery({ recipientName: preferred.recipientName, phone: preferred.phone, address: preferred.address, city: preferred.city });
  };
  const chooseAddress = (addressId: string) => {
    const selected = addresses.find((item) => item.id === addressId);
    if (selected) setDelivery({ recipientName: selected.recipientName, phone: selected.phone, address: selected.address, city: selected.city });
  };
  const saveDeliveryAddress = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${API}/api/account/addresses`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...delivery, label: addressLabel, isDefault: addresses.length === 0 }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Enregistrement de l’adresse impossible.');
      setAddresses((current) => [result.data, ...current.map((item) => result.data.isDefault ? { ...item, isDefault: false } : item)]); setMessage('Adresse de livraison enregistrée.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Enregistrement impossible.'); } finally { setBusy(false); }
  };
  const deleteDeliveryAddress = async (addressId: string) => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API}/api/account/addresses/${addressId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Suppression impossible.');
      await loadAddresses(); setMessage(result.message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Suppression impossible.'); } finally { setBusy(false); }
  };
  const setDefaultDeliveryAddress = async (addressId: string) => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API}/api/account/addresses/${addressId}/default`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Mise à jour impossible.');
      await loadAddresses(); setMessage(result.message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Mise à jour impossible.'); } finally { setBusy(false); }
  };
  const loadGuestOrders = async () => {
    const saved = guestOrders;
    const loaded = await Promise.all(saved.map(async (item) => {
      const response = await fetch(`${API}/api/orders/guest/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
      const result = await response.json(); if (!response.ok) return null;
      return { ...result.data, guestAccessToken: item.accessToken } as CustomerOrder;
    }));
    setOrders(loaded.filter((order): order is CustomerOrder => order !== null));
  };
  useEffect(() => { if (signedIn) void Promise.all([loadOrders(), loadAddresses()]).catch((reason) => setError(reason instanceof Error ? reason.message : 'API indisponible.')); }, [signedIn]);
  useEffect(() => { void fetch(`${API}/api/payments/bank-transfer-details`).then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Coordonnées de virement indisponibles.'); setBankDetails(result.data); }).catch(() => setBankDetails(null)); }, []);
  const changeQuantity = (productId: string, quantity: number) => setCart(cart.map((line) => line.product.id === productId ? { ...line, quantity } : line).filter((line) => line.quantity > 0));
  const unavailableLines = cart.filter(({ product, quantity }) => (product.availableQuantity ?? 0) < quantity);
  const total = cart.reduce((sum, line) => sum + Number(line.product.pricing?.unitPriceInclTax || 0) * line.quantity, 0);
  const placeOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget; const fields = new FormData(form); setBusy(true); setError(''); setMessage('');
    try {
      const refreshedCart = await Promise.all(cart.map(async (line) => {
        const response = await fetch(`${API}/api/catalog/products/${line.product.id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `La pièce « ${line.product.name} » n’est plus disponible.`);
        return { ...line, product: result.data as Product };
      }));
      setCart(refreshedCart);
      const unavailable = refreshedCart.filter(({ product, quantity }) => (product.availableQuantity ?? 0) < quantity || !product.pricing);
      if (unavailable.length) throw new Error(`Stock insuffisant pour ${unavailable.map(({ product }) => `« ${product.name} » (${product.availableQuantity ?? 0} disponible(s))`).join(', ')}. Le panier a été actualisé; réduisez la quantité ou retirez les articles concernés.`);
      const priceChanged = refreshedCart.some(({ product }, index) => product.pricing?.unitPriceInclTax !== cart[index]?.product.pricing?.unitPriceInclTax);
      if (priceChanged) throw new Error('Un prix a changé depuis l’ajout au panier. Le panier a été actualisé; vérifiez le nouveau total puis confirmez à nouveau.');
      const body = { items: refreshedCart.map(({ product, quantity }) => ({ productId: product.id, quantity })), paymentMethod: String(fields.get('paymentMethod') || 'CASH_ON_DELIVERY'), ...(!signedIn ? { guestEmail: String(fields.get('guestEmail') || '').trim() } : {}), deliveryName: String(fields.get('deliveryName') || ''), deliveryPhone: String(fields.get('deliveryPhone') || ''), deliveryAddress: String(fields.get('deliveryAddress') || ''), deliveryCity: String(fields.get('deliveryCity') || ''), customerNote: String(fields.get('customerNote') || '') };
      const response = await fetch(`${API}/api/orders`, { method: 'POST', headers: { ...(signedIn && token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Commande impossible.'); setCart([]); setView('orders'); if (result.data.guestAccessToken) { const saved = [...guestOrders.filter((item) => item.orderNumber !== result.data.orderNumber), { orderNumber: result.data.orderNumber, accessToken: result.data.guestAccessToken }]; setGuestOrders(saved); sessionStorage.setItem('ap360-guest-orders', JSON.stringify(saved)); setOrders((current) => [result.data, ...current]); setMessage(`Commande ${result.data.orderNumber} enregistrée. Votre code privé de suivi : ${result.data.guestAccessToken}. Gardez-le précieusement ; il sera également envoyé par e-mail si la messagerie est configurée.`); } else { setMessage(`Commande ${result.data.orderNumber} enregistrée. Le stock correspondant est réservé.`); }
      await downloadOrderDocument({ id: result.data.id, orderNumber: result.data.orderNumber, guestAccessToken: result.data.guestAccessToken });
      if (!result.data.guestAccessToken) await loadOrders();
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'API indisponible.'); }
    finally { setBusy(false); }
  };
  const lookupGuestOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const fields = new FormData(event.currentTarget); const orderNumber = String(fields.get('orderNumber') || '').trim(); const accessToken = String(fields.get('accessToken') || '').trim(); setBusy(true); setError(''); setMessage('');
    try { const response = await fetch(`${API}/api/orders/guest/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderNumber, accessToken }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Commande introuvable.'); const saved = [...guestOrders.filter((item) => item.orderNumber !== orderNumber), { orderNumber, accessToken }]; setGuestOrders(saved); sessionStorage.setItem('ap360-guest-orders', JSON.stringify(saved)); setOrders((current) => [{ ...result.data, guestAccessToken: accessToken }, ...current.filter((order) => order.orderNumber !== orderNumber)]); setMessage('Commande vérifiée. Elle restera accessible dans cette session.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Recherche impossible.'); } finally { setBusy(false); }
  };
  const submitPaymentReference = async (event: FormEvent<HTMLFormElement>, orderId: string) => {
    event.preventDefault(); const form = event.currentTarget; const reference = String(new FormData(form).get('reference') || ''); setBusy(true); setError(''); setMessage('');
    try { const response = await fetch(`${API}/api/orders/${orderId}/payment-reference`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ reference }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Envoi impossible.'); setMessage(result.message); form.reset(); await loadOrders(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Envoi impossible.'); }
    finally { setBusy(false); }
  };
  const submitPaymentProof = async (event: FormEvent<HTMLFormElement>, order: CustomerOrder) => {
    event.preventDefault(); const form = event.currentTarget; const file = new FormData(form).get('paymentProof');
    if (!(file instanceof File) || file.size === 0 || file.size > 5 * 1024 * 1024 || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) { setError('Choisissez un PDF, JPEG ou PNG valide de 5 Mo maximum.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('Lecture du justificatif impossible.')); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); });
      const guest = Boolean(order.guestAccessToken); const path = guest ? '/api/orders/guest/payment-proofs' : `/api/orders/${order.id}/payment-proofs`;
      const body = { fileName: file.name, mimeType: file.type, contentBase64: dataUrl.split(',')[1], ...(guest ? { orderNumber: order.orderNumber, accessToken: order.guestAccessToken } : {}) };
      const response = await fetch(`${API}${path}`, { method: 'POST', headers: { ...(!guest ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Dépôt impossible.'); form.reset(); setMessage(result.message); if (guest) await loadGuestOrders(); else await loadOrders();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Dépôt impossible.'); } finally { setBusy(false); }
  };
  const cancelCustomerOrder = async (order: CustomerOrder) => {
    if (!window.confirm(`Annuler la commande ${order.orderNumber} et libérer les pièces réservées ?`)) return;
    setBusy(true); setError(''); setMessage('');
    try { const response = await fetch(`${API}/api/orders/${order.id}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Annulation impossible.'); setMessage(result.message); await loadOrders(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Annulation impossible.'); }
    finally { setBusy(false); }
  };
  const downloadOrderDocument = async (order: Pick<CustomerOrder, 'id' | 'orderNumber' | 'guestAccessToken'>) => {
    setBusy(true); setError('');
    try {
      const response = order.guestAccessToken
        ? await fetch(`${API}/api/orders/guest/document`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderNumber: order.orderNumber, accessToken: order.guestAccessToken }) })
        : await fetch(`${API}/api/orders/${order.id}/document`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'Téléchargement impossible.'); }
      const href = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = href; anchor.download = `FACT-${order.orderNumber}-GHORBEL.pdf`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Téléchargement impossible.'); } finally { setBusy(false); }
  };
  return (
    <div className="order-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="order-dialog" role="dialog" aria-modal="true" aria-labelledby="order-center-title">
        <header><div><span className="partner-panel-eyebrow">VOTRE ESPACE</span><h2 id="order-center-title">Panier et commandes</h2></div><button className="auth-close" aria-label="Fermer" onClick={onClose}>×</button></header>
        <nav className="order-tabs">
          <button className={view === 'cart' ? 'selected' : ''} onClick={() => setView('cart')}>Panier ({cart.reduce((count, line) => count + line.quantity, 0)})</button>
          <button className={view === 'orders' ? 'selected' : ''} onClick={() => { setView('orders'); void (signedIn ? loadOrders() : loadGuestOrders()).catch((reason) => setError(reason instanceof Error ? reason.message : 'Chargement impossible.')); }}>Mes commandes</button>
          {signedIn && <button className={view === 'addresses' ? 'selected' : ''} onClick={() => { setView('addresses'); void loadAddresses().catch((reason) => setError(reason instanceof Error ? reason.message : 'Chargement impossible.')); }}>Mes adresses</button>}
        </nav>
        {error && <div className="auth-alert error">{error}</div>}{message && <div className="auth-alert success">{message}</div>}
        {view === 'cart' ? (
          cart.length === 0 ? <div className="admin-empty">Votre panier est vide. Recherchez une pièce compatible pour commencer.</div> : <>
            <div className="order-cart-lines">{cart.map(({ product, quantity }) => <article key={product.id}>
              <div><strong>{product.name}</strong><span>{product.references.map((reference) => reference.value).join(' / ') || product.sku} · {Number(product.pricing?.unitPriceInclTax || 0).toFixed(3)} TND TTC / unité</span><small>{product.availableQuantity ?? 0} unité(s) disponible(s) au dernier relevé</small></div>
              <div className="order-quantity"><button aria-label={'Retirer une unité de ' + product.name} onClick={() => changeQuantity(product.id, quantity - 1)}>−</button><b>{quantity}</b><button aria-label={'Ajouter une unité de ' + product.name} disabled={quantity >= (product.availableQuantity ?? 0)} onClick={() => changeQuantity(product.id, quantity + 1)}>＋</button><button className="order-remove" onClick={() => changeQuantity(product.id, 0)}>Retirer</button></div>
              <strong>{(Number(product.pricing?.unitPriceInclTax || 0) * quantity).toFixed(3)} TND</strong>
            </article>)}</div>
            <div className="order-cart-total"><span>Total estimatif TTC</span><b>{total.toFixed(3)} TND</b></div>
            {unavailableLines.length > 0 && <div className="auth-alert error">Le stock a changé pour une ou plusieurs pièces. Ajustez les quantités ou retirez les articles indisponibles avant de confirmer.</div>}
            {!signedIn && <div className="auth-alert">Vous pouvez commander sans compte. Un code privé vous permettra de suivre la commande.</div>}
            <form className="order-delivery-form" onSubmit={placeOrder}>
              <h3>Livraison en Tunisie</h3>
              {signedIn && addresses.length > 0 && <label>Utiliser une adresse enregistrée<select onChange={(event) => chooseAddress(event.target.value)} defaultValue={addresses.find((item) => item.isDefault)?.id || addresses[0]?.id}>{addresses.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.city}{item.isDefault ? ' · Par défaut' : ''}</option>)}</select></label>}
              {!signedIn && <label>E-mail de suivi<input name="guestEmail" type="email" required autoComplete="email" maxLength={254}/></label>}
              <label>Mode de paiement<select name="paymentMethod" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as 'CASH_ON_DELIVERY' | 'BANK_TRANSFER')}><option value="CASH_ON_DELIVERY">Paiement à la livraison</option><option value="BANK_TRANSFER" disabled={!bankDetails}>Virement bancaire</option></select></label>
              {paymentMethod === 'BANK_TRANSFER' && bankDetails && <div className="checkout-bank-details"><strong>Coordonnées pour le virement</strong><span>Banque : {bankDetails.bankName}</span><span>Titulaire : {bankDetails.accountHolder}</span><span>RIB : <b>{bankDetails.rib}</b></span>{bankDetails.instructions && <p>{bankDetails.instructions}</p>}<small>La commande reste impayée jusqu’à vérification de la réception des fonds.</small></div>}
              {!bankDetails && <p className="checkout-bank-unavailable">Le virement sera proposé après configuration des coordonnées.</p>}
              <label>Nom du destinataire<input name="deliveryName" value={delivery.recipientName} onChange={(event) => setDelivery({ ...delivery, recipientName: event.target.value })} required minLength={2} maxLength={160}/></label>
              <label>Téléphone<input name="deliveryPhone" value={delivery.phone} onChange={(event) => setDelivery({ ...delivery, phone: event.target.value })} type="tel" required minLength={8} maxLength={24} placeholder="+216 …"/></label>
              <label>Adresse de livraison<input name="deliveryAddress" value={delivery.address} onChange={(event) => setDelivery({ ...delivery, address: event.target.value })} required minLength={8} maxLength={300}/></label>
              <label>Ville<input name="deliveryCity" value={delivery.city} onChange={(event) => setDelivery({ ...delivery, city: event.target.value })} required minLength={2} maxLength={100}/></label>
              {signedIn && <div className="address-save-controls"><input aria-label="Nom de l’adresse" value={addressLabel} onChange={(event) => setAddressLabel(event.target.value)} maxLength={80} placeholder="Nom de l’adresse"/><button type="button" className="partner-secondary-action" disabled={busy || !delivery.recipientName || !delivery.phone || !delivery.address || !delivery.city} onClick={() => void saveDeliveryAddress()}>Enregistrer cette adresse</button></div>}
              <label className="order-note">Note pour le préparateur<textarea name="customerNote" maxLength={1000}/></label>
              <p>Le prix final et la disponibilité sont contrôlés par le serveur au moment de la commande. Le stock est réservé dès la confirmation.</p>
              <button className="auth-submit" disabled={busy || unavailableLines.length > 0}>{busy ? 'Enregistrement…' : signedIn ? 'Confirmer la commande' : 'Confirmer la commande sans compte'}</button>
            </form>
          </>
        ) : view === 'orders' ? <>
          {!signedIn && <form className="transfer-reference-form" onSubmit={lookupGuestOrder}><label>Numéro de commande<input name="orderNumber" required placeholder="AP-AAAAMMJJ-XXXXXX"/></label><label>Code privé de suivi<input name="accessToken" required minLength={40} maxLength={80} autoComplete="off"/></label><button disabled={busy}>{busy ? 'Vérification…' : 'Retrouver ma commande'}</button></form>}
          <div className="customer-order-list">{orders.length === 0 ? <div className="admin-empty">Aucune commande enregistrée dans cette session.</div> : orders.map((order) => <article key={order.id}>
            <header><div><strong>{order.orderNumber}</strong><span>{new Date(order.createdAt).toLocaleString('fr-FR')} · {order.status === 'CANCELLED' ? 'Annulée' : order.status} · {order.paymentMethod === 'CASH_ON_DELIVERY' ? 'Paiement à la livraison' : 'Virement'} · {order.paymentStatus === 'PAID' ? 'Payée' : order.paymentStatus === 'TRANSFER_SUBMITTED' ? 'Virement à vérifier' : 'Non payée'}</span></div><b>{Number(order.totalInclTax).toFixed(3)} TND TTC</b></header>
            <button className="partner-secondary-action" disabled={busy} onClick={() => void downloadOrderDocument(order)}>Télécharger la facture · FACT-{order.orderNumber}</button>
            {order.paymentMethod === 'BANK_TRANSFER' && order.paymentStatus !== 'PAID' && order.status !== 'CANCELLED' && <form className="customer-payment-proof-form" onSubmit={(event) => void submitPaymentProof(event, order)}><label>Déposer une preuve de virement (PDF, JPEG ou PNG · 5 Mo max.)<input name="paymentProof" type="file" accept="application/pdf,image/jpeg,image/png" required disabled={busy}/></label><button disabled={busy}>{busy ? 'Envoi…' : 'Envoyer pour vérification'}</button></form>}
            <div className="customer-order-lines">{order.lines.map((line) => <div key={line.id}><span>{line.productNameSnapshot} × {line.quantity}</span><span>{line.status === 'CANCELLED' ? 'Annulée' : line.status} · {Number(line.lineTotalInclTax).toFixed(3)} TND</span>{line.trackingReference && <small className="shipment-tracking">Suivi : {line.trackingUrl ? <a href={line.trackingUrl} target="_blank" rel="noreferrer">{line.trackingReference} ↗</a> : line.trackingReference}</small>}</div>)}</div>
            {!order.guestAccessToken && order.status !== 'CANCELLED' && <button className="partner-secondary-action" disabled={busy} onClick={() => void cancelCustomerOrder(order)}>Annuler la commande</button>}
          </article>)}</div>
        </> : <div className="customer-address-list">{addresses.length === 0 ? <div className="admin-empty">Aucune adresse enregistrée. Ajoutez-en une depuis le formulaire du panier.</div> : addresses.map((address) => <article key={address.id}><div><strong>{address.label}{address.isDefault && <span> · Par défaut</span>}</strong><p>{address.recipientName} · {address.phone}<br/>{address.address}, {address.city}</p></div><div className="customer-address-actions">{!address.isDefault && <button className="partner-secondary-action" disabled={busy} onClick={() => void setDefaultDeliveryAddress(address.id)}>Définir par défaut</button>}<button className="partner-secondary-action" disabled={busy} onClick={() => void deleteDeliveryAddress(address.id)}>Supprimer</button></div></article>)}</div>}
      </section>
    </div>
  );
}

type SupplierOrderLine = { id: string; orderId: string; quantity: number; status: string; productNameSnapshot: string; productSkuSnapshot: string; supplierSkuSnapshot: string; purchaseUnitPriceExclTaxSnapshot: string | number | null; purchaseVatRateSnapshot: string | number | null; purchaseLineTotalExclTax: string | null; purchaseLineTotalInclTax: string | null; carrierName?: string | null; trackingReference?: string | null; trackingUrl?: string | null; createdAt: string; warehouse: { code: string; name: string }; order: { orderNumber: string; status: string; createdAt: string } };
function SupplierOrders() {
  const navigate = useNavigate();
  const [lines, setLines] = useState<SupplierOrderLine[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState('');
  const load = async () => { const token = sessionStorage.getItem('ap360-token') || ''; const response = await fetch(`${API}/api/partner/orders`, { headers: { Authorization: `Bearer ${token}` } }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Chargement des commandes impossible.'); setLines(result.data); };
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'API indisponible.')); }, []);
  const next: Record<string, { status: string; label: string }> = { RESERVED: { status: 'ACCEPTED', label: 'Accepter la réservation' }, ACCEPTED: { status: 'PREPARING', label: 'Préparer pour retrait' } };
  const advance = async (line: SupplierOrderLine) => { const step = next[line.status]; if (!step) return; setBusy(line.id); setError(''); try { const token = sessionStorage.getItem('ap360-token') || ''; const response = await fetch(`${API}/api/partner/orders/lines/${line.id}/status`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: step.status }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Mise à jour impossible.'); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Mise à jour impossible.'); } finally { setBusy(''); } };
  return <section className="partner-panel" id="partner-orders"><div className="partner-panel-heading"><div><span className="partner-panel-eyebrow">PRÉPARATION POUR RETRAIT</span><h2>Commandes attribuées</h2><p>Consultez les lignes qui vous sont attribuées et le prix convenu avec GHORBEL. Le prix client fixé par GHORBEL n’est pas communiqué dans cet espace.</p></div><button className="partner-secondary-action" onClick={() => void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Chargement impossible.'))}>Actualiser</button></div>{error && <div className="auth-alert error">{error}</div>}{lines.length === 0 ? <div className="partner-empty">Aucune commande attribuée pour le moment.</div> : <div className="supplier-order-list">{lines.map((line) => <article key={line.id}><div className="supplier-order-main"><strong>{line.productNameSnapshot} × {line.quantity}</strong><span>{line.order.orderNumber} · {new Date(line.order.createdAt).toLocaleDateString('fr-FR')} · Réf. {line.productSkuSnapshot} · Votre SKU {line.supplierSkuSnapshot} · {line.warehouse.name}</span><small>Votre prix convenu : {line.purchaseUnitPriceExclTaxSnapshot === null ? 'non renseigné' : `${Number(line.purchaseUnitPriceExclTaxSnapshot).toFixed(3)} TND HT / unité`} · Total : {line.purchaseLineTotalExclTax ?? '—'} TND HT · TVA {Number(line.purchaseVatRateSnapshot ?? 0).toFixed(2)} % · {line.purchaseLineTotalInclTax ?? '—'} TND TTC</small><b>{line.status === 'RESERVED' ? 'Réservée' : line.status === 'ACCEPTED' ? 'Acceptée' : line.status === 'PREPARING' ? 'Prête à retirer par Ghorbel Automative Supply Group' : line.status === 'SHIPPED' ? 'Récupérée · en livraison' : line.status === 'DELIVERED' ? 'Livrée' : 'Annulée'}</b></div><div className="partner-action-group">{next[line.status] ? <button disabled={busy === line.id} onClick={() => void advance(line)}>{busy === line.id ? 'Mise à jour…' : next[line.status].label}</button> : null}<button type="button" className="partner-secondary-action" onClick={() => navigate(`/partner/invoices?orderId=${encodeURIComponent(line.orderId)}`)}>Joindre / générer une facture</button></div>{line.trackingReference && <small className="shipment-tracking">Suivi : {line.trackingReference}</small>}</article>)}</div>}</section>;
}

type SupplierInvoiceRecord = { id: string; invoiceNumber: string; fileName: string; status: 'PENDING' | 'ACCEPTED' | 'REJECTED'; reviewNote?: string | null; uploadedAt: string; order: { orderNumber: string }; events: { id: string; type: 'UPLOADED' | 'RESUBMITTED' | 'ACCEPTED' | 'REJECTED'; note?: string | null; createdAt: string; actor?: { email: string } }[] };
function SupplierInvoices() {
  const [lines, setLines] = useState<SupplierOrderLine[]>([]); const [invoices, setInvoices] = useState<SupplierInvoiceRecord[]>([]); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [mode, setMode] = useState<'upload' | 'generate'>('generate');
  const [selectedOrderId, setSelectedOrderId] = useState(() => new URLSearchParams(window.location.search).get('orderId') || '');
  const token = sessionStorage.getItem('ap360-token') || '';
  const load = async () => {
    const [ordersResponse, invoicesResponse] = await Promise.all([fetch(`${API}/api/partner/orders`, { headers: { Authorization: `Bearer ${token}` } }), fetch(`${API}/api/partner/supplier-invoices`, { headers: { Authorization: `Bearer ${token}` } })]);
    const [ordersResult, invoicesResult] = await Promise.all([ordersResponse.json(), invoicesResponse.json()]);
    if (!ordersResponse.ok || !invoicesResponse.ok) throw new Error(ordersResult.error || invoicesResult.error || 'Chargement des factures impossible.');
    setLines(ordersResult.data); setInvoices(invoicesResult.data);
  };
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'API indisponible.')); }, []);
  const orderOptions = Array.from(new Map(lines.map((line) => [line.orderId, { orderId: line.orderId, order: line.order }])).values());
  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form); const file = fields.get('pdf');
    if (!(file instanceof File) || file.size === 0 || file.size > 5 * 1024 * 1024 || file.type !== 'application/pdf') { setError('Choisissez un fichier PDF valide de 5 Mo maximum.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('Lecture du fichier impossible.')); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); });
      const orderId = String(fields.get('orderId') || ''); const order = orderOptions.find((candidate) => candidate.orderId === orderId);
      if (!order) throw new Error('Choisissez une commande qui vous a été attribuée.');
      const response = await fetch(`${API}/api/partner/orders/${orderId}/invoices`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceNumber: String(fields.get('invoiceNumber') || ''), pdfBase64: dataUrl.split(',')[1] }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Dépôt impossible.');
      form.reset(); setMessage(result.message); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Dépôt impossible.'); } finally { setBusy(false); }
  };
  const generate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form);
    const orderId = String(fields.get('orderId') || ''); const order = orderOptions.find((candidate) => candidate.orderId === orderId);
    if (!order) { setError('Choisissez une commande qui vous a été attribuée.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${API}/api/partner/orders/${orderId}/invoices/generate`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceNumber: String(fields.get('invoiceNumber') || '') }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Génération impossible.');
      form.reset(); setMessage(result.message); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Génération impossible.'); } finally { setBusy(false); }
  };
  const download = async (invoice: SupplierInvoiceRecord) => { setBusy(true); setError(''); try { const response = await fetch(`${API}/api/partner/supplier-invoices/${invoice.id}/file`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error('Téléchargement impossible.'); const href = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = href; anchor.download = invoice.fileName; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(href), 1000); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Téléchargement impossible.'); } finally { setBusy(false); } };
  return <section className="partner-panel" id="partner-invoices"><div className="partner-panel-heading"><div><span className="partner-panel-eyebrow">DOCUMENTS PARTENAIRE</span><h2>Factures à GHORBEL</h2><p>Joignez votre facture à une commande ou générez un PDF standard depuis les prix convenus avec GHORBEL et figés sur cette commande. Le document est transmis à GHORBEL pour vérification.</p></div><button className="partner-secondary-action" disabled={busy} onClick={() => void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Chargement impossible.'))}>Actualiser</button></div>{error && <div className="auth-alert error">{error}</div>}{message && <div className="auth-alert success">{message}</div>}<div className="partner-filter-tabs supplier-invoice-modes"><button type="button" className={mode === 'generate' ? 'selected' : ''} onClick={() => setMode('generate')}>Générer une facture</button><button type="button" className={mode === 'upload' ? 'selected' : ''} onClick={() => setMode('upload')}>Téléverser un PDF</button></div>{mode === 'generate' ? <form className="partner-offer-form supplier-invoice-form" onSubmit={(event) => void generate(event)}><label>Commande attribuée<select name="orderId" required value={selectedOrderId} onChange={(event) => setSelectedOrderId(event.target.value)}><option value="" disabled>Choisir une commande</option>{orderOptions.map((item) => <option key={item.orderId} value={item.orderId}>{item.order.orderNumber}</option>)}</select></label><label>Numéro de facture fournisseur<input name="invoiceNumber" required maxLength={100} placeholder="Ex. FA-2026-001"/></label><button className="auth-submit" disabled={busy || orderOptions.length === 0}>{busy ? 'Génération…' : 'Générer et transmettre'}</button></form> : <form className="partner-offer-form supplier-invoice-form" onSubmit={(event) => void upload(event)}><label>Commande attribuée<select name="orderId" required value={selectedOrderId} onChange={(event) => setSelectedOrderId(event.target.value)}><option value="" disabled>Choisir une commande</option>{orderOptions.map((item) => <option key={item.orderId} value={item.orderId}>{item.order.orderNumber}</option>)}</select></label><label>Numéro de facture fournisseur<input name="invoiceNumber" required maxLength={100}/></label><label>Fichier PDF (5 Mo maximum)<input name="pdf" type="file" accept="application/pdf,.pdf" required/></label><button className="auth-submit" disabled={busy || orderOptions.length === 0}>{busy ? 'Transmission…' : 'Transmettre à l’administration'}</button></form>}<div className="supplier-order-list">{invoices.length === 0 ? <div className="partner-empty">Aucune facture déposée.</div> : invoices.map((invoice) => <article key={invoice.id}><div className="supplier-order-main"><strong>{invoice.invoiceNumber} · {invoice.order.orderNumber}</strong><small>{invoice.fileName.includes('-generee') ? 'Générée avec le modèle Ghorbel Automative Supply Group · ' : ''}{new Date(invoice.uploadedAt).toLocaleString('fr-FR')} · {invoice.status === 'PENDING' ? 'En attente de vérification' : invoice.status === 'ACCEPTED' ? 'Acceptée' : 'À corriger'}{invoice.reviewNote ? ` · ${invoice.reviewNote}` : ''}</small><details className="payment-audit"><summary>Historique ({invoice.events.length})</summary>{invoice.events.map((event) => <p key={event.id}>{new Date(event.createdAt).toLocaleString('fr-FR')} · {event.type === 'UPLOADED' ? 'Facture déposée' : event.type === 'RESUBMITTED' ? 'Facture retransmise' : event.type === 'ACCEPTED' ? 'Acceptée' : 'Correction demandée'}{event.note ? ` · ${event.note}` : ''}</p>)}</details></div><button disabled={busy} onClick={() => void download(invoice)}>Télécharger</button></article>)}</div></section>;
}

function PartnerProfile({ email }: { email: string }) {
  const token = sessionStorage.getItem('ap360-token') || '';
  const [profile, setProfile] = useState({ firstName: '', lastName: '', phone: '', companyName: '', legalName: '', tradeName: '', businessAddress: '', businessCity: '', postalCode: '', taxIdentifier: '', commercialRegisterNumber: '', legalProfileStatus: 'PENDING' });
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [passwordError, setPasswordError] = useState(''); const [passwordMessage, setPasswordMessage] = useState(''); const [passwordBusy, setPasswordBusy] = useState(false);
  useEffect(() => { let active = true; void fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Chargement du profil impossible.'); if (active) setProfile({ firstName: result.data.firstName || '', lastName: result.data.lastName || '', phone: result.data.phone || '', companyName: result.data.companyName || '', legalName: result.data.legalName || '', tradeName: result.data.tradeName || '', businessAddress: result.data.businessAddress || '', businessCity: result.data.businessCity || '', postalCode: result.data.postalCode || '', taxIdentifier: result.data.taxIdentifier || '', commercialRegisterNumber: result.data.commercialRegisterNumber || '', legalProfileStatus: result.data.legalProfileStatus || 'PENDING' }); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Chargement du profil impossible.'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  const saveProfile = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setBusy(true); setError(''); setMessage(''); try { const { legalProfileStatus: _status, ...editableProfile } = profile; const response = await fetch(`${API}/api/partner/profile`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(editableProfile) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Enregistrement impossible.'); setProfile({ ...profile, ...result.data }); setMessage(result.message || 'Profil mis à jour.'); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Enregistrement impossible.'); } finally { setBusy(false); } };
  const changePassword = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form); const currentPassword = String(fields.get('currentPassword') || ''); const newPassword = String(fields.get('newPassword') || ''); const confirmPassword = String(fields.get('confirmPassword') || ''); if (newPassword !== confirmPassword) { setPasswordError('La confirmation ne correspond pas au nouveau mot de passe.'); setPasswordMessage(''); return; } setPasswordBusy(true); setPasswordError(''); setPasswordMessage(''); try { const response = await fetch(`${API}/api/partner/password`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Modification impossible.'); form.reset(); setPasswordMessage(result.message || 'Mot de passe modifié.'); } catch (reason) { setPasswordError(reason instanceof Error ? reason.message : 'Modification impossible.'); } finally { setPasswordBusy(false); } };
  return <section className="partner-panel" id="partner-profile"><div className="partner-panel-heading"><div><span className="partner-panel-eyebrow">COMPTE PARTENAIRE</span><h2>Profil et sécurité</h2><p>Gérez vos coordonnées professionnelles, les données légales de l’entreprise et l’accès à votre espace.</p></div></div>{loading ? <div className="partner-empty">Chargement du profil…</div> : <div className="partner-profile-grid"><form className="partner-offer-form partner-profile-form" onSubmit={(event) => void saveProfile(event)}><strong className="partner-profile-title">Coordonnées professionnelles</strong><label>Prénom<input value={profile.firstName} onChange={(event) => setProfile({ ...profile, firstName: event.target.value })} required maxLength={80}/></label><label>Nom<input value={profile.lastName} onChange={(event) => setProfile({ ...profile, lastName: event.target.value })} required maxLength={80}/></label><label>Entreprise / nom commercial<input value={profile.companyName} onChange={(event) => setProfile({ ...profile, companyName: event.target.value })} required maxLength={160}/></label><label>Téléphone<input type="tel" value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} required maxLength={24}/></label><strong className="partner-profile-title">Identité et adresse de l’entreprise</strong><label>Raison sociale<input value={profile.legalName} onChange={(event) => setProfile({ ...profile, legalName: event.target.value })} maxLength={160}/></label><label>Nom commercial<input value={profile.tradeName} onChange={(event) => setProfile({ ...profile, tradeName: event.target.value })} maxLength={160}/></label><label className="partner-profile-email">Adresse professionnelle<input value={profile.businessAddress} onChange={(event) => setProfile({ ...profile, businessAddress: event.target.value })} maxLength={300}/></label><label>Ville<input value={profile.businessCity} onChange={(event) => setProfile({ ...profile, businessCity: event.target.value })} maxLength={100}/></label><label>Code postal<input value={profile.postalCode} onChange={(event) => setProfile({ ...profile, postalCode: event.target.value })} maxLength={20}/></label><strong className="partner-profile-title">Identifiants entreprise</strong><label>Identifiant fiscal<input value={profile.taxIdentifier} onChange={(event) => setProfile({ ...profile, taxIdentifier: event.target.value })} maxLength={80}/></label><label>Registre de commerce<input value={profile.commercialRegisterNumber} onChange={(event) => setProfile({ ...profile, commercialRegisterNumber: event.target.value })} maxLength={80}/></label><div className="partner-profile-review"><b>Validation des informations légales</b><span>{profile.legalProfileStatus === 'APPROVED' ? 'Profil validé par GHORBEL' : profile.legalProfileStatus === 'REVIEW_REQUIRED' ? 'Correction demandée par GHORBEL' : 'En attente de vérification par GHORBEL'}</span><small>Toute modification des informations légales relance leur vérification.</small></div><label className="partner-profile-email">E-mail de connexion<input type="email" value={email} readOnly/><small>Pour modifier l’adresse de connexion, contactez l’administration.</small></label>{error && <div className="auth-alert error">{error}</div>}{message && <div className="auth-alert success">{message}</div>}<button className="auth-submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer le profil'}</button></form><form className="partner-offer-form partner-profile-form" onSubmit={(event) => void changePassword(event)}><strong className="partner-profile-title">Changer le mot de passe</strong><label className="partner-profile-email">Mot de passe actuel<input name="currentPassword" type="password" required maxLength={128} autoComplete="current-password"/></label><label>Nouveau mot de passe<input name="newPassword" type="password" required minLength={1} maxLength={128} autoComplete="new-password"/></label><label>Confirmer le nouveau mot de passe<input name="confirmPassword" type="password" required minLength={1} maxLength={128} autoComplete="new-password"/></label><small className="partner-profile-hint">Saisissez un mot de passe de 1 à 128 caractères.</small>{passwordError && <div className="auth-alert error">{passwordError}</div>}{passwordMessage && <div className="auth-alert success">{passwordMessage}</div>}<button className="auth-submit" disabled={passwordBusy}>{passwordBusy ? 'Modification…' : 'Modifier le mot de passe'}</button></form></div>}</section>;
}

type AdminOrder = { id: string; orderNumber: string; status: string; paymentMethod: string; paymentStatus: string; transferReference?: string | null; paymentProofs: { id: string; fileName: string; mimeType: string; fileSize: number; createdAt: string }[]; paymentConfirmedAt?: string | null; subtotalExclTax: string | number; vatTotal: string | number; totalInclTax: string | number; createdAt: string; deliveryName: string; deliveryPhone: string; deliveryAddress: string; deliveryCity: string; guestEmail?: string | null; customer?: { email: string; companyName?: string | null; role?: string } | null; paymentEvents: { id: string; fromStatus: string; toStatus: string; transferReference?: string | null; note?: string | null; createdAt: string; actor: { email: string } }[]; lines: { id: string; quantity: number; status: string; productNameSnapshot: string; productSkuSnapshot: string; supplierSkuSnapshot: string; carrierName?: string | null; trackingReference?: string | null; trackingUrl?: string | null; lineTotalInclTax: string | number; warehouse?: { code: string; name: string; city?: string | null } | null; supplierOffer?: { supplier: { companyName?: string | null; email: string } } | null }[] };
type AdminSupplierInvoice = SupplierInvoiceRecord & { supplier: { id: string; email: string; companyName?: string | null }; reviewedBy?: { email: string } | null; reviewNote?: string | null };
function AdminOrderManagement() {
  const [searchParams] = useSearchParams();
  const [orders, setOrders] = useState<AdminOrder[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(''); const [page, setPage] = useState(1); const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, pages: 0 }); const [filters, setFilters] = useState(() => ({ search: '', status: searchParams.get('status') || '', paymentStatus: '', paymentMethod: '', customerType: '', from: searchParams.get('from') || '', to: searchParams.get('to') || '' }));
  const load = async (nextPage = page, activeFilters = filters) => { const token = sessionStorage.getItem('ap360-token') || ''; const params = new URLSearchParams({ page: String(nextPage), pageSize: '25' }); Object.entries(activeFilters).forEach(([key, value]) => { if (value) params.set(key, value); }); const response = await fetch(`${API}/api/admin/orders?${params}`, { headers: { Authorization: `Bearer ${token}` } }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Chargement des commandes impossible.'); setOrders(result.data); setPagination(result.pagination); setPage(nextPage); };
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'API indisponible.')); }, []);
  const updatePayment = async (order: AdminOrder, status: 'PAID' | 'UNPAID') => { setBusy(order.id); setError(''); try { const token = sessionStorage.getItem('ap360-token') || ''; const response = await fetch(`${API}/api/admin/orders/${order.id}/payment`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Mise à jour impossible.'); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Mise à jour impossible.'); } finally { setBusy(''); } };
  const cancelAdminOrder = async (order: AdminOrder) => { if (!window.confirm(`Annuler la commande ${order.orderNumber} et libérer les réservations ?`)) return; setBusy(order.id); setError(''); try { const token = sessionStorage.getItem('ap360-token') || ''; const response = await fetch(`${API}/api/admin/orders/${order.id}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Annulation impossible.'); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Annulation impossible.'); } finally { setBusy(''); } };
  const fulfillLine = async (lineId: string, status: 'SHIPPED' | 'DELIVERED') => { setBusy(lineId); setError(''); try { const token = sessionStorage.getItem('ap360-token') || ''; const response = await fetch(`${API}/api/admin/orders/lines/${lineId}/status`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Mise à jour de livraison impossible.'); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Mise à jour de livraison impossible.'); } finally { setBusy(''); } };
  const prepareGhorbelLine = async (lineId: string, status: 'ACCEPTED' | 'PREPARING') => { setBusy(lineId); setError(''); try { const token = sessionStorage.getItem('ap360-token') || ''; const response = await fetch(`${API}/api/admin/orders/lines/${lineId}/prepare`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Mise à jour impossible.'); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Mise à jour impossible.'); } finally { setBusy(''); } };
  const downloadDocument = async (order: AdminOrder) => { setBusy(order.id); setError(''); try { const token = sessionStorage.getItem('ap360-token') || ''; const response = await fetch(`${API}/api/admin/orders/${order.id}/document`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'Téléchargement impossible.'); } const href = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = href; anchor.download = `FACT-${order.orderNumber}.pdf`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(href), 1000); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Téléchargement impossible.'); } finally { setBusy(''); } };
  const downloadPaymentProof = async (order: AdminOrder, proof: AdminOrder['paymentProofs'][number]) => { setBusy(proof.id); setError(''); try { const token = sessionStorage.getItem('ap360-token') || ''; const response = await fetch(`${API}/api/admin/orders/${order.id}/payment-proofs/${proof.id}`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'Téléchargement impossible.'); } const href = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = href; anchor.download = proof.fileName; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(href), 1000); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Téléchargement impossible.'); } finally { setBusy(''); } };
  const downloadCsv = async () => { const token = sessionStorage.getItem('ap360-token') || ''; const params = new URLSearchParams(); Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); }); setBusy('csv'); setError(''); try { const response = await fetch(`${API}/api/admin/orders/export.csv?${params}`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'Export CSV impossible.'); } const href = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = href; anchor.download = `commandes-ghorbel-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(href), 1000); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Export CSV impossible.'); } finally { setBusy(''); } };  return <section className="admin-section" id="admin-orders"><h3>Commandes et affectation fournisseur</h3><p className="auth-intro">Les commandes figent les tarifs et conservent une ligne par fournisseur et entrepôt réservés.</p><form className="admin-order-filters" onSubmit={(event) => { event.preventDefault(); void load(1).catch((reason) => setError(reason instanceof Error ? reason.message : 'Filtrage impossible.')); }}><input type="search" aria-label="Rechercher une commande" placeholder="N° commande, client, pièce ou référence" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })}/><select aria-label="Statut de commande" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Tous les statuts</option><option value="PLACED">Nouvelle</option><option value="PROCESSING">En préparation</option><option value="PARTIALLY_SHIPPED">Partiellement expédiée</option><option value="SHIPPED">Expédiée</option><option value="DELIVERED">Livrée</option><option value="CANCELLED">Annulée</option></select><select aria-label="Statut du paiement" value={filters.paymentStatus} onChange={(event) => setFilters({ ...filters, paymentStatus: event.target.value })}><option value="">Tous les paiements</option><option value="UNPAID">Impayée</option><option value="TRANSFER_SUBMITTED">Virement à vérifier</option><option value="PAID">Payée</option></select><select aria-label="Mode de paiement" value={filters.paymentMethod} onChange={(event) => setFilters({ ...filters, paymentMethod: event.target.value })}><option value="">Tous les moyens</option><option value="CASH_ON_DELIVERY">À la livraison</option><option value="BANK_TRANSFER">Virement</option></select><select aria-label="Type de client" value={filters.customerType} onChange={(event) => setFilters({ ...filters, customerType: event.target.value })}><option value="">Tous les clients</option><option value="CUSTOMER">Particulier</option><option value="RESELLER">Revendeur</option><option value="GUEST">Invité</option></select><label>Du<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })}/></label><label>Au<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })}/></label><button type="submit" disabled={busy !== ''}>Appliquer</button><button type="button" className="partner-secondary-action" disabled={busy !== ''} onClick={() => void downloadCsv()}>{busy === 'csv' ? 'Préparation…' : 'Exporter CSV filtré'}</button><button type="button" className="partner-secondary-action" onClick={() => { const cleared = { search: '', status: '', paymentStatus: '', paymentMethod: '', customerType: '', from: '', to: '' }; setFilters(cleared); void load(1, cleared).catch((reason) => setError(reason instanceof Error ? reason.message : 'Chargement impossible.')); }}>Effacer</button></form>{error && <div className="auth-alert error">{error}</div>}{orders.length === 0 ? <div className="admin-empty">Aucune commande enregistrée.</div> : <div className="admin-list">{orders.map((order) => <article className="admin-order-card" key={order.id}><header><div><strong>{order.orderNumber}</strong><span>{order.customer?.companyName || order.customer?.email || order.guestEmail || order.deliveryName} · {new Date(order.createdAt).toLocaleString('fr-FR')} · {order.status === 'CANCELLED' ? 'Annulée' : order.status === 'PLACED' ? 'Nouvelle' : order.status === 'PROCESSING' ? 'En préparation' : order.status === 'PARTIALLY_SHIPPED' ? 'Partiellement expédiée' : order.status === 'SHIPPED' ? 'Expédiée' : 'Livrée'}</span><small>Livraison : {order.deliveryName} · {order.deliveryPhone} · {order.deliveryAddress}, {order.deliveryCity}</small><small>Paiement : {order.paymentMethod === 'CASH_ON_DELIVERY' ? 'À la livraison' : 'Virement'} · {order.paymentStatus === 'PAID' ? 'Payée' : order.paymentStatus === 'TRANSFER_SUBMITTED' ? 'Virement à vérifier' : 'Non payée'}{order.transferReference ? ` · Réf. ${order.transferReference}` : ''}</small></div><b>{Number(order.totalInclTax).toFixed(3)} TND TTC</b></header><button className="partner-secondary-action" disabled={busy === order.id} onClick={() => void downloadDocument(order)}>Télécharger la facture client</button>{order.paymentProofs.length > 0 && <div className="admin-payment-proofs"><strong>Justificatifs de virement</strong>{order.paymentProofs.map((proof) => <button className="partner-secondary-action" key={proof.id} disabled={busy === proof.id} onClick={() => void downloadPaymentProof(order, proof)}>{busy === proof.id ? "Téléchargement…" : `Télécharger ${proof.fileName}`} · {new Date(proof.createdAt).toLocaleString("fr-FR")} · {(proof.fileSize / 1024).toFixed(0)} Ko</button>)}</div>}{order.paymentStatus !== 'PAID' && <div className="admin-payment-actions">{order.paymentMethod === 'BANK_TRANSFER' && order.paymentStatus === 'TRANSFER_SUBMITTED' ? <><button disabled={busy === order.id} onClick={() => void updatePayment(order, 'PAID')}>Confirmer le virement</button><button className="decline" disabled={busy === order.id} onClick={() => void updatePayment(order, 'UNPAID')}>Rejeter la preuve / référence</button></> : order.paymentMethod === 'CASH_ON_DELIVERY' && order.status === 'DELIVERED' ? <button disabled={busy === order.id} onClick={() => void updatePayment(order, 'PAID')}>Confirmer l’encaissement</button> : null}</div>}{order.status !== 'CANCELLED' && order.paymentStatus === 'UNPAID' && order.lines.every((line) => ['RESERVED', 'ACCEPTED', 'PREPARING'].includes(line.status)) && <button className="order-cancel-button" disabled={busy === order.id} onClick={() => void cancelAdminOrder(order)}>{busy === order.id ? 'Annulation…' : 'Annuler et libérer le stock'}</button>}{order.paymentEvents.length > 0 && <details className="payment-audit"><summary>Historique des paiements ({order.paymentEvents.length})</summary>{order.paymentEvents.map((event) => <p key={event.id}>{new Date(event.createdAt).toLocaleString('fr-FR')} · {event.actor.email} · {event.fromStatus} → {event.toStatus}{event.transferReference ? ` · ${event.transferReference}` : ''}{event.note ? ` · ${event.note}` : ''}</p>)}</details>}<div className="admin-order-lines">{order.lines.map((line) => <div key={line.id}><span>{line.productNameSnapshot} × {line.quantity} · {line.status === 'CANCELLED' ? 'Annulée' : line.status}</span><small>{line.supplierOffer?.supplier.companyName || line.supplierOffer?.supplier.email || (line.supplierSkuSnapshot === 'FOURNISSEUR_SUPPRIME' ? 'Fournisseur supprimé' : 'Stock GHORBEL')} · {line.supplierOffer ? 'Entrepôt : ' + (line.warehouse?.name || 'non renseigné') : line.supplierSkuSnapshot === 'FOURNISSEUR_SUPPRIME' ? 'Fournisseur supprimé' : 'Stock GHORBEL, sans entrepôt'}{line.warehouse?.city ? ` · ${line.warehouse.city}` : ''} · Réf. {line.productSkuSnapshot} · SKU fournisseur {line.supplierSkuSnapshot}{line.trackingReference ? ' · Suivi ' + (line.carrierName ? line.carrierName + ' ' : '') + line.trackingReference : ''}</small>{line.trackingUrl && <a className="shipment-admin-link" href={line.trackingUrl} target="_blank" rel="noreferrer">Ouvrir le suivi ↗</a>}{!line.supplierOffer && line.supplierSkuSnapshot !== 'FOURNISSEUR_SUPPRIME' && line.status === 'RESERVED' && <button className="partner-secondary-action" disabled={busy === line.id} onClick={() => void prepareGhorbelLine(line.id, 'ACCEPTED')}>Accepter la commande</button>}{!line.supplierOffer && line.supplierSkuSnapshot !== 'FOURNISSEUR_SUPPRIME' && line.status === 'ACCEPTED' && <button className="partner-secondary-action" disabled={busy === line.id} onClick={() => void prepareGhorbelLine(line.id, 'PREPARING')}>Préparer la pièce</button>}{line.status === 'PREPARING' && <button className="partner-secondary-action" disabled={busy === line.id} onClick={() => void fulfillLine(line.id, 'SHIPPED')}>{busy === line.id ? 'Enregistrement…' : 'Marquer récupérée à l’entrepôt'}</button>}{line.status === 'SHIPPED' && <button className="partner-secondary-action" disabled={busy === line.id} onClick={() => void fulfillLine(line.id, 'DELIVERED')}>{busy === line.id ? 'Enregistrement…' : 'Confirmer la livraison au client'}</button>}<b>{Number(line.lineTotalInclTax).toFixed(3)} TND</b></div>)}</div></article>)}</div>}<nav className="admin-order-pagination" aria-label="Pagination des commandes"><span>{pagination.total} commande(s) · Page {pagination.pages ? pagination.page : 0} sur {pagination.pages}</span><button className="partner-secondary-action" disabled={page <= 1} onClick={() => void load(page - 1).catch((reason) => setError(reason instanceof Error ? reason.message : 'Chargement impossible.'))}>Précédent</button><button className="partner-secondary-action" disabled={page >= pagination.pages} onClick={() => void load(page + 1).catch((reason) => setError(reason instanceof Error ? reason.message : 'Chargement impossible.'))}>Suivant</button></nav></section>;
}

function AdminSupplierInvoices() {
  const [invoices, setInvoices] = useState<AdminSupplierInvoice[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(''); const [notes, setNotes] = useState<Record<string, string>>({});
  const load = async () => { const token = sessionStorage.getItem('ap360-token') || ''; const response = await fetch(`${API}/api/admin/supplier-invoices`, { headers: { Authorization: `Bearer ${token}` } }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Chargement des factures fournisseur impossible.'); setInvoices(result.data); };
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'API indisponible.')); }, []);
  const review = async (invoice: AdminSupplierInvoice, status: 'ACCEPTED' | 'REJECTED') => { setBusy(invoice.id); setError(''); try { const token = sessionStorage.getItem('ap360-token') || ''; const response = await fetch(`${API}/api/admin/supplier-invoices/${invoice.id}/review`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status, note: notes[invoice.id] || '' }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Mise à jour impossible.'); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Mise à jour impossible.'); } finally { setBusy(''); } };
  const download = async (invoice: AdminSupplierInvoice) => { setBusy(invoice.id); setError(''); try { const token = sessionStorage.getItem('ap360-token') || ''; const response = await fetch(`${API}/api/admin/supplier-invoices/${invoice.id}/file`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error('Téléchargement impossible.'); const href = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = href; anchor.download = invoice.fileName; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(href), 1000); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Téléchargement impossible.'); } finally { setBusy(''); } };
  return <section className="admin-section" id="admin-supplier-invoices"><h3>Factures d’achat fournisseurs</h3><p className="auth-intro">Les pièces jointes sont privées, contrôlées par fournisseur et liées aux commandes attribuées.</p>{error && <div className="auth-alert error">{error}</div>}{invoices.length === 0 ? <div className="admin-empty">Aucune facture fournisseur déposée.</div> : <div className="admin-list">{invoices.map((invoice) => <article className="admin-account" key={invoice.id}><div><strong>{invoice.invoiceNumber} · {invoice.order.orderNumber}</strong><span>{invoice.supplier.companyName || invoice.supplier.email} · {new Date(invoice.uploadedAt).toLocaleString('fr-FR')} · {invoice.status === 'PENDING' ? 'À vérifier' : invoice.status === 'ACCEPTED' ? 'Acceptée' : 'À corriger'}</span>{invoice.reviewNote && <small>Note : {invoice.reviewNote}</small>}<details className="payment-audit"><summary>Historique ({invoice.events.length})</summary>{invoice.events.map((event) => <p key={event.id}>{new Date(event.createdAt).toLocaleString('fr-FR')} · {event.actor?.email || 'Administration'} · {event.type === 'UPLOADED' ? 'Facture déposée' : event.type === 'RESUBMITTED' ? 'Facture retransmise' : event.type === 'ACCEPTED' ? 'Facture acceptée' : 'Correction demandée'}{event.note ? ` · ${event.note}` : ''}</p>)}</details><input aria-label={`Note de contrôle pour ${invoice.invoiceNumber}`} maxLength={1000} placeholder="Note pour le fournisseur (facultatif)" value={notes[invoice.id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [invoice.id]: event.target.value }))}/></div><div className="admin-actions"><button disabled={busy === invoice.id} onClick={() => void download(invoice)}>Télécharger PDF</button>{invoice.status === 'PENDING' && <><button disabled={busy === invoice.id} onClick={() => void review(invoice, 'ACCEPTED')}>Accepter</button><button className="decline" disabled={busy === invoice.id} onClick={() => void review(invoice, 'REJECTED')}>Refuser</button></>}</div></article>)}</div>}</section>;
}

function ProductDetailPage({ onAddToCart }: { onAddToCart: (product: Product) => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const id = location.pathname.split('/').filter(Boolean).at(-1) || '';
  const initialProduct = (location.state as { product?: Product } | null)?.product;
  const [activeImage, setActiveImage] = useState(0);
  const productQuery = useQuery({ queryKey: ['product-detail', id], queryFn: async () => {
    const token = sessionStorage.getItem('ap360-token');
    const response = await fetch(`${API}/api/catalog/products/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Pièce introuvable.');
    return result.data as Product;
  }, enabled: !!id, initialData: initialProduct?.id === id ? initialProduct : undefined });
  const product = productQuery.data;
  return <main className="product-detail-page"><CartToast/><header className="product-detail-header"><a className="brand" href="/"><img className="brand-logo" src="/Logo.webp" alt="Ghorbel Automative Supply Group"/></a><button className="product-back-button" onClick={() => navigate(-1)}><ArrowRight size={15}/> Retour au catalogue</button></header>
    {productQuery.isPending ? <div className="product-detail-state">Chargement de la fiche produit…</div> : productQuery.isError || !product ? <div className="product-detail-state error">{productQuery.error instanceof Error ? productQuery.error.message : 'Pièce introuvable.'}<a href="/">Revenir au catalogue</a></div> : <article className="product-detail-layout">
      <div className="product-gallery"><div className="product-gallery-main">{product.images?.length ? <div className="product-gallery-frame"><img className="product-detail-image" src={imageSource(product.images[activeImage])} alt={`${product.name} — photo ${activeImage + 1}`} onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}/></div> : <div className="product-gallery-placeholder"><Box size={58}/><strong>Photos du produit</strong><span>Aucune photo n’a encore été ajoutée à cette fiche.</span></div>}</div>{!!product.images?.length && <div className="product-gallery-thumbs">{product.images.map((image, index) => <button className={activeImage === index ? 'selected' : ''} key={image} onClick={() => setActiveImage(index)}><img src={imageSource(image)} alt={`Miniature ${index + 1}`}/></button>)}</div>}</div>
      <div className="product-detail-info"><div className="eyebrow">{product.category || 'PIÈCE AUTOMOBILE'}{product.pieceBrand ? ` · ${product.pieceBrand}` : ''}</div><h1>{product.name}</h1><div className="product-detail-price">{product.pricing ? <><strong>{Number(product.pricing.unitPriceInclTax).toFixed(3)} TND</strong><span>Prix final TTC</span></> : <strong>Prix de vente à définir</strong>}</div><div className={`product-detail-stock ${(product.availableQuantity ?? 0) > 0 ? 'in-stock' : ''}`}>{product.availableQuantity ? `${product.availableQuantity} pièce(s) disponible(s)` : 'Rupture de stock'}</div>{product.pricing && <button className="add-cart-button product-detail-add" disabled={!product.availableQuantity} onClick={() => onAddToCart(product)}><ShoppingCart size={16}/>{product.availableQuantity ? 'Ajouter au panier' : 'Indisponible'}</button>}
        <section><h2>Description</h2><p>{product.description || 'Aucune description détaillée n’a été renseignée pour le moment.'}</p></section>
        <section><h2>Références</h2>{product.references.length ? <ul className="product-detail-list">{product.references.map((item) => <li key={`${item.type}-${item.value}`}><b>{item.type}</b><span>{item.value}</span></li>)}</ul> : <p>Aucune référence enregistrée.</p>}<p className="product-detail-list"><b>SKU catalogue</b><span>{product.sku}</span></p></section>
        <section><h2>Compatibilité véhicule</h2>{product.compatibilities?.length ? <ul className="product-detail-fitments">{product.compatibilities.map((fitment, index) => <li key={index}><ShieldCheck size={16}/><span><b>{fitment.generation.model.make.name} {fitment.generation.model.name} · {fitment.generation.name}</b><small>{fitment.yearFrom}{fitment.yearTo && fitment.yearTo !== fitment.yearFrom ? `–${fitment.yearTo}` : ''}{fitment.engine ? ` · ${fitment.engine.engineCode || fitment.engine.name}${fitment.engine.fuel ? ` · ${fitment.engine.fuel}` : ''}${fitment.engine.displacementCc ? ` · ${fitment.engine.displacementCc} cm³` : ''}` : ''}{fitment.variant ? ` · ${fitment.variant.name}${fitment.variant.bodyStyle ? ` · ${fitment.variant.bodyStyle}` : ''}` : ''}{fitment.source?.startsWith('Déclarée par') ? ' · Compatibilité déclarée par le fournisseur' : ' · Compatibilité vérifiée'}</small></span></li>)}</ul> : <p>Aucune compatibilité n’est associée à cette pièce.</p>}</section>
      </div></article>}
  </main>;
}

type AdminUserRecord = { id: string; email: string; phone: string | null; firstName: string; lastName: string; role: 'ADMIN' | 'SUPPLIER' | 'RESELLER' | 'CUSTOMER'; status: 'PENDING' | 'ACTIVE' | 'SUSPENDED'; companyName: string | null; legalName?: string | null; tradeName?: string | null; businessAddress?: string | null; businessCity?: string | null; postalCode?: string | null; taxIdentifier?: string | null; commercialRegisterNumber?: string | null; legalProfileStatus?: 'PENDING' | 'APPROVED' | 'REVIEW_REQUIRED'; pricingProfileId: string | null; createdAt: string };

function AdminUsers({ buyerOnly = false }: { buyerOnly?: boolean }) {
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState(buyerOnly ? 'CUSTOMER' : '');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [editing, setEditing] = useState<AdminUserRecord | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const load = async (nextPage = page, queryValue = query, roleValue = roleFilter, statusValue = statusFilter) => {
    const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    const params = new URLSearchParams({ page: String(nextPage), limit: '50' });
    if (queryValue.trim()) params.set('q', queryValue.trim()); if (roleValue) params.set('role', roleValue); if (statusValue) params.set('status', statusValue);
    setBusy('load'); setError('');
    try {
      const response = await fetch(`${API}/api/admin/users?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Impossible de charger les utilisateurs.');
      setUsers(result.data); setPage(result.pagination.page); setPages(Math.max(1, result.pagination.pages)); setTotal(result.pagination.total);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'API indisponible.'); }
    finally { setBusy(''); }
  };
  useEffect(() => { void load(1, '', buyerOnly ? 'CUSTOMER' : '', ''); }, [buyerOnly]);
  const saveDetails = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!editing) return;
    const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    const fields = new FormData(event.currentTarget);
    const body = Object.fromEntries(['email','phone','firstName','lastName','companyName','status'].map((key) => [key, String(fields.get(key) ?? '')]));
    setBusy(editing.id); setError(''); setMessage('');
    try {
      const response = await fetch(`${API}/api/admin/users/${editing.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Modification impossible.');
      setEditing(null); setMessage(`Compte de ${result.data.email} mis à jour.`); await load(page);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'API indisponible.'); }
    finally { setBusy(''); }
  };
  const resetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!editing) return;
    if (password !== passwordConfirm) { setPasswordError('Les deux mots de passe ne correspondent pas.'); return; }
    const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    setBusy(`${editing.id}-password`); setPasswordError(''); setPasswordMessage('');
    try {
      const response = await fetch(`${API}/api/admin/users/${editing.id}/password`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Réinitialisation impossible.');
      setPassword(''); setPasswordConfirm(''); setPasswordMessage('Mot de passe réinitialisé. Il ne sera plus affiché.');
    } catch (cause) { setPasswordError(cause instanceof Error ? cause.message : 'API indisponible.'); }
    finally { setBusy(''); }
  };
  const deleteSupplier = async (user: AdminUserRecord) => {
    if (user.role !== 'SUPPLIER') return;
    if (!window.confirm(`Supprimer définitivement le fournisseur « ${user.companyName || user.email} » ? Son compte, ses offres, ses stocks, ses factures fournisseur et ses produits non partagés seront supprimés. Les lignes de commandes passées resteront sans rattachement fournisseur.`)) return;
    const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    setBusy(user.id); setError(''); setMessage('');
    try {
      const response = await fetch(`${API}/api/admin/users/${user.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Suppression impossible.');
      if (editing?.id === user.id) setEditing(null);
      setMessage(result.message || 'Fournisseur supprimé.'); await load(page);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Suppression impossible.'); }
    finally { setBusy(''); }
  };
  const reviewLegalProfile = async (user: AdminUserRecord, status: 'APPROVED' | 'REVIEW_REQUIRED') => {
    const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    setBusy(user.id); setError(''); setMessage('');
    try { const response = await fetch(`${API}/api/admin/users/${user.id}/legal-profile-status`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Validation impossible.'); setMessage(result.message || 'Profil traité.'); await load(page); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Validation impossible.'); }
    finally { setBusy(''); }
  };
  const roleName = (role: string) => ({ ADMIN: 'Administrateur', SUPPLIER: 'Fournisseur', RESELLER: 'Revendeur', CUSTOMER: 'Acheteur particulier' }[role] || role);
  const statusName = (status: string) => ({ ACTIVE: 'Actif', PENDING: 'En attente', SUSPENDED: 'Suspendu' }[status] || status);
  return <section className="admin-section" id="admin-users"><h3>{buyerOnly ? "Acheteurs" : "Utilisateurs"}</h3><p className="auth-intro">{buyerOnly ? "Gérez les comptes clients qui achètent sur la plateforme." : "Consultez les comptes clients, fournisseurs, revendeurs et administrateurs."} Modifiez leurs coordonnées ou réinitialisez un mot de passe.</p>
    <form className="admin-users-filters" onSubmit={(event) => { event.preventDefault(); void load(1); }}><input aria-label="Rechercher un utilisateur" placeholder="Nom, entreprise, e-mail ou téléphone" value={query} onChange={(event) => setQuery(event.target.value)}/><select aria-label="Filtrer par type" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="">Tous les types</option><option value="CUSTOMER">Acheteurs particuliers</option><option value="RESELLER">Revendeurs</option><option value="SUPPLIER">Fournisseurs</option><option value="ADMIN">Administrateurs</option></select><select aria-label="Filtrer par statut" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Tous les statuts</option><option value="ACTIVE">Actifs</option><option value="PENDING">En attente</option><option value="SUSPENDED">Suspendus</option></select><button disabled={busy === 'load'}>{busy === 'load' ? 'Chargement…' : 'Rechercher'}</button></form>
    {error && <div className="auth-alert error">{error}</div>}{message && <div className="auth-alert success">{message}</div>}
    {busy === 'load' && !users.length ? <div className="admin-empty">Chargement des comptes…</div> : users.length ? <div className="admin-list">{users.map((user) => <article className="admin-account admin-user-row" key={user.id}><div><strong>{user.companyName || `${user.firstName} ${user.lastName}`}</strong><span>{user.email} · {user.phone || 'Sans téléphone'} · {roleName(user.role)}</span><small>{statusName(user.status)} · Créé le {new Date(user.createdAt).toLocaleDateString('fr-FR')}</small>{(user.role === 'SUPPLIER' || user.role === 'RESELLER') && <details className="admin-legal-profile"><summary>Profil légal · {user.legalProfileStatus === 'APPROVED' ? 'Validé' : user.legalProfileStatus === 'REVIEW_REQUIRED' ? 'Correction demandée' : 'À vérifier'}</summary><div><span>Raison sociale : {user.legalName || 'Non renseignée'}</span><span>Nom commercial : {user.tradeName || 'Non renseigné'}</span><span>Adresse : {[user.businessAddress, user.postalCode, user.businessCity].filter(Boolean).join(', ') || 'Non renseignée'}</span><span>Identifiant fiscal : {user.taxIdentifier || 'Non renseigné'}</span><span>Registre de commerce : {user.commercialRegisterNumber || 'Non renseigné'}</span></div><div className="admin-actions"><button disabled={!!busy} onClick={() => void reviewLegalProfile(user, 'APPROVED')}>Valider les informations</button><button className="partner-secondary-action" disabled={!!busy} onClick={() => void reviewLegalProfile(user, 'REVIEW_REQUIRED')}>Demander une correction</button></div></details>}</div><div className="admin-actions"><button disabled={!!busy} onClick={() => { setEditing(user); setPassword(''); setPasswordConfirm(''); setPasswordMessage(''); setPasswordError(''); }}>Modifier</button>{user.role === 'SUPPLIER' && <button className="decline" disabled={!!busy} onClick={() => void deleteSupplier(user)}>{busy === user.id ? 'Suppression…' : 'Supprimer le fournisseur'}</button>}</div></article>)}</div> : <div className="admin-empty">Aucun utilisateur trouvé.</div>}
    <div className="admin-users-pagination"><span>{total} compte(s) · page {page} sur {pages}</span><div><button disabled={page <= 1 || busy === 'load'} onClick={() => void load(page - 1)}>Précédent</button><button disabled={page >= pages || busy === 'load'} onClick={() => void load(page + 1)}>Suivant</button></div></div>
    {editing && <div className="admin-user-editor"><div className="admin-user-editor-heading"><strong>Modifier le compte : {editing.email}</strong><button type="button" onClick={() => setEditing(null)}>Fermer</button></div><form className="partner-create-form" onSubmit={saveDetails}><div className="partner-create-grid"><label>Prénom<input name="firstName" required maxLength={80} defaultValue={editing.firstName}/></label><label>Nom<input name="lastName" required maxLength={80} defaultValue={editing.lastName}/></label><label>E-mail<input name="email" type="email" required maxLength={254} defaultValue={editing.email}/></label><label>Téléphone<input name="phone" type="tel" maxLength={24} defaultValue={editing.phone || ''}/></label><label>Entreprise<input name="companyName" maxLength={160} defaultValue={editing.companyName || ''}/></label><label>Statut<select name="status" defaultValue={editing.status} disabled={editing.role === 'ADMIN'}><option value="ACTIVE">Actif</option><option value="PENDING">En attente</option><option value="SUSPENDED">Suspendu</option></select></label></div>{editing.role === 'ADMIN' && <small>Le statut administrateur est protégé pour éviter de verrouiller l’accès à la plateforme.</small>}<button className="auth-submit" disabled={!!busy}>{busy === editing.id ? 'Enregistrement…' : 'Enregistrer les modifications'}</button></form><form className="admin-password-form" onSubmit={resetPassword}><strong>Réinitialiser le mot de passe</strong><p>Le nouveau mot de passe sera haché côté serveur et ne sera jamais affiché.</p><div className="admin-password-fields"><label>Nouveau mot de passe<input type="password" autoComplete="new-password" required minLength={1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)}/></label><label>Confirmer le mot de passe<input type="password" autoComplete="new-password" required minLength={1} maxLength={128} value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)}/></label><button disabled={!!busy}>{busy === `${editing.id}-password` ? 'Réinitialisation…' : 'Réinitialiser'}</button></div>{passwordError && <div className="auth-alert error">{passwordError}</div>}{passwordMessage && <div className="auth-alert success">{passwordMessage}</div>}</form></div>}
  </section>;
}

type ContactMessageItem = { id: string; fullName: string; email: string; subject: string; body: string; readAt: string | null; createdAt: string; replies: { id: string; body: string; createdAt: string; admin: { firstName: string; lastName: string } | null }[] };

function ContactPage({ signedInAs }: { signedInAs: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(''); setSuccess(false);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = Object.fromEntries(form.entries());
    try {
      const token = sessionStorage.getItem('ap360-token');
      const response = await fetch(`${API}/api/contact-messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Votre message n’a pas pu être envoyé.');
      setSuccess(true); formElement.reset();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Votre message n’a pas pu être envoyé.'); }
    finally { setBusy(false); }
  };
  return <div className="contact-standalone"><header><a href="/" aria-label="Retour au catalogue"><img src="/Logo.webp" alt="Ghorbel Automative Supply Group"/></a><button type="button" onClick={() => navigate('/')}>← Retour au catalogue</button></header><main><div className="contact-standalone-intro"><span className="eyebrow">CONTACT GHORBEL</span><h1>Comment pouvons-nous vous aider ?</h1><p>Envoyez votre demande à notre équipe. Nous vous répondrons par e-mail à l’adresse indiquée.</p><a href="mailto:ghorbelautomotivesupplygroup@gmail.com">ghorbelautomotivesupplygroup@gmail.com</a></div><form className="contact-message-form" onSubmit={(event) => void submit(event)}><div className="contact-form-row"><label>Nom complet<input name="fullName" required minLength={2} maxLength={160} autoComplete="name"/></label><label>Adresse e-mail<input name="email" type="email" required maxLength={254} autoComplete="email" defaultValue={signedInAs || undefined}/></label></div><label>Objet<input name="subject" required minLength={3} maxLength={180} placeholder="Ex. Question sur une commande"/></label><label>Votre message<textarea name="body" required minLength={10} maxLength={5000} rows={7} placeholder="Décrivez votre demande…"/></label><label className="contact-honeypot" aria-hidden="true">Site web<input name="website" tabIndex={-1} autoComplete="off"/></label>{error && <div className="auth-alert error">{error}</div>}{success && <div className="auth-alert success" role="status">Votre message a bien été envoyé à l’équipe GHORBEL. Nous vous répondrons par e-mail.</div>}<button className="auth-submit" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer le message'}</button><small>Votre adresse e-mail sera utilisée pour vous répondre.</small></form></main></div>;
}

function AdminContactInbox() {
  const [messages, setMessages] = useState<ContactMessageItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = async () => {
    const token = sessionStorage.getItem('ap360-token') || '';
    const response = await fetch(`${API}/api/admin/contact-messages`, { headers: { Authorization: `Bearer ${token}` } });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Chargement des messages impossible.');
    setMessages(result.data as ContactMessageItem[]);
    setSelectedId((current) => result.data.some((item: ContactMessageItem) => item.id === current) ? current : result.data[0]?.id || '');
  };
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Chargement impossible.')); }, []);
  const selected = messages.find((item) => item.id === selectedId) || null;
  const sendReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected) return; setBusy(true); setError(''); setNotice('');
    try {
      const token = sessionStorage.getItem('ap360-token') || '';
      const response = await fetch(`${API}/api/admin/contact-messages/${selected.id}/replies`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ body: reply }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Envoi de la réponse impossible.');
      setReply(''); setNotice('Réponse enregistrée et envoyée par e-mail au client.'); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Envoi de la réponse impossible.'); }
    finally { setBusy(false); }
  };
  const deleteMessage = async () => {
    if (!selected || !window.confirm(`Supprimer définitivement le message « ${selected.subject} » et son historique ?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const token = sessionStorage.getItem('ap360-token') || '';
      const response = await fetch(`${API}/api/admin/contact-messages/${selected.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Suppression impossible.');
      setNotice('Message supprimé.'); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Suppression impossible.'); }
    finally { setBusy(false); }
  };
  return <section className="admin-section admin-contact-inbox"><div className="admin-contact-heading"><div><h3>Messages reçus</h3><p>Les demandes envoyées depuis la page Contact. Vos réponses sont envoyées par e-mail au client.</p></div><button type="button" className="partner-secondary-action" onClick={() => void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Actualisation impossible.'))}>Actualiser</button></div>{error && <div className="auth-alert error">{error}</div>}{notice && <div className="auth-alert success">{notice}</div>}<div className="admin-contact-layout"><aside className="admin-contact-list">{messages.length ? messages.map((item) => <button type="button" key={item.id} className={item.id === selectedId ? 'active' : ''} onClick={() => { setSelectedId(item.id); setReply(''); setNotice(''); }}><strong>{item.subject}</strong><span>{item.fullName} · {item.email}</span><small>{new Date(item.createdAt).toLocaleString('fr-FR')} · {item.replies.length ? `${item.replies.length} réponse(s)` : 'Sans réponse'}</small></button>) : <p className="admin-empty">Aucun message reçu.</p>}</aside><div className="admin-contact-detail">{selected ? <><div className="admin-contact-detail-heading"><div><span>DE {selected.fullName} · <a href={`mailto:${selected.email}`}>{selected.email}</a></span><h4>{selected.subject}</h4><small>Reçu le {new Date(selected.createdAt).toLocaleString('fr-FR')}</small></div><button type="button" className="decline" disabled={busy} onClick={() => void deleteMessage()}>Supprimer</button></div><article className="admin-contact-message">{selected.body}</article>{selected.replies.map((item) => <article className="admin-contact-reply" key={item.id}><small>Réponse GHORBEL · {new Date(item.createdAt).toLocaleString('fr-FR')}</small><p>{item.body}</p></article>)}<form className="admin-contact-reply-form" onSubmit={(event) => void sendReply(event)}><label>Répondre au client<textarea required minLength={2} maxLength={5000} rows={5} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Rédigez votre réponse…"/></label><button className="auth-submit" disabled={busy || !reply.trim()}>{busy ? 'Envoi…' : 'Envoyer la réponse par e-mail'}</button></form></> : <div className="admin-empty">Sélectionnez un message pour le lire.</div>}</div></div></section>;
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [urlParams, setUrlParams] = useSearchParams();
  const isAdminPage = location.pathname.startsWith('/admin');
  const adminPage = isAdminPage ? (location.pathname.split('/')[2] || 'dashboard') : 'dashboard';
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(() => location.pathname.startsWith('/partner') && !['SUPPLIER', 'RESELLER'].includes(sessionStorage.getItem('ap360-role') || '') ? 'login' : null);
  const [authError, setAuthError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [signedInAs, setSignedInAs] = useState(() => sessionStorage.getItem('ap360-user') || '');
  const [signedInRole, setSignedInRole] = useState(() => sessionStorage.getItem('ap360-role') || '');
  const [partnerCompany, setPartnerCompany] = useState(() => sessionStorage.getItem('ap360-company') || '');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null);
  const [orderCenterOpen, setOrderCenterOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminAccounts, setAdminAccounts] = useState<{id:string;email:string;phone?:string|null;firstName:string;lastName:string;role:string;status:string;companyName?:string|null;createdAt:string}[]>([]);
  const [adminError, setAdminError] = useState('');
  const [adminBusy, setAdminBusy] = useState('');
  const [importFileName, setImportFileName] = useState('catalogue.csv');
  const [importCsv, setImportCsv] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [vehicleCatalogBusy, setVehicleCatalogBusy] = useState(false);
  const [vehicleCatalogError, setVehicleCatalogError] = useState('');
  const [vehicleCatalogMessage, setVehicleCatalogMessage] = useState('');
  const [importPreview, setImportPreview] = useState<{jobId:string;rowCount:number;acceptedRows:number;rejectedRows:number;previewTruncated:boolean;rows:{line:number;sku:string;name:string;make?:string;model?:string;generation?:string;yearFrom?:number;yearTo?:number;engine?:string;engineCode?:string;fuel?:string;displacementCc?:number;powerKw?:number;variant?:string;bodyStyle?:string;transmission?:string;drivetrain?:string;source?:string;sourceReference?:string;verified:boolean;errors:string[]}[]} | null>(null);
  const [importHistory, setImportHistory] = useState<{id:string;fileName:string;status:string;rowCount:number;acceptedRows:number;rejectedRows:number;createdAt:string;completedAt?:string|null}[]>([]);
  const [supplierOffers, setSupplierOffers] = useState<AdminSupplierOffer[]>([]);
  const [fitmentSources, setFitmentSources] = useState<Record<string, string>>({});
  const [partnerCreateError, setPartnerCreateError] = useState('');
  const [partnerCreateMessage, setPartnerCreateMessage] = useState('');
  const [partnerCreating, setPartnerCreating] = useState(false);
  const [makeId, setMake] = useState(() => urlParams.get('makeId') || '');
  const [modelId, setModel] = useState(() => urlParams.get('modelId') || '');
  const [generationId, setGeneration] = useState(() => urlParams.get('generationId') || '');
  const [engineId, setEngine] = useState(() => urlParams.get('engineId') || '');
  const [variantId, setVariant] = useState(() => urlParams.get('variantId') || '');
  const [year, setYear] = useState(() => urlParams.get('year') || '');
  const [reference, setReference] = useState(() => urlParams.get('q') || urlParams.get('reference') || '');
  const [category, setCategory] = useState(() => urlParams.get('category') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(urlParams.get('page')) || 1));
  const [searchMode, setSearchMode] = useState<'vehicle' | 'reference'>(() => urlParams.has('q') || urlParams.has('reference') ? 'reference' : 'vehicle');
  const [submitted, setSubmitted] = useState(true);
  const makes = useQuery({ queryKey: ['makes'], queryFn: () => getRows<Row>('/api/catalog/vehicles/makes') });
  const models = useQuery({ queryKey: ['models', makeId], queryFn: () => getRows<Row>(`/api/catalog/vehicles/models?makeId=${makeId}`), enabled: !!makeId });
  const generations = useQuery({ queryKey: ['generations', modelId], queryFn: () => getRows<Row>(`/api/catalog/vehicles/generations?modelId=${modelId}`), enabled: !!modelId });
  const engines = useQuery({ queryKey: ['engines', generationId], queryFn: () => getRows<Row>(`/api/catalog/vehicles/engines?generationId=${generationId}`), enabled: !!generationId });
  const variants = useQuery({ queryKey: ['variants', generationId, engineId], queryFn: () => getRows<Row>(`/api/catalog/vehicles/variants?generationId=${generationId}${engineId ? `&engineId=${engineId}` : ''}`), enabled: !!generationId });
  const params = new URLSearchParams();
  if (searchMode === 'vehicle') {
    if (makeId) params.set('makeId', makeId);
    if (modelId) params.set('modelId', modelId);
    if (generationId) params.set('generationId', generationId);
    if (engineId) params.set('engineId', engineId);
    if (variantId) params.set('variantId', variantId);
    if (year) params.set('year', year);
    if (reference.trim()) params.set('q', reference.trim());
  } else if (reference.trim()) params.set('q', reference.trim());
  if (category) params.set('category', category);
  if (page > 1) params.set('page', String(page));
  const results = useQuery({ queryKey: ['search', params.toString(), signedInRole, signedInAs], queryFn: async () => {
    const token = sessionStorage.getItem('ap360-token');
    const response = await fetch(`${API}/api/catalog/search?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new Error('La recherche a échoué. Vérifiez que l’API est accessible.');
    const result = await response.json();
    return { products: result.data as Product[], categories: (result.categories || []) as { name: string; count: number }[], categoryTotal: Number(result.categoryTotal ?? result.pagination.total), pagination: result.pagination as { page: number; limit: number; total: number; pages: number } };
  }, enabled: true, staleTime: 0 });
  const resultPagination = results.data?.pagination;

  useEffect(() => {
    if (isAdminPage && signedInRole === 'ADMIN') setAdminOpen(true);
    else if (!isAdminPage) setAdminOpen(false);
  }, [isAdminPage, signedInRole]);

  useEffect(() => {
    setMake(urlParams.get('makeId') || ''); setModel(urlParams.get('modelId') || ''); setGeneration(urlParams.get('generationId') || '');
    setEngine(urlParams.get('engineId') || ''); setVariant(urlParams.get('variantId') || ''); setYear(urlParams.get('year') || '');
    setReference(urlParams.get('q') || urlParams.get('reference') || ''); setCategory(urlParams.get('category') || ''); setPage(Math.max(1, Number(urlParams.get('page')) || 1));
    setSubmitted(true);
  }, [urlParams]);

  useEffect(() => {
    if (!adminOpen) return;
    const token = sessionStorage.getItem('ap360-token');
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    fetch(`${API}/api/admin/accounts`, { headers })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Impossible de charger les comptes.'); setAdminAccounts(data.data.filter((account: {role:string}) => account.role === 'SUPPLIER' || account.role === 'RESELLER')); setAdminError(''); })
      .catch((error) => setAdminError(error instanceof Error ? error.message : 'API indisponible.'));
    fetch(`${API}/api/admin/catalog/imports`, { headers })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Impossible de charger les imports.'); setImportHistory(data.data); })
      .catch((error) => setAdminError(error instanceof Error ? error.message : 'API indisponible.'));
    fetch(`${API}/api/admin/supplier-offers`, { headers })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Impossible de charger les offres partenaires.'); setSupplierOffers(data.data); })
      .catch((error) => setAdminError(error instanceof Error ? error.message : 'API indisponible.'));
  }, [adminOpen]);

  const runSearch = (event: React.FormEvent) => { event.preventDefault(); setPage(1); params.delete('page'); setUrlParams(params); setSubmitted(true); };
  const goToPage = (nextPage: number) => { setPage(nextPage); const next = new URLSearchParams(params); if (nextPage > 1) next.set('page', String(nextPage)); else next.delete('page'); setUrlParams(next); };
  const chooseCategory = (value: string) => { setCategory(value); setPage(1); const next = new URLSearchParams(params); if (value) next.set('category', value); else next.delete('category'); next.delete('page'); setUrlParams(next); setSubmitted(true); };
  const clearVehicle = () => { setModel(''); setGeneration(''); setEngine(''); setVariant(''); setYear(''); };
  const switchSearchMode = (mode: 'vehicle' | 'reference') => {
    setSearchMode(mode); setReference(''); setMake(''); clearVehicle(); setCategory(''); setPage(1); setSubmitted(true); setUrlParams(new URLSearchParams());
    if (mode === 'reference') window.setTimeout(() => document.getElementById('reference')?.focus(), 0);
  };
  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setAuthError(''); setAuthMessage(''); setAuthBusy(true);
    const fields = new FormData(event.currentTarget);
    const body: Record<string, string> = { email: String(fields.get('email') || ''), password: String(fields.get('password') || '') };
    if (authMode === 'register') { body.firstName = String(fields.get('firstName') || ''); body.lastName = String(fields.get('lastName') || ''); body.phone = String(fields.get('phone') || ''); }
    try {
      const response = await fetch(`${API}/api/auth/${authMode === 'login' ? 'login' : 'register'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Une erreur est survenue.');
      if (authMode === 'login') {
        if (location.pathname.startsWith('/partner') && !['SUPPLIER', 'RESELLER'].includes(result.user.role)) throw new Error('Cet espace est réservé aux comptes fournisseur et revendeur créés par GHORBEL.');
        sessionStorage.setItem('ap360-token', result.token); sessionStorage.setItem('ap360-user', result.user.email); sessionStorage.setItem('ap360-role', result.user.role); sessionStorage.setItem('ap360-company', result.user.companyName || ''); setSignedInAs(result.user.email); setSignedInRole(result.user.role); setPartnerCompany(result.user.companyName || ''); setAuthMessage('Connexion réussie.');
        window.setTimeout(() => { setAuthMode(null); if (result.user.role === 'ADMIN') navigate('/admin'); }, 650);
      } else if (result.data.status === 'PENDING') {
        setAuthMessage('Votre demande professionnelle a été envoyée. Un administrateur doit valider le compte avant la connexion.');
      } else {
        setAuthMode('login'); setAuthMessage('Compte créé. Vous pouvez maintenant vous connecter.');
      }
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'API indisponible.'); }
    finally { setAuthBusy(false); }
  };
  const logout = () => { sessionStorage.removeItem('ap360-token'); sessionStorage.removeItem('ap360-user'); sessionStorage.removeItem('ap360-role'); sessionStorage.removeItem('ap360-company'); setSignedInAs(''); setSignedInRole(''); setPartnerCompany(''); setAdminOpen(false); if (isAdminPage || location.pathname.startsWith('/partner')) navigate('/', { replace: true }); };
  const addToCart = (product: Product) => {
    if (!product.pricing || !product.availableQuantity) return;
    const current = cart.find((item) => item.product.id === product.id);
    if (current && current.quantity >= product.availableQuantity) return;
    setCart((items) => {
      const existing = items.find((item) => item.product.id === product.id);
      if (existing) return items.map((item) => item.product.id === product.id ? { ...item, product, quantity: Math.min(item.quantity + 1, product.availableQuantity ?? 0) } : item);
      return [...items, { product, quantity: 1 }];
    });
    window.dispatchEvent(new CustomEvent('ap360:cart-added', { detail: product.name }));
  };
  const createPartnerAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    setPartnerCreating(true); setPartnerCreateError(''); setPartnerCreateMessage('');
    const form = event.currentTarget; const fields = new FormData(form);
    const body = Object.fromEntries(['email','password','firstName','lastName','companyName','phone','role'].map((key) => [key, String(fields.get(key) || '')]));
    try {
      const response = await fetch(`${API}/api/admin/accounts`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Création du compte impossible.');
      setAdminAccounts((accounts) => [result.data, ...accounts]); setPartnerCreateMessage(`Compte créé pour ${result.data.email}. Remets-lui le mot de passe par un canal privé.`); form.reset();
    } catch (error) { setPartnerCreateError(error instanceof Error ? error.message : 'API indisponible.'); }
    finally { setPartnerCreating(false); }
  };
  const updateAccountStatus = async (id: string, status: 'ACTIVE' | 'SUSPENDED') => {
    const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    setAdminBusy(id); setAdminError('');
    try {
      const response = await fetch(`${API}/api/admin/accounts/${id}/status`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Mise à jour impossible.');
      setAdminAccounts((items) => items.filter((item) => item.id !== id));
    } catch (error) { setAdminError(error instanceof Error ? error.message : 'API indisponible.'); }
    finally { setAdminBusy(''); }
  };
  const updateSupplierOfferStatus = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    setAdminBusy(id); setAdminError('');
    try {
      const response = await fetch(`${API}/api/admin/supplier-offers/${id}/status`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Mise à jour impossible.');
      setSupplierOffers((items) => items.map((item) => item.id === id ? { ...item, status } : item));
    } catch (error) { setAdminError(error instanceof Error ? error.message : 'API indisponible.'); }
    finally { setAdminBusy(''); }
  };
  const reviewSupplierOfferPrice = async (id: string, decision: 'APPROVE' | 'REJECT') => {
    const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    setAdminBusy(id); setAdminError('');
    try {
      const response = await fetch(`${API}/api/admin/supplier-offers/${id}/pending-price`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Décision de prix impossible.');
      setSupplierOffers((items) => items.map((item) => item.id === id ? result.data : item));
    } catch (reason) { setAdminError(reason instanceof Error ? reason.message : 'API indisponible.'); }
    finally { setAdminBusy(''); }
  };
  const reviewFitmentSuggestion = async (suggestion: PartnerFitmentSuggestion, status: 'VERIFIED' | 'REJECTED') => {
    const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    const source = fitmentSources[suggestion.id]?.trim() || '';
    if (status === 'VERIFIED' && source.length < 3) { setAdminError('Indiquez une source vérifiable avant de valider cette compatibilité.'); return; }
    setAdminBusy(suggestion.id); setAdminError('');
    try {
      const response = await fetch(`${API}/api/admin/fitment-suggestions/${suggestion.id}/review`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status, ...(status === 'VERIFIED' ? { source } : {}) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Mise à jour impossible.');
      setSupplierOffers((items) => items.map((offer) => ({ ...offer, fitmentSuggestions: offer.fitmentSuggestions.map((item) => item.id === suggestion.id ? { ...item, status, source: status === 'VERIFIED' ? source : null } : item) })));
    } catch (reason) { setAdminError(reason instanceof Error ? reason.message : 'Mise à jour impossible.'); }
    finally { setAdminBusy(''); }
  };
  const refreshImportHistory = async () => {
    const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    const response = await fetch(`${API}/api/admin/catalog/imports`, { headers: { Authorization: `Bearer ${token}` } });
    const result = await response.json(); if (response.ok) setImportHistory(result.data);
  };
  const saveAdminVehicleEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    const form = event.currentTarget; const values = new FormData(form);
    const body: Record<string, string | number> = {};
    for (const key of ['makeName','modelName','generationName','vehicleCategory','engineName','engineCode','fuel','variantName','bodyStyle','transmission','drivetrain','source','sourceReference']) {
      const value = String(values.get(key) || '').trim(); if (value) body[key] = value;
    }
    for (const key of ['yearFrom','yearTo','displacementCc','powerKw']) {
      const value = String(values.get(key) || '').trim(); if (value) body[key] = Number(value);
    }
    setVehicleCatalogBusy(true); setVehicleCatalogError(''); setVehicleCatalogMessage('');
    try {
      const response = await fetch(`${API}/api/admin/catalog/vehicles`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Ajout au catalogue impossible.');
      setVehicleCatalogMessage(result.message || 'Entrée ajoutée au catalogue.'); form.reset();
    } catch (error) { setVehicleCatalogError(error instanceof Error ? error.message : 'API indisponible.'); }
    finally { setVehicleCatalogBusy(false); }
  };
  const previewCatalogImport = async () => {
    const token = sessionStorage.getItem('ap360-token');
    if (!token) { setImportError('Votre session administrateur a expiré. Reconnectez-vous puis réessayez.'); return; }
    if (!importCsv.trim()) { setImportError('Chargez un fichier CSV ou collez son contenu avant de prévisualiser.'); return; }
    if (new TextEncoder().encode(importCsv).byteLength > 2_000_000) { setImportError('Le fichier dépasse la limite de 2 Mo. Répartissez le catalogue en plusieurs imports.'); return; }
    setImportBusy(true); setImportError(''); setImportMessage(''); setImportPreview(null);
    try {
      const response = await fetch(`${API}/api/admin/catalog/imports/preview`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: importFileName, csv: importCsv }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Prévisualisation impossible.');
      setImportPreview(result.data); await refreshImportHistory();
    } catch (error) { setImportError(error instanceof Error ? error.message : 'API indisponible.'); }
    finally { setImportBusy(false); }
  };
  const commitCatalogImport = async () => {
    const token = sessionStorage.getItem('ap360-token'); if (!token || !importPreview) return;
    setImportBusy(true); setImportError(''); setImportMessage('');
    try {
      const response = await fetch(`${API}/api/admin/catalog/imports/${importPreview.jobId}/commit`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Import impossible.');
      setImportPreview(null); setImportCsv(''); await refreshImportHistory();
      setImportMessage(result.data.rejectedRows ? `${result.data.acceptedRows} ligne(s) importée(s), ${result.data.rejectedRows} rejetée(s). Consultez le rapport d’import.` : `${result.data.acceptedRows} ligne(s) importée(s).`);
    } catch (error) { setImportError(error instanceof Error ? error.message : 'API indisponible.'); }
    finally { setImportBusy(false); }
  };
  if (location.pathname === '/contact') return <ContactPage signedInAs={signedInAs}/>;
  if (location.pathname.startsWith('/products/')) return <ProductDetailPage onAddToCart={addToCart}/>;
  if (isAdminPage && signedInRole !== 'ADMIN') return <Navigate to="/" replace/>;
  if (isAdminPage && adminPage === 'messages') return <Navigate to="/admin/dashboard" replace/>;
  if ((signedInRole === 'SUPPLIER' || signedInRole === 'RESELLER') && location.pathname.startsWith('/partner')) return <PartnerDashboard email={signedInAs} company={partnerCompany} role={signedInRole} onLogout={logout}/>;
  return <div className={`app-shell${isAdminPage ? ' admin-route-shell' : ''}`}><CartToast/>
    <div className="topline"><div className="wrap topline-inner"><span>Distribution automobile B2B & B2C</span><span className="topline-right"><span>Livraison dans toute la Tunisie</span><span className="separator">·</span><a href="#contact">Besoin d’aide ?</a></span></div></div>
    <header className="header"><div className="wrap nav-row"><a className="brand" href="#top" aria-label="Ghorbel Automative Supply Group accueil"><img className="brand-logo" src="/Logo.webp" alt="Ghorbel Automative Supply Group"/></a><nav className="nav-links"><a className="active" href="#catalogue">Catalogue</a><a href="#methode">Comment commander</a><a href="#pro">Espace professionnel</a><a href="#contact">Contact</a></nav><div className="nav-actions">{signedInRole !== 'ADMIN' && <button className="login-btn cart-nav" onClick={() => setOrderCenterOpen(true)}><ShoppingCart size={16}/> Panier ({cart.reduce((count, line) => count + line.quantity, 0)})</button>}{(signedInRole === 'RESELLER' || signedInRole === 'SUPPLIER') && <button className="login-btn" onClick={() => navigate('/partner')}>Mon espace pro</button>}{signedInAs && !isAdminPage && <NotificationCenter/>}{signedInAs ? <><span className="signed-in">{signedInAs}</span>{signedInRole === 'ADMIN' && <button className="login-btn" onClick={() => { setAdminOpen(true); navigate('/admin'); }}>Administration</button>}<button className="login-btn" onClick={logout}>Déconnexion</button></> : <><button className="login-btn" onClick={() => { setAuthError(''); setAuthMessage(''); setAuthMode('login'); }}>Connexion</button><button className="account-btn" onClick={() => { setAuthError(''); setAuthMessage(''); setAuthMode('register'); }}>Créer un compte <ArrowUpRight size={15}/></button></>}<button className="mobile-menu" aria-label="Ouvrir le menu"><Menu/></button></div></div></header>
    <main id="top">
      <section className="hero hero-banner-only"><img className="hero-banner" src="/Banniere.webp" alt="Toutes les pièces pour tous vos véhicules : voitures, camions et bus · Ghorbel Automative Supply Group"/><h1 className="visually-hidden">La bonne pièce, pour le bon véhicule.</h1><div className="wrap search-wrap" id="catalogue"><div className="search-card"><div className="search-heading"><div className="search-tabs"><button type="button" className={`tab ${searchMode === 'vehicle' ? 'selected' : ''}`} onClick={() => switchSearchMode('vehicle')}><CarFront size={18}/> Par véhicule</button><button type="button" className={`tab ${searchMode === 'reference' ? 'selected' : ''}`} onClick={() => switchSearchMode('reference')}><FileSearch size={18}/> Pièce / référence</button></div><span className="search-secure"><ShieldCheck size={15}/> {makes.isLoading ? "Chargement du catalogue…" : makes.isError ? "Catalogue indisponible" : makes.data?.length ? "Référentiel véhicules · compatibilités validées par admin" : "Catalogue véhicule à initialiser"}</span></div><form onSubmit={runSearch}><div className={`filters ${searchMode === 'reference' ? 'reference-search-mode' : ''}`}><label className="field"><span>Marque</span><span className="select-wrap"><select value={makeId} disabled={!makes.data?.length} onChange={(e) => { setMake(e.target.value); clearVehicle(); }}><option value="">{makes.data?.length ? 'Toutes les marques' : 'Aucune marque vérifiée'}</option>{(makes.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={16}/></span></label><label className="field"><span>Modèle</span><span className="select-wrap"><select value={modelId} onChange={(e) => { setModel(e.target.value); setGeneration(''); setEngine(''); setVariant(''); setYear(''); }} disabled={!makeId}><option value="">Tous les modèles</option>{(models.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}{item.category ? ` · ${item.category}` : ""}</option>)}</select><ChevronDown size={16}/></span></label><label className="field"><span>Génération</span><span className="select-wrap"><select value={generationId} onChange={(e) => { setGeneration(e.target.value); setEngine(''); setVariant(''); setYear(''); }} disabled={!modelId}><option value="">Toutes</option>{(generations.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.yearFrom}–{item.yearTo ?? '…'}</option>)}</select><ChevronDown size={16}/></span></label><label className="field"><span>Motorisation</span><span className="select-wrap"><select value={engineId} onChange={(e) => { setEngine(e.target.value); setVariant(''); }} disabled={!generationId}><option value="">Toutes</option>{(engines.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}{engineLabel(item) ? ` · ${engineLabel(item)}` : ''}</option>)}</select><ChevronDown size={16}/></span></label><label className="field"><span>Version / carrosserie</span><span className="select-wrap"><select value={variantId} onChange={(e) => setVariant(e.target.value)} disabled={!generationId}><option value="">Toutes</option>{(variants.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}{item.bodyStyle ? ` · ${item.bodyStyle}` : ""}{item.transmission ? ` · ${item.transmission}` : ""}{item.drivetrain ? ` · ${item.drivetrain}` : ""}</option>)}</select><ChevronDown size={16}/></span></label><label className="field year-field"><span>Année</span><span className="select-wrap"><select value={year} onChange={(e) => setYear(e.target.value)} disabled={!generationId}><option value="">Toutes</option>{selectedGenerationYears(generations.data, generationId).map((n) => <option key={n}>{n}</option>)}</select><ChevronDown size={16}/></span></label><label className="field ref-field"><span>Recherche véhicule ou pièce libre</span><span className="input-wrap"><Search size={16}/><input id="reference" required={searchMode === 'reference'} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ex. Suspension Polo 8 2022, 123456 ou DS1"/></span></label><button className="search-button" type="submit" disabled={searchMode === 'vehicle' && !makeId && !reference.trim()}><Search size={17}/> Rechercher</button></div></form><div className="search-foot"><span><CircleHelp size={14}/>{searchMode === 'vehicle' ? (makeId ? 'Ajoutez un nom de pièce, une catégorie ou un SKU pour préciser la recherche véhicule.' : 'Saisissez une pièce et un véhicule ensemble, par exemple « suspension Polo 8 2022 », ou sélectionnez les filtres ci-dessus.') : 'Recherche libre par nom de pièce, référence, marque, modèle, génération, motorisation, carrosserie et année.'}</span><button onClick={() => { setMake(''); clearVehicle(); setReference(''); setCategory(''); setPage(1); setSubmitted(true); setUrlParams(new URLSearchParams()); }}>Effacer les filtres</button></div></div></div></section>
      <section className="results-section"><div className="wrap">{submitted ? <div className="results-panel"><div className="results-heading"><div><div className="eyebrow">CATALOGUE</div><h2>{params.size ? 'Résultats de recherche' : 'Toutes les pièces publiées'}</h2></div><span>{results.data?.pagination.total ?? 0} pièce{(results.data?.pagination.total ?? 0) > 1 ? 's' : ''}</span></div>{results.data?.categories.length ? <div className="catalog-category-browser"><aside className="catalog-category-list"><strong>Catégories</strong><button className={!category ? 'active' : ''} onClick={() => chooseCategory('')}>Toutes les pièces <span>{results.data.categoryTotal}</span></button>{results.data.categories.map((item) => <button key={item.name} className={category === item.name ? 'active' : ''} onClick={() => chooseCategory(item.name)}>{item.name}<span>{item.count}</span></button>)}</aside><div className="catalog-category-content"><div className="catalog-category-heading"><div><div className="eyebrow">{makeId || modelId || generationId ? 'PIÈCES POUR VOTRE VÉHICULE' : 'EXPLORER LE CATALOGUE'}</div><h3>Choisir une catégorie</h3></div>{category && <button className="catalog-clear-category" onClick={() => chooseCategory('')}>Toutes les catégories</button>}</div><div className="catalog-category-grid">{results.data.categories.map((item) => { const image = results.data.products.find((product) => product.category === item.name)?.images?.[0]; return <button className={`catalog-category-card${category === item.name ? ' selected' : ''}`} key={item.name} onClick={() => chooseCategory(item.name)}>{image ? <img src={imageSource(image)} alt="" loading="lazy" decoding="async"/> : <div className="catalog-category-placeholder"><PackageSearch size={30}/></div>}<strong>{item.name}</strong><span>{item.count} pièce{item.count > 1 ? 's' : ''}</span></button>; })}</div></div></div> : null}{results.isLoading ? <p className="empty-state">Recherche dans le catalogue…</p> : results.error ? <p className="empty-state error">{results.error.message}</p> : !results.data?.products.length ? <div className="empty-state"><PackageSearch size={29}/><strong>Aucune pièce trouvée pour ces critères.</strong><span>{searchMode === 'vehicle' ? 'Aucune compatibilité véhicule vérifiée ne correspond à cette sélection. Les pièces partenaires sans correspondance vérifiée restent accessibles par nom ou référence.' : 'Vérifiez le nom, la référence ou le SKU fournisseur. Les pièces apparaissent ici après validation de leur offre par l’administration.'} Essayez une autre recherche. Vous ne trouvez pas la pièce ? <a href="mailto:ghorbelautomotivesupplygroup@gmail.com?subject=Recherche%20de%20pi%C3%A8ce">Contacter notre équipe</a>.</span></div> : <div className="product-grid">{results.data.products.map((product) => <article className="product-card" key={product.id}>
  <button className="product-card-open" aria-label={`Voir ${product.name}`} onClick={() => navigate(`/products/${product.id}`, { state: { product } })}><div className="product-card-visual">{product.images?.[0] ? <img className="product-card-image" src={imageSource(product.images[0])} alt={product.name} loading="lazy" decoding="async" referrerPolicy="no-referrer"/> : <div className="product-icon"><Box size={26}/></div>}<span className="product-quick-label"><Eye size={15}/> Aperçu rapide</span></div><div className="product-meta">{product.category ?? 'Pièce automobile'}{product.pieceBrand ? ` · ${product.pieceBrand}` : ''}</div><h3>{product.name}</h3><p>{product.description || 'Découvrez les références et détails de cette pièce.'}</p></button>
  <div className="product-card-bottom"><div className="product-pricing">{product.pricing ? <strong>{Number(product.pricing.unitPriceInclTax).toFixed(3)} TND <small>TTC</small></strong> : <span>Prix de vente à définir</span>}</div><div className="availability-tag">{product.availableQuantity ? `${product.availableQuantity} disponible(s)` : ''}</div><div className="product-card-actions"><button className="product-preview-button" onClick={() => setPreviewProduct(product)}><Eye size={15}/> Aperçu</button><button className="product-details-button" onClick={() => navigate(`/products/${product.id}`, { state: { product } })}>Détails <ArrowRight size={14}/></button></div><button className="add-cart-button" disabled={!product.pricing || !product.availableQuantity} onClick={() => addToCart(product)}><ShoppingCart size={15}/> {!product.availableQuantity ? 'Indisponible' : product.pricing ? 'Ajouter au panier' : 'Prix à définir'}</button>{!product.availableQuantity && <span className="out-of-stock-tag">Rupture de stock</span>}</div>
</article>)}</div>}{resultPagination && resultPagination.pages > 1 && <nav className="catalog-pagination" aria-label="Pagination des résultats"><button disabled={page <= 1} onClick={() => goToPage(page - 1)}>Précédent</button><span>Page {resultPagination.page} sur {resultPagination.pages}</span><button disabled={page >= resultPagination.pages} onClick={() => goToPage(page + 1)}>Suivant</button></nav>}</div> : <div className="trust-strip"><div><ShieldCheck/><span><b>Compatibilité maîtrisée</b><small>Seules les compatibilités validées apparaissent dans les résultats.</small></span></div><div><Gauge/><span><b>Recherche détaillée</b><small>Marque, modèle, année, moteur et référence.</small></span></div><div><Truck/><span><b>Service local</b><small>Une distribution adaptée au marché tunisien.</small></span></div></div>}</div></section>
      <section className="pro-section" id="pro"><div className="wrap pro-page"><div className="pro-page-heading"><div className="pro-icon"><Wrench size={25}/></div><div><div className="eyebrow">POUR LES PROFESSIONNELS</div><h2>Un espace dédié aux garages et fournisseurs.</h2><p>Ghorbel Automative Supply Group vous accompagne pour diffuser vos pièces et suivre vos commandes auprès d’une clientèle professionnelle et particulière.</p></div></div><div className="pro-benefit-grid"><article><span>01</span><strong>Un catalogue centralisé</strong><p>Présentez vos références et proposez des pièces à la validation de notre équipe.</p></article><article><span>02</span><strong>Vos offres et stocks</strong><p>Gérez vos disponibilités et les mouvements de stock depuis votre espace sécurisé.</p></article><article><span>03</span><strong>Un suivi clair</strong><p>Retrouvez les commandes qui vous sont attribuées, leur statut et vos documents.</p></article></div><div className="pro-access"><div><strong>Vous êtes déjà partenaire ?</strong><small>Connectez-vous avec les identifiants transmis par Ghorbel Automative Supply Group.</small></div><div className="pro-actions">{(signedInRole === 'SUPPLIER' || signedInRole === 'RESELLER') ? <button className="pro-login" onClick={() => navigate('/partner')}>Accéder à mon tableau de bord <ArrowRight size={16}/></button> : !signedInAs ? <button className="pro-login" onClick={() => { setAuthError(""); setAuthMessage(""); setAuthMode("login"); }}>Connexion partenaire</button> : <span className="pro-session-note">{signedInRole === 'ADMIN' ? 'Votre session administration est active.' : 'Vous êtes connecté à votre espace client.'}</span>}<a href="mailto:ghorbelautomotivesupplygroup@gmail.com?subject=Demande%20de%20partenariat%20Ghorbel%20Automative%20Supply%20Group" className="pro-link">Vous souhaitez devenir partenaire ? Écrivez-nous <ArrowRight size={17}/></a></div></div></div></section>
      <section className="how-section" id="methode"><div className="wrap how-page"><div className="how-heading"><div className="eyebrow">COMMENT COMMANDER</div><h2>De la recherche à la livraison,<br/><em>en toute simplicité.</em></h2><p>Choisissez la méthode qui vous convient. Les résultats distinguent les compatibilités déclarées par les partenaires des données vérifiées.</p><a className="how-cta" href="#catalogue">Rechercher une pièce <ArrowRight size={16}/></a></div><div className="steps"><article className="step"><span>01</span><CarFront/><b>Identifiez votre pièce</b><p>Recherchez par marque, modèle, année et motorisation, ou saisissez directement un nom, une référence ou un SKU.</p></article><article className="step"><span>02</span><ShieldCheck/><b>Vérifiez les détails</b><p>Consultez la référence, les compatibilités disponibles, le prix et le stock affichés pour chaque pièce.</p></article><article className="step"><span>03</span><ShoppingCart/><b>Validez votre panier</b><p>Ajoutez les articles disponibles, renseignez vos coordonnées et choisissez votre mode de paiement.</p></article><article className="step"><span>04</span><Truck/><b>Suivez la commande</b><p>Retrouvez l’avancement dans votre compte client ou avec le lien privé envoyé à votre adresse e-mail.</p></article></div></div></section>
    </main>
    <section className="contact-section" id="contact"><div className="wrap contact-page"><div><div className="eyebrow">CONTACT</div><h2>Besoin d’aide pour trouver une pièce ?</h2><p>Notre équipe peut vous aider à vérifier une référence, compléter une recherche ou vous renseigner sur un partenariat.</p><button className="contact-primary" type="button" onClick={() => navigate('/contact')}>Écrire à notre équipe <ArrowUpRight size={16}/></button></div><div className="contact-options"><a href="mailto:ghorbelautomotivesupplygroup@gmail.com"><span>Écrivez-nous</span><strong>ghorbelautomotivesupplygroup@gmail.com</strong><small>Pour une pièce, une commande ou une question générale</small></a><a href="#pro"><span>Vous êtes professionnel ?</span><strong>Rejoindre le réseau partenaire</strong><small>Contactez-nous : les accès sont créés par notre équipe</small></a><a href="/contact"><span>Contacter GHORBEL</span><strong>Envoyer un message</strong><small>Reponse par e-mail par notre equipe</small></a><a href="#catalogue"><span>Vous cherchez une reference ?</span><strong>Lancer une recherche</strong><small>Par véhicule, nom de pièce ou référence</small></a></div></div></section><footer><div className="wrap footer-row"><a className="brand footer-brand" href="#top"><img className="brand-logo" src="/Logo.webp" alt="Ghorbel Automative Supply Group"/></a><p>© 2026 Ghorbel Automative Supply Group · Distribution de pièces automobiles en Tunisie · Crédits : Mohamed Aziz Hamdi</p><a href="/contact">Nous contacter <ArrowUpRight size={14}/></a></div></footer>
    {previewProduct && <div className="product-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewProduct(null); }}><section className="product-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="product-preview-title"><button className="product-preview-close" aria-label="Fermer l’aperçu" onClick={() => setPreviewProduct(null)}><X size={19}/></button><div className="product-preview-image">{previewProduct.images?.[0] ? <img src={imageSource(previewProduct.images[0])} alt={previewProduct.name} referrerPolicy="no-referrer"/> : <><Box size={44}/><span>Aucune photo disponible</span></>}</div><div className="product-preview-content"><div className="product-meta">{previewProduct.category || 'Pièce automobile'}{previewProduct.pieceBrand ? ` · ${previewProduct.pieceBrand}` : ''}</div><h2 id="product-preview-title">{previewProduct.name}</h2><p>{previewProduct.description || 'Aucune description renseignée.'}</p><strong className="product-preview-price">{previewProduct.pricing ? `${Number(previewProduct.pricing.unitPriceInclTax).toFixed(3)} TND TTC` : 'Prix de vente à définir'}</strong><span className="product-preview-stock">{previewProduct.availableQuantity ? `${previewProduct.availableQuantity} disponible(s)` : 'Rupture de stock'}</span><div className="product-preview-actions"><button className="product-details-button" onClick={() => { const id = previewProduct.id; setPreviewProduct(null); navigate(`/products/${id}`, { state: { product: previewProduct } }); }}>Voir la fiche complète <ArrowRight size={15}/></button>{previewProduct.pricing && (previewProduct.availableQuantity ?? 0) > 0 && <button className="add-cart-button" onClick={() => { addToCart(previewProduct); setPreviewProduct(null); }}><ShoppingCart size={15}/> Ajouter au panier</button>}</div></div></section></div>}
    {orderCenterOpen && signedInRole !== 'ADMIN' && <OrderCenter cart={cart} setCart={setCart} onClose={() => setOrderCenterOpen(false)} onLogin={() => { setOrderCenterOpen(false); setAuthError(''); setAuthMessage(''); setAuthMode('login'); }} signedIn={signedInRole === 'CUSTOMER' || signedInRole === 'RESELLER' || signedInRole === 'SUPPLIER'}/>}{authMode && <div className="auth-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthMode(null); }}><section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="auth-close" aria-label="Fermer" onClick={() => setAuthMode(null)}>×</button><div className="auth-eyebrow">GHORBEL AUTOMATIVE SUPPLY GROUP</div><h2 id="auth-title">{authMode === 'login' ? 'Connexion' : 'Créer un compte client'}</h2><p className="auth-intro">{authMode === 'login' ? 'Connectez-vous à votre espace. Les partenaires utilisent les identifiants transmis par Ghorbel Automative Supply Group.' : 'Créez un compte client pour retrouver votre espace.'}</p><form className="auth-form" onSubmit={submitAuth}>{authMode === 'register' && <div className="auth-fields"><label>Prénom<input name="firstName" required maxLength={80}/></label><label>Nom<input name="lastName" required maxLength={80}/></label><label>Téléphone<input type="tel" name="phone" required autoComplete="tel" maxLength={24} placeholder="+216 …"/></label></div>}<label>Adresse e-mail<input type="email" name="email" required autoComplete="email" maxLength={254}/></label><label>Mot de passe<input type="password" name="password" required minLength={1} maxLength={128} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}/></label>{authError && <div className="auth-alert error">{authError}</div>}{authMessage && <div className="auth-alert success">{authMessage}</div>}<button className="auth-submit" type="submit" disabled={authBusy}>{authBusy ? 'Veuillez patienter…' : authMode === 'login' ? 'Se connecter' : 'Créer mon compte'}</button></form><p className="auth-switch">{authMode === 'login' ? 'Vous êtes partenaire et vous n’avez pas reçu vos accès ?' : 'Vous avez déjà un compte ?'} <button onClick={() => { setAuthError(''); setAuthMessage(''); if (authMode === 'login') { setAuthMode(null); document.getElementById('pro')?.scrollIntoView({ behavior: 'smooth' }); } else setAuthMode('login'); }}>{authMode === 'login' ? 'Nous contacter' : 'Se connecter'}</button></p></section></div>}
    {adminOpen && <div className="auth-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isAdminPage) setAdminOpen(false); }}><section className="admin-dialog" role="main" aria-labelledby="admin-title"><button className="auth-close" aria-label={isAdminPage ? 'Retour au site' : 'Fermer'} onClick={() => { setAdminOpen(false); if (isAdminPage) navigate('/'); }}>{isAdminPage ? '← Retour au site' : '×'}</button><div className="auth-eyebrow">ADMINISTRATION</div><h2 id="admin-title">Gestion de la plateforme</h2><p className="admin-dashboard-intro">Centre de contrôle GHORBEL Ghorbel Automative Supply Group · Activité réelle issue de PostgreSQL.</p><div className="admin-topbar"><div className="admin-topbar-context"><Gauge size={16}/><span>Centre de contrôle · données PostgreSQL</span></div><div className="admin-topbar-actions"><NotificationCenter/><span className="admin-profile-name">{signedInAs}</span><button className="admin-logout" onClick={logout}>Déconnexion</button></div></div><div className="admin-workspace"><aside className="admin-sidebar"><span className="admin-sidebar-caption">ESPACE DE GESTION</span><nav className="admin-shortcuts"><a href="/admin/dashboard" className={adminPage === "dashboard" ? 'active' : ''}>Tableau de bord</a><a href="/admin/users" className={adminPage === "users" ? 'active' : ''}>Utilisateurs</a><a href="/admin/buyers" className={adminPage === "buyers" ? 'active' : ''}>Acheteurs</a><a href="/admin/partners" className={adminPage === "partners" ? 'active' : ''}>Partenaires</a><a href="/admin/offers" className={adminPage === "offers" ? 'active' : ''}>Offres à valider</a><a href="/admin/stock" className={adminPage === "stock" ? 'active' : ''}>Stocks</a><a href="/admin/pricing" className={adminPage === "pricing" ? 'active' : ''}>Prix et marges</a><a href="/admin/orders" className={adminPage === "orders" ? 'active' : ''}>Commandes</a><a href="/admin/invoices" className={adminPage === "invoices" ? 'active' : ''}>Factures fournisseurs</a><a href="/admin/catalog" className={adminPage === "catalog" ? 'active' : ''}>Catalogue et imports</a><a href="/admin/contacts" className={adminPage === "contacts" ? 'active' : ''}>Messages clients</a><a href="/admin/audit" className={adminPage === "audit" ? 'active' : ''}>Journal des actions</a><a href="/admin/settings" className={adminPage === "settings" ? 'active' : ''}>Coordonnées bancaires</a></nav></aside><div className="admin-main" data-admin-page={adminPage}>{adminPage === "dashboard" && <AdminDashboard/>}{adminPage === "contacts" && <AdminContactInbox/>}{adminPage === "settings" && <AdminCompanyPaymentSettings/>}{adminPage === "partners" && <><div className="admin-section" id="admin-partners"><h3>Créer un compte partenaire</h3><p className="auth-intro">Les fournisseurs et revendeurs n’ouvrent pas eux-mêmes de compte. Créez leurs accès ici après avoir convenu du partenariat.</p><form className="partner-create-form" onSubmit={createPartnerAccount}><div className="partner-create-grid"><label>Type de partenaire<select name="role" defaultValue="SUPPLIER"><option value="SUPPLIER">Fournisseur</option><option value="RESELLER">Revendeur / garage</option></select></label><label>Entreprise<input name="companyName" required maxLength={160}/></label><label>Prénom<input name="firstName" required maxLength={80}/></label><label>Nom<input name="lastName" required maxLength={80}/></label><label>Téléphone<input name="phone" type="tel" required maxLength={24} placeholder="+216 …"/></label><label>E-mail de connexion<input name="email" type="email" required maxLength={254}/></label><label>Mot de passe initial<input name="password" type="password" required maxLength={128}/></label></div>{partnerCreateError && <div className="auth-alert error">{partnerCreateError}</div>}{partnerCreateMessage && <div className="auth-alert success">{partnerCreateMessage}</div>}<button className="auth-submit" disabled={partnerCreating}>{partnerCreating ? 'Création…' : 'Créer le compte et activer l’accès'}</button></form></div><div className="admin-section" id="admin-partners-list"><h3>Comptes partenaires</h3><p className="auth-intro">Créez leurs accès, suspendez ou réactivez les comptes partenaires.</p>{adminError && <div className={`auth-alert ${adminError.includes('importée') ? 'success' : 'error'}`}>{adminError}</div>}{adminAccounts.length === 0 ? <div className="admin-empty">Aucune demande en attente.</div> : <div className="admin-list">{adminAccounts.map((account) => <article className="admin-account" key={account.id}><div><strong>{account.companyName || `${account.firstName} ${account.lastName}`}</strong><span>{account.email} · {account.phone || 'Sans téléphone'} · {account.role === 'SUPPLIER' ? 'Fournisseur' : 'Revendeur'}</span><small>Reçue le {new Date(account.createdAt).toLocaleDateString('fr-FR')}</small></div><div className="admin-actions">{account.status === 'ACTIVE' ? <button className="decline" disabled={adminBusy === account.id} onClick={() => updateAccountStatus(account.id, 'SUSPENDED')}>Suspendre</button> : <button disabled={adminBusy === account.id} onClick={() => updateAccountStatus(account.id, 'ACTIVE')}>Activer</button>}</div></article>)}</div>}</div></>}{adminPage === "users" && <AdminUsers/>}{adminPage === "buyers" && <AdminUsers buyerOnly/>}{adminPage === "offers" && <div className="admin-section" id="admin-offers"><h3>Offres partenaires à traiter</h3><p className="auth-intro">Les coûts d’achat restent réservés à l’administration et au partenaire concerné.</p>{supplierOffers.filter((offer) => offer.status === 'PENDING' || offer.pendingPurchasePrice != null || offer.fitmentSuggestions.some((item) => item.status === 'PENDING')).length === 0 ? <div className="admin-empty">Aucune offre en attente.</div> : <div className="admin-list">{supplierOffers.filter((offer) => offer.status === 'PENDING' || offer.pendingPurchasePrice != null || offer.fitmentSuggestions.some((item) => item.status === 'PENDING')).map((offer) => <article className="admin-account" key={offer.id}><div><strong>{offer.product.name}</strong><span>{offer.supplier.companyName || offer.supplier.email} · {offer.supplierSku}{offer.product.references[0] ? ` · ${offer.product.references[0].value}` : ''}</span><small>{Number(offer.purchasePrice).toFixed(3)} TND · TVA fournisseur {Number(offer.purchaseVatRate).toFixed(2)}%</small>{offer.fitmentSuggestions.map((suggestion) => <div className="fitment-review" key={suggestion.id}><strong>{fitmentSuggestionLabel(suggestion)}</strong>{suggestion.status === 'PENDING' ? <div><input aria-label="Source de vérification de compatibilité" placeholder="Source vérifiable (catalogue, document…)" value={fitmentSources[suggestion.id] || ''} onChange={(event) => setFitmentSources((values) => ({ ...values, [suggestion.id]: event.target.value }))}/><button disabled={adminBusy === suggestion.id || offer.status !== 'APPROVED'} onClick={() => void reviewFitmentSuggestion(suggestion, 'VERIFIED')}>Valider la compatibilité</button><button className="decline" disabled={adminBusy === suggestion.id} onClick={() => void reviewFitmentSuggestion(suggestion, 'REJECTED')}>Refuser</button>{offer.status !== 'APPROVED' && <small>Approuvez d’abord l’offre pour valider la compatibilité.</small>}</div> : <small>{suggestion.status === 'VERIFIED' ? `Compatibilité vérifiée · ${suggestion.source || 'source enregistrée'}` : 'Compatibilité refusée'}</small>}</div>)}</div><div className="admin-actions">{offer.pendingPurchasePrice != null && <><button disabled={adminBusy === offer.id} onClick={() => void reviewSupplierOfferPrice(offer.id, 'APPROVE')}>Approuver la hausse · {Number(offer.pendingPurchasePrice).toFixed(3)} TND</button><button className="decline" disabled={adminBusy === offer.id} onClick={() => void reviewSupplierOfferPrice(offer.id, 'REJECT')}>Refuser la hausse</button></>}{offer.status === 'PENDING' && <><button disabled={adminBusy === offer.id} onClick={() => updateSupplierOfferStatus(offer.id, 'APPROVED')}>Approuver l’offre</button><button className="decline" disabled={adminBusy === offer.id} onClick={() => updateSupplierOfferStatus(offer.id, 'REJECTED')}>Refuser l’offre</button></>}</div></article>)}</div>}</div>}{adminPage === "stock" && <StockManagement/>}{adminPage === "pricing" && <PricingManagement/>}{adminPage === "orders" && <AdminOrderManagement/>}{adminPage === "invoices" && <AdminSupplierInvoices/>}{adminPage === "audit" && <AdminAuditLogs/>}{adminPage === "catalog" && <><AdminProductCatalog/><div className="admin-section" id="admin-vehicle-entry"><h3>Ajouter un véhicule au référentiel</h3><p className="auth-intro">Ajoutez une marque, un modèle, une génération et sa plage d’années, puis complétez si possible la motorisation et la version. L’entrée sera disponible dans la recherche client.</p><form className="partner-create-form" onSubmit={saveAdminVehicleEntry}><div className="partner-create-grid"><label>Marque<input name="makeName" required maxLength={100} placeholder="Volkswagen"/></label><label>Modèle<input name="modelName" required maxLength={100} placeholder="Polo"/></label><label>Type de véhicule<select name="vehicleCategory" defaultValue="Voiture particulière"><option>Voiture particulière</option><option>Utilitaire léger</option><option>Pick-up</option><option>Camion</option><option>Bus / Autocar</option><option>Motocycle</option><option>Autre</option></select></label><label>Génération<input name="generationName" required maxLength={120} placeholder="Polo VIII"/></label><label>Année de début<input name="yearFrom" type="number" min="1900" max="2100" required/></label><label>Année de fin<input name="yearTo" type="number" min="1900" max="2100"/></label><label>Motorisation<input name="engineName" maxLength={120} placeholder="1.0 TSI"/></label><label>Code moteur<input name="engineCode" maxLength={80}/></label><label>Carburant<input name="fuel" maxLength={40} placeholder="Essence, diesel, électrique…"/></label><label>Cylindrée (cm³)<input name="displacementCc" type="number" min="50" max="30000"/></label><label>Puissance (kW)<input name="powerKw" type="number" min="1" max="5000"/></label><label>Version<input name="variantName" maxLength={120} placeholder="Life, GTI…"/></label><label>Carrosserie<input name="bodyStyle" maxLength={80} placeholder="Hayon, berline, tracteur…"/></label><label>Transmission<input name="transmission" maxLength={80}/></label><label>Motricité (traction, propulsion, 4x4)<input name="drivetrain" maxLength={80}/></label><label>Source (facultative)<input name="source" maxLength={240} placeholder="Catalogue constructeur"/></label><label>Référence de source<input name="sourceReference" maxLength={500}/></label></div>{vehicleCatalogError && <div className="auth-alert error">{vehicleCatalogError}</div>}{vehicleCatalogMessage && <div className="auth-alert success">{vehicleCatalogMessage}</div>}<button className="auth-submit" disabled={vehicleCatalogBusy}>{vehicleCatalogBusy ? 'Ajout…' : 'Ajouter au référentiel'}</button></form></div><VehicleCatalogReview onReviewed={() => { void makes.refetch(); }}/><VehicleCatalogImporter onImported={() => { void makes.refetch(); void refreshImportHistory(); }}/><div className="admin-section" id="admin-import"><h3>Importer le catalogue CSV</h3><p className="auth-intro">Prévisualisez les lignes avant l’import. Les données véhicule ne seront publiées comme vérifiées que si verified vaut true et qu’une source est indiquée. Un même SKU peut apparaître sur plusieurs lignes pour ses références et compatibilités, avec le même nom de pièce.</p><div className="import-toolbar"><a href="/catalog-import-template.csv" download>Télécharger le modèle CSV</a><a href="/catalog-import-guide.txt" download>Guide de remplissage</a><label className="import-file">Choisir un fichier<input type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setImportPreview(null); if (file.size > 2_000_000) { setImportError('Le fichier dépasse la limite de 2 Mo. Répartissez le catalogue en plusieurs imports.'); return; } setImportError(''); setImportMessage(''); setImportFileName(file.name); void file.text().then((content) => { setImportCsv(content); setImportError(''); }).catch(() => setImportError('Lecture du fichier CSV impossible.')); } }}/></label></div><textarea className="import-editor" value={importCsv} onChange={(event) => { setImportCsv(event.target.value); setImportPreview(null); setImportError(''); setImportMessage(''); }} placeholder="Chargez un CSV ou collez son contenu ici…" spellCheck={false}/>{importError && <div className="auth-alert error">{importError}</div>}{importMessage && <div className="auth-alert success">{importMessage}</div>}<div className="import-footer"><span>{importFileName} · jusqu’à 2 Mo et 2 000 lignes · une référence ou compatibilité par ligne</span><button type="button" className="auth-submit import-preview-button" disabled={importBusy || !importCsv.trim()} onClick={() => void previewCatalogImport()}>{importBusy ? 'Traitement…' : 'Prévisualiser'}</button></div>{importPreview && <div className="import-preview"><div className="import-summary">{importPreview.acceptedRows} valide(s) · {importPreview.rejectedRows} avec erreur(s)</div><div className="import-preview-rows">{importPreview.rows.slice(0, 50).map((row) => <div className={`import-preview-row ${row.errors.length ? 'invalid' : ''}`} key={`${row.line}-${row.sku}`}><b>L{row.line}</b><span>{row.sku} · {row.name}</span><small>{row.errors.length ? row.errors.join(' ') : ([row.make, row.model, row.generation, row.yearFrom && (row.yearFrom + '–' + (row.yearTo || '…')), row.engineCode || row.engine, row.fuel, row.displacementCc && (row.displacementCc + ' cm³'), row.powerKw && (row.powerKw + ' kW'), row.variant, row.bodyStyle, row.transmission, row.drivetrain, row.source && 'Source : ' + row.source, row.sourceReference].filter(Boolean).join(' · ') || 'Pièce seule') + (row.verified ? ' · Vérifié' : ' · Démonstration')}</small></div>)}</div>{importPreview.previewTruncated && <small>Aperçu limité aux 50 premières lignes sur {importPreview.rowCount}.</small>}<button className="auth-submit import-confirm-button" disabled={importBusy || importPreview.acceptedRows === 0} onClick={commitCatalogImport}>{importBusy ? 'Import en cours…' : `Confirmer l’import de ${importPreview.acceptedRows} ligne(s)`}</button></div>}</div><div className="admin-section" id="admin-history"><h3>Historique des imports</h3>{importHistory.length === 0 ? <div className="admin-empty">Aucun import pour le moment.</div> : <div className="import-history">{importHistory.map((job) => <div className="import-history-row" key={job.id}><span>{job.fileName}</span><small>{new Date(job.createdAt).toLocaleString('fr-FR')}</small><b>{job.acceptedRows}/{job.rowCount} · {job.status === 'COMPLETED' ? 'Terminé' : 'Prévisualisé'}</b></div>)}</div>}</div></>}</div></div></section></div>}
  </div>;
}

type FitmentDraft = { key: string; mode: 'catalog' | 'manual'; makeId: string; modelId: string; generationId: string; engineId: string; variantId: string; year: string; makeName: string; modelName: string; generationName: string; vehicleCategory: string; yearFrom: string; yearTo: string; engineName: string; engineCode: string; fuel: string; displacementCc: string; powerKw: string; variantName: string; bodyStyle: string; transmission: string; drivetrain: string };
const newFitmentDraft = (): FitmentDraft => ({ key: crypto.randomUUID(), mode: 'catalog', makeId: '', modelId: '', generationId: '', engineId: '', variantId: '', year: '', makeName: '', modelName: '', generationName: '', vehicleCategory: 'Voiture particulière', yearFrom: '', yearTo: '', engineName: '', engineCode: '', fuel: '', displacementCc: '', powerKw: '', variantName: '', bodyStyle: '', transmission: '', drivetrain: '' });
function PartnerFitmentEditor({ value, onChange }: { value: FitmentDraft[]; onChange: (value: FitmentDraft[]) => void }) {
  const makes = useQuery({ queryKey: ['partner-fitment-makes'], queryFn: () => getRows<Row>('/api/catalog/vehicles/makes') });
  const models = useQueries({ queries: value.map((row) => ({ queryKey: ['partner-fitment-models', row.makeId], queryFn: () => getRows<Row>(`/api/catalog/vehicles/models?makeId=${row.makeId}`), enabled: !!row.makeId })) });
  const generations = useQueries({ queries: value.map((row) => ({ queryKey: ['partner-fitment-generations', row.modelId], queryFn: () => getRows<Row>(`/api/catalog/vehicles/generations?modelId=${row.modelId}`), enabled: !!row.modelId })) });
  const engines = useQueries({ queries: value.map((row) => ({ queryKey: ['partner-fitment-engines', row.generationId], queryFn: () => getRows<Row>(`/api/catalog/vehicles/engines?generationId=${row.generationId}`), enabled: !!row.generationId })) });
  const variants = useQueries({ queries: value.map((row) => ({ queryKey: ['partner-fitment-variants', row.generationId, row.engineId], queryFn: () => getRows<Row>(`/api/catalog/vehicles/variants?generationId=${row.generationId}${row.engineId ? `&engineId=${row.engineId}` : ''}`), enabled: !!row.generationId })) });
  const update = (index: number, patch: Partial<FitmentDraft>) => onChange(value.map((row, i) => i === index ? { ...row, ...patch } : row));
  return <fieldset className="partner-fitment"><legend>Compatibilités véhicule · plusieurs marques possibles</legend><p>Ajoutez une ligne par combinaison applicable. Vous pouvez saisir et modifier librement les compatibilités; elles sont utilisées dès que l’offre est approuvée.</p>{makes.isError ? <p>Impossible de charger les véhicules du catalogue.</p> : !makes.data?.length && value.every((row) => row.mode === 'catalog') ? <p>Le catalogue est momentanément indisponible. Vous pouvez quand même saisir vos compatibilités manuellement.</p> : <>
    {value.map((row, index) => <div className="partner-fitment-row" key={row.key}><div className="partner-fitment-grid">
      <div className="partner-fitment-mode"><button type="button" className={row.mode === 'catalog' ? 'selected' : ''} onClick={() => update(index, { mode: 'catalog' })}>Choisir au catalogue</button><button type="button" className={row.mode === 'manual' ? 'selected' : ''} onClick={() => update(index, { mode: 'manual' })}>Saisie manuelle</button></div>
      {row.mode === 'manual' ? <>
        <label>Marque<input value={row.makeName} maxLength={100} placeholder="Volkswagen, Skoda, SEAT…" onChange={(event) => update(index, { makeName: event.target.value })}/></label>
        <label>Modèle<input value={row.modelName} maxLength={100} placeholder="Golf, Octavia, Leon…" onChange={(event) => update(index, { modelName: event.target.value })}/></label>
        <label>Catégorie véhicule<select value={row.vehicleCategory} onChange={(event) => update(index, { vehicleCategory: event.target.value })}><option>Voiture particulière</option><option>Utilitaire léger</option><option>Pick-up</option><option>Camion</option><option>Bus / Autocar</option></select></label>
        <label>Génération<input value={row.generationName} maxLength={120} placeholder="Golf VII, 5G1…" onChange={(event) => update(index, { generationName: event.target.value })}/></label>
        <label>Année début<input type="number" min="1900" max="2100" value={row.yearFrom} onChange={(event) => update(index, { yearFrom: event.target.value })}/></label>
        <label>Année fin<input type="number" min="1900" max="2100" value={row.yearTo} placeholder={row.yearFrom || 'Identique au début'} onChange={(event) => update(index, { yearTo: event.target.value })}/></label>
        <label>Motorisation<input value={row.engineName} maxLength={120} placeholder="1.6 TDI 105 ch" onChange={(event) => update(index, { engineName: event.target.value })}/></label>
        <label>Code moteur<input value={row.engineCode} maxLength={80} placeholder="CAYC" onChange={(event) => update(index, { engineCode: event.target.value })}/></label>
        <label>Carburant<input value={row.fuel} maxLength={40} placeholder="Diesel, essence…" onChange={(event) => update(index, { fuel: event.target.value })}/></label>
        <label>Cylindrée (cm³)<input type="number" min="50" max="30000" value={row.displacementCc} onChange={(event) => update(index, { displacementCc: event.target.value })}/></label>
        <label>Puissance (kW)<input type="number" min="1" max="5000" value={row.powerKw} onChange={(event) => update(index, { powerKw: event.target.value })}/></label>
        <label>Version / finition<input value={row.variantName} maxLength={120} placeholder="Trendline, GTI…" onChange={(event) => update(index, { variantName: event.target.value })}/></label>
        <label>Carrosserie<input value={row.bodyStyle} maxLength={80} placeholder="Berline, break…" onChange={(event) => update(index, { bodyStyle: event.target.value })}/></label>
        <label>Transmission<input value={row.transmission} maxLength={80} placeholder="Manuelle, DSG…" onChange={(event) => update(index, { transmission: event.target.value })}/></label>
      </> : <>
      <label>Marque<select value={row.makeId} onChange={(event) => update(index, { makeId: event.target.value, modelId: '', generationId: '', engineId: '', variantId: '', year: '' })}><option value="">Choisir une marque</option>{makes.data!.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Modèle<select value={row.modelId} disabled={!row.makeId} onChange={(event) => update(index, { modelId: event.target.value, generationId: '', engineId: '', variantId: '', year: '' })}><option value="">Choisir un modèle</option>{(models[index]?.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}{item.category ? ` · ${item.category}` : ""}</option>)}</select></label>
      <label>Génération<select value={row.generationId} disabled={!row.modelId} onChange={(event) => update(index, { generationId: event.target.value, engineId: '', variantId: '', year: '' })}><option value="">{!row.modelId ? 'Choisir un modèle avant' : generations[index]?.isLoading ? 'Chargement…' : generations[index]?.data?.length ? 'Choisir une génération' : 'Aucune génération préconfigurée'}</option>{(generations[index]?.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.yearFrom}–{item.yearTo ?? '…'}</option>)}</select></label>
      <label>Motorisation<select value={row.engineId} disabled={!row.generationId} onChange={(event) => update(index, { engineId: event.target.value, variantId: '' })}><option value="">{!row.generationId ? 'Choisir une génération avant' : engines[index]?.isLoading ? 'Chargement…' : engines[index]?.data?.length ? 'Toutes' : 'Aucune motorisation préconfigurée'}</option>{(engines[index]?.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}{engineLabel(item) ? ' · ' + engineLabel(item) : ''}</option>)}</select></label>
      <label>Version / carrosserie<select value={row.variantId} disabled={!row.generationId} onChange={(event) => update(index, { variantId: event.target.value })}><option value="">{!row.generationId ? 'Choisir une génération avant' : variants[index]?.isLoading ? 'Chargement…' : variants[index]?.data?.length ? 'Toutes' : 'Aucune version préconfigurée'}</option>{(variants[index]?.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}{item.bodyStyle ? ' · ' + item.bodyStyle : ''}{item.transmission ? ' · ' + item.transmission : ''}</option>)}</select></label>
      <label>Année début<select value={row.year} disabled={!row.generationId} onChange={(event) => update(index, { year: event.target.value, yearTo: '' })}><option value="">{row.generationId ? 'Choisir une année' : 'Choisir une génération avant'}</option>{selectedGenerationYears(generations[index]?.data, row.generationId).map((year) => <option value={year} key={year}>{year}</option>)}</select></label>
      {row.modelId && !generations[index]?.isLoading && !generations[index]?.data?.length && <p className="partner-fitment-empty-hint">Aucune génération, année ou motorisation n’est encore enregistrée pour ce modèle. Utilisez « Saisie manuelle » pour proposer ces données; elles seront ajoutées au catalogue après validation.</p>}
      <label>Année fin (facultative)<input type="number" min={row.year || 1900} max="2100" value={row.yearTo} placeholder="Même année" disabled={!row.year} onChange={(event) => update(index, { yearTo: event.target.value })}/></label>
      </>}
    </div><button type="button" className="partner-remove-fitment" onClick={() => onChange(value.filter((_, i) => i !== index))}>Retirer cette compatibilité</button></div>)}
    <button type="button" className="partner-secondary-action" onClick={() => onChange([...value, newFitmentDraft()])}>＋ Ajouter une autre marque / compatibilité</button>
  </>}</fieldset>;
}

type PartnerOffer = { id:string;supplierSku:string;purchasePrice:string|number;pendingPurchasePrice?:string|number|null;purchaseVatRate:string|number;status:string;archivedAt?:string|null;product:{name:string;description?:string|null;category?:string|null;pieceBrand?:string|null;images?:string[];references:{value:string;type:string}[];compatibilities?:{generationId:string;engineId?:string|null;variantId?:string|null;yearFrom:number;yearTo:number|null;generation:{id:string;name:string;model:{id:string;name:string;category?:string|null;make:{id:string;name:string}}};engine?:{id:string;name:string;engineCode?:string|null;fuel?:string|null;displacementCc?:number|null;powerKw?:number|null}|null;variant?:{id:string;name:string;bodyStyle?:string|null;transmission?:string|null;drivetrain?:string|null}|null}[]};fitmentSuggestions?:PartnerFitmentSuggestion[] };
type PartnerDashboardSummary = { offers: { total: number; pending: number; approved: number; rejected: number; archived: number }; stock: { outOfStock: number; lowStock: number }; orders: { count: number; confirmedPurchaseTotal: string }; pendingInvoices: number; recentActivity: { id: string; label: string; createdAt: string }[] };
type SupplierPriceHistoryEvent = { id: string; action: string; previousPurchasePrice: string | null; effectivePurchasePrice: string | null; requestedPurchasePrice: string | null; pendingApproval: boolean; createdAt: string };
function SupplierPriceHistoryPanel({ offers }: { offers: PartnerOffer[] }) {
  const [offerId, setOfferId] = useState(''); const [events, setEvents] = useState<SupplierPriceHistoryEvent[] | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const load = async () => { if (!offerId) return; setBusy(true); setError(''); setEvents(null); try { const token = sessionStorage.getItem('ap360-token') || ''; const response = await fetch(`${API}/api/partner/offers/${offerId}/price-history`, { headers: { Authorization: `Bearer ${token}` } }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Historique indisponible.'); setEvents(result.data); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Historique indisponible.'); } finally { setBusy(false); } };
  return <details className="supplier-price-history"><summary>Historique des prix fournisseur</summary><div className="supplier-price-history-tools"><label>Pièce<select value={offerId} onChange={(event) => { setOfferId(event.target.value); setEvents(null); }}><option value="">Choisir une pièce</option>{offers.map((offer) => <option key={offer.id} value={offer.id}>{offer.product.name} · {offer.supplierSku}</option>)}</select></label><button type="button" className="partner-secondary-action" disabled={!offerId || busy} onClick={() => void load()}>{busy ? 'Chargement…' : 'Afficher'}</button></div>{error && <div className="auth-alert error">{error}</div>}{events && (events.length ? <div className="supplier-price-history-list">{events.map((event) => <article key={event.id}><span>{new Date(event.createdAt).toLocaleString('fr-FR')}</span><strong>{event.previousPurchasePrice ?? '—'} → {event.effectivePurchasePrice ?? '—'} TND HT</strong>{event.pendingApproval && event.requestedPurchasePrice && <small>Prix demandé : {event.requestedPurchasePrice} TND HT · en attente de validation</small>}{event.action === 'SUPPLIER_PRICE_INCREASE_APPROVED' && <small>Hausse approuvée par GHORBEL</small>}{event.action === 'SUPPLIER_PRICE_INCREASE_REJECTED' && <small>Hausse refusée par GHORBEL</small>}</article>)}</div> : <p className="supplier-price-history-empty">Aucun changement de prix enregistré pour cette pièce.</p>)}</details>;
}
const makeEditFitmentDrafts = (offer: PartnerOffer): FitmentDraft[] => {
  const live = offer.product.compatibilities ?? [];
  const drafts: FitmentDraft[] = live.map((item) => ({ ...newFitmentDraft(), mode: 'catalog', makeId: item.generation.model.make.id, modelId: item.generation.model.id, generationId: item.generationId, engineId: item.engineId || '', variantId: item.variantId || '', year: String(item.yearFrom), yearTo: item.yearTo && item.yearTo !== item.yearFrom ? String(item.yearTo) : '', makeName: item.generation.model.make.name, modelName: item.generation.model.name, generationName: item.generation.name, vehicleCategory: item.generation.model.category || 'Voiture particulière', engineName: item.engine?.name || '', engineCode: item.engine?.engineCode || '', fuel: item.engine?.fuel || '', displacementCc: item.engine?.displacementCc ? String(item.engine.displacementCc) : '', powerKw: item.engine?.powerKw ? String(item.engine.powerKw) : '', variantName: item.variant?.name || '', bodyStyle: item.variant?.bodyStyle || '', transmission: item.variant?.transmission || '', drivetrain: item.variant?.drivetrain || '' }));
  for (const item of offer.fitmentSuggestions ?? []) {
    if (live.some((compatibility) => compatibility.generationId === item.generationId && (compatibility.engineId || null) === (item.engineId || null) && compatibility.yearFrom === item.year && (compatibility.yearTo ?? compatibility.yearFrom) === (item.yearTo ?? item.year))) continue;
    drafts.push({ ...newFitmentDraft(), mode: item.generationId ? 'catalog' : 'manual', makeId: item.generation?.model.make.id || '', modelId: item.generation?.model.id || '', generationId: item.generationId || '', engineId: item.engineId || '', variantId: item.variantId || '', year: item.generationId ? String(item.year) : '', yearTo: item.yearTo && item.yearTo !== item.year ? String(item.yearTo) : '', makeName: item.makeName || item.generation?.model.make.name || '', modelName: item.modelName || item.generation?.model.name || '', generationName: item.generationName || item.generation?.name || '', vehicleCategory: item.vehicleCategory || item.generation?.model.category || 'Voiture particulière', yearFrom: item.generationId ? '' : String(item.year), engineName: item.engineName || item.engine?.name || '', engineCode: item.engineCode || item.engine?.engineCode || '', fuel: item.fuel || item.engine?.fuel || '', displacementCc: item.displacementCc ? String(item.displacementCc) : '', powerKw: item.powerKw ? String(item.powerKw) : '', variantName: item.variantName || item.variant?.name || '', bodyStyle: item.bodyStyle || item.variant?.bodyStyle || '', transmission: item.transmission || item.variant?.transmission || '', drivetrain: item.drivetrain || '' });
  }
  return drafts;
};
function PartnerPhotoUpload({ value, onChange, onUploading, endpoint = '/api/partner/uploads/images' }: { value: string[]; onChange: (value: string[]) => void; onUploading?: (busy: boolean) => void; endpoint?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [urlDraft, setUrlDraft] = useState('');
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError('');
    if (value.length + files.length > 8) { setError('Maximum 8 photos par pièce.'); return; }
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    for (const file of Array.from(files)) {
      if (!allowed.includes(file.type)) { setError(`${file.name} : format autorisé JPEG, PNG ou WebP.`); return; }
      if (file.size > 5 * 1024 * 1024) { setError(`${file.name} dépasse la limite de 5 Mo.`); return; }
    }
    const token = sessionStorage.getItem('ap360-token'); if (!token) { setError('Session expirée.'); return; }
    setBusy(true); onUploading?.(true);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        const response = await fetch(`${API}${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type }, body: file });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || `Échec de l’envoi de ${file.name}.`);
        uploaded.push(result.data.url as string);
      }
      onChange([...value, ...uploaded]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Envoi impossible.'); }
    finally { setBusy(false); onUploading?.(false); }
  };
  const addUrl = () => {
    const url = urlDraft.trim();
    if (!url) return;
    if (value.length >= 8) { setError('Maximum 8 photos par pièce.'); return; }
    try { if (new URL(url).protocol !== 'https:') throw new Error(); } catch { setError('L’URL photo doit être valide et commencer par HTTPS.'); return; }
    setError(''); onChange([...value, url]); setUrlDraft('');
  };
  return <div className="partner-photo-upload"><strong>Photos du produit</strong><label className="partner-photo-picker">{busy ? 'Envoi des photos…' : '＋ Choisir des photos'}<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || value.length >= 8} onChange={(event) => { void upload(event.target.files); event.currentTarget.value = ''; }}/></label><small>Upload JPEG, PNG ou WebP · 5 Mo maximum par image · jusqu’à 8 photos</small><div className="partner-photo-url"><input aria-label="URL HTTPS de photo" type="url" placeholder="Ou coller une URL HTTPS" value={urlDraft} onChange={(event) => setUrlDraft(event.target.value)}/><button type="button" onClick={addUrl}>Ajouter le lien</button></div>{error && <small className="partner-photo-error">{error}</small>}{value.length > 0 && <div className="partner-photo-thumbs">{value.map((url, index) => <div key={`${url}-${index}`}><img src={imageSource(url)} alt={`Photo ${index + 1}`}/><button type="button" aria-label={`Retirer la photo ${index + 1}`} onClick={() => onChange(value.filter((_, photoIndex) => photoIndex !== index))}>×</button></div>)}</div>}</div>;
}
function PartnerDashboard({ email, company, role, onLogout }: { email: string; company: string; role: string; onLogout: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const partnerPage = location.pathname.split("/")[2] || "dashboard";
  const [offers, setOffers] = useState<PartnerOffer[]>([]);
  const [editingOffer, setEditingOffer] = useState<PartnerOffer | null>(null);
  const [newOfferImages, setNewOfferImages] = useState<string[]>([]);
  const [editOfferImages, setEditOfferImages] = useState<string[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [offerFilter, setOfferFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'ARCHIVED'>('ALL');
  const [offerSearch, setOfferSearch] = useState('');
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [fitments, setFitments] = useState<FitmentDraft[]>([]);
  const [editFitments, setEditFitments] = useState<FitmentDraft[]>([]);
  const [inventory, setInventory] = useState<PartnerInventoryData>({ warehouses: [], items: [], movements: [] });
  const [inventoryError, setInventoryError] = useState('');
  const [inventoryMessage, setInventoryMessage] = useState('');
  const [inventoryBusy, setInventoryBusy] = useState(false);
  const [selectedStockIds, setSelectedStockIds] = useState<string[]>([]);
  const [bulkAvailableQuantity, setBulkAvailableQuantity] = useState('');
  const [supplierImportCsv, setSupplierImportCsv] = useState('');
  const [supplierImportFileName, setSupplierImportFileName] = useState('');
  const [supplierImportPreview, setSupplierImportPreview] = useState<{ rowCount: number; acceptedRows: number; rejectedRows: number; importedRows?: number; createdRows?: number; updatedRows?: number; rows: { line: number; supplierSku: string; name: string; errors: string[]; action?: 'CREATE' | 'UPDATE' }[] } | null>(null);
  const [supplierImportBusy, setSupplierImportBusy] = useState(false);
  const [supplierImportError, setSupplierImportError] = useState('');
  const [supplierImportMessage, setSupplierImportMessage] = useState('');
  const [catalogExportBusy, setCatalogExportBusy] = useState(false);
  const [dashboardSummary, setDashboardSummary] = useState<PartnerDashboardSummary | null>(null);
  const [dashboardError, setDashboardError] = useState('');
  const [legalProfileStatus, setLegalProfileStatus] = useState<string | null>(null);
  useEffect(() => {
    const loadLegalStatus = async () => {
      const token = sessionStorage.getItem('ap360-token'); if (!token) return;
      try { const response = await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }); const result = await response.json(); if (response.ok) setLegalProfileStatus(result.data.legalProfileStatus || 'PENDING'); } catch { /* Keep the legal task hidden until the account status can be loaded. */ }
    };
    void loadLegalStatus();
    window.addEventListener('focus', loadLegalStatus);
    return () => window.removeEventListener('focus', loadLegalStatus);
  }, []);
  const loadDashboardSummary = async () => {
    const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    try { const response = await fetch(`${API}/api/partner/dashboard`, { headers: { Authorization: `Bearer ${token}` } }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Chargement du tableau de bord impossible.'); setDashboardSummary(result.data); setDashboardError(''); }
    catch (reason) { setDashboardError(reason instanceof Error ? reason.message : 'Chargement du tableau de bord impossible.'); }
  };
  const exportSupplierCatalog = async () => {
    const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    setCatalogExportBusy(true); setError('');
    try { const response = await fetch(`${API}/api/partner/offers/export.csv`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'Export du catalogue impossible.'); } const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `catalogue-fournisseur-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); void loadDashboardSummary(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Export du catalogue impossible.'); }
    finally { setCatalogExportBusy(false); }
  };
  const toggleOfferArchive = async (offer: PartnerOffer) => {
    const archived = !offer.archivedAt;
    const verb = archived ? 'retirer cette offre du catalogue public' : 'rétablir cette offre selon son statut actuel';
    if (!window.confirm(`Confirmer : ${verb} ?`)) return;
    const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    setBusy(true); setError(''); setMessage('');
    try { const response = await fetch(`${API}/api/partner/offers/${offer.id}/archive`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ archived }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Archivage impossible.'); setOffers((items) => items.map((item) => item.id === offer.id ? result.data : item)); setMessage(result.message); void loadDashboardSummary(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Archivage impossible.'); }
    finally { setBusy(false); }
  };
  const loadOffers = async () => {
    setLoading(true); setError('');
    const token = sessionStorage.getItem('ap360-token');
    if (!token) { setError('Session expirée.'); setLoading(false); return; }
    try { const response = await fetch(`${API}/api/partner/offers`, { headers: { Authorization: `Bearer ${token}` } }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Impossible de charger les offres.'); setOffers(result.data); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'API indisponible.'); }
    finally { setLoading(false); }
  };
  const importOffersCsv = async (mode: 'preview' | 'commit', csv = supplierImportCsv, fileName = supplierImportFileName) => {
    const token = sessionStorage.getItem('ap360-token'); if (!token || !csv) return;
    setSupplierImportBusy(true); setSupplierImportError(''); setSupplierImportMessage('');
    try {
      const response = await fetch(`${API}/api/partner/offers/import/${mode}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: fileName || 'offres-fournisseur.csv', csv }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Import CSV impossible.');
      setSupplierImportPreview(result.data); if (mode === 'commit') { setSupplierImportMessage(result.message); await loadOffers(); void loadDashboardSummary(); }
    } catch (reason) { setSupplierImportError(reason instanceof Error ? reason.message : 'API indisponible.'); }
    finally { setSupplierImportBusy(false); }
  };
  const downloadSupplierImportReport = () => {
    const rejected = supplierImportPreview?.rows.filter((row) => row.errors.length) ?? [];
    if (!rejected.length) return;
    const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [['Ligne', 'Référence fournisseur', 'Désignation', 'Motif(s) du rejet'], ...rejected.map((row) => [row.line, row.supplierSku, row.name, row.errors.join(' | ')])];
    const content = `\uFEFF${rows.map((row) => row.map(cell).join(';')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `rapport-erreurs-${(supplierImportFileName || 'import-fournisseur.csv').replace(/\.[^.]+$/, '')}.csv`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  useEffect(() => { void loadOffers(); void loadDashboardSummary(); }, []);
  const loadInventory = async () => {
    const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    setInventoryBusy(true); setInventoryError('');
    try { const response = await fetch(`${API}/api/partner/inventory`, { headers: { Authorization: `Bearer ${token}` } }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Chargement de l’inventaire impossible.'); setInventory(result.data); }
    catch (reason) { setInventoryError(reason instanceof Error ? reason.message : 'API indisponible.'); }
    finally { setInventoryBusy(false); }
  };
  const saveAvailableQuantity = async (stockItemId: string, availableQuantity: number) => {
    const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    setInventoryBusy(true); setInventoryError(''); setInventoryMessage('');
    try {
      const response = await fetch(`${API}/api/partner/inventory/${stockItemId}/availability`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ availableQuantity }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Mise à jour du disponible impossible.');
      await loadInventory(); void loadDashboardSummary(); setInventoryMessage(result.message || 'Disponibilité mise à jour.');
    } catch (reason) { setInventoryError(reason instanceof Error ? reason.message : 'API indisponible.'); }
    finally { setInventoryBusy(false); }
  };
  const saveBulkAvailability = async () => {
    const availableQuantity = Number(bulkAvailableQuantity);
    if (!selectedStockIds.length || !Number.isInteger(availableQuantity) || availableQuantity < 0 || availableQuantity > 1000000) { setInventoryError('Sélectionnez au moins une pièce et saisissez une quantité entière entre 0 et 1 000 000.'); return; }
    const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    setInventoryBusy(true); setInventoryError(''); setInventoryMessage('');
    try {
      const response = await fetch(`${API}/api/partner/inventory/bulk-availability`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ stockItemIds: selectedStockIds, availableQuantity }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Mise à jour groupée impossible.');
      setSelectedStockIds([]); await loadInventory(); void loadDashboardSummary(); setInventoryMessage(result.message || 'Stocks mis à jour.');
    } catch (reason) { setInventoryError(reason instanceof Error ? reason.message : 'Mise à jour groupée impossible.'); }
    finally { setInventoryBusy(false); }
  };
  const saveOfferAvailability = async (offerId: string, warehouseId: string, availableQuantity: number) => {
    const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    setInventoryBusy(true); setInventoryError(''); setInventoryMessage('');
    try {
      const response = await fetch(`${API}/api/partner/offers/${offerId}/availability`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ warehouseId, availableQuantity }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Mise à jour du stock impossible.');
      await loadInventory(); void loadDashboardSummary(); setInventoryMessage(result.message || 'Disponibilité mise à jour.');
    } catch (reason) { setInventoryError(reason instanceof Error ? reason.message : 'API indisponible.'); }
    finally { setInventoryBusy(false); }
  };
  useEffect(() => { if (role === 'SUPPLIER' || role === 'RESELLER') void loadInventory(); }, [role]);
  const submitOffer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    const invalidFitment = fitments.some((item) => item.mode === 'manual'
      ? Boolean(item.makeName || item.modelName || item.generationName || item.yearFrom || item.yearTo || item.engineName || item.engineCode || item.fuel || item.displacementCc || item.powerKw || item.variantName || item.bodyStyle || item.transmission || item.drivetrain) && (!item.makeName.trim() || !item.modelName.trim() || !item.generationName.trim() || !item.yearFrom || (item.yearTo && Number(item.yearTo) < Number(item.yearFrom)))
      : Boolean(item.makeId || item.modelId || item.generationId || item.engineId || item.variantId || item.year) && (!item.generationId || !item.year));
    if (invalidFitment) { setError('Chaque ligne commencée doit contenir marque, modèle, génération et année; corrigez-la ou retirez-la.'); return; }
    setBusy(true); setMessage(''); setError(''); const form = event.currentTarget; const fields = new FormData(form);
    const body: Record<string, unknown> = Object.fromEntries(['supplierSku','name','category','pieceBrand','reference','referenceType','purchasePrice','purchaseVatRate','description'].map((key) => [key, String(fields.get(key) || '')]));
    body.images = newOfferImages;
    const compatibilityRows: unknown[] = [];
    for (const item of fitments) {
      if (item.mode === 'manual' && item.makeName && item.modelName && item.generationName && item.yearFrom) compatibilityRows.push({ mode: 'manual', makeName: item.makeName.trim(), modelName: item.modelName.trim(), generationName: item.generationName.trim(), vehicleCategory: item.vehicleCategory, yearFrom: Number(item.yearFrom), ...(item.yearTo ? { yearTo: Number(item.yearTo) } : {}), ...(item.engineName ? { engineName: item.engineName.trim() } : {}), ...(item.engineCode ? { engineCode: item.engineCode.trim() } : {}), ...(item.fuel ? { fuel: item.fuel.trim() } : {}), ...(item.displacementCc ? { displacementCc: Number(item.displacementCc) } : {}), ...(item.powerKw ? { powerKw: Number(item.powerKw) } : {}), ...(item.variantName ? { variantName: item.variantName.trim() } : {}), ...(item.bodyStyle ? { bodyStyle: item.bodyStyle.trim() } : {}), ...(item.transmission ? { transmission: item.transmission.trim() } : {}), ...(item.drivetrain ? { drivetrain: item.drivetrain.trim() } : {}) });
      else if (item.mode === 'catalog' && item.generationId && item.year) compatibilityRows.push({ mode: 'catalog', generationId: item.generationId, ...(item.engineId ? { engineId: item.engineId } : {}), ...(item.variantId ? { variantId: item.variantId } : {}), year: Number(item.year) });
    }
    body.fitments = compatibilityRows;
    try {
      const response = await fetch(`${API}/api/partner/offers`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Soumission impossible.');
      setOffers((items) => [result.data, ...items]); void loadDashboardSummary(); form.reset(); setFitments([]); setNewOfferImages([]); setShowOfferForm(false); setMessage('Offre transmise à Ghorbel Automative Supply Group pour validation.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'API indisponible.'); }
    finally { setBusy(false); }
  };
  const submitOfferEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!editingOffer) return;
    const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    const invalidFitment = editFitments.some((item) => item.mode === 'manual'
      ? Boolean(item.makeName || item.modelName || item.generationName || item.yearFrom || item.yearTo || item.engineName || item.engineCode || item.fuel || item.displacementCc || item.powerKw || item.variantName || item.bodyStyle || item.transmission || item.drivetrain) && (!item.makeName.trim() || !item.modelName.trim() || !item.generationName.trim() || !item.yearFrom || (item.yearTo && Number(item.yearTo) < Number(item.yearFrom)))
      : Boolean(item.makeId || item.modelId || item.generationId || item.engineId || item.variantId || item.year) && (!item.generationId || !item.year || (item.yearTo && Number(item.yearTo) < Number(item.year))));
    if (invalidFitment) { setError('Chaque ligne commencée doit contenir marque, modèle, génération et année; corrigez-la ou retirez-la.'); return; }
    const fields = new FormData(event.currentTarget);
    const body: Record<string, unknown> = Object.fromEntries(['supplierSku','name','category','pieceBrand','purchasePrice','purchaseVatRate','description'].map((key) => [key, String(fields.get(key) ?? '')]));
    body.images = editOfferImages;
    body.fitments = editFitments.reduce<unknown[]>((rows, item) => {
      if (item.mode === 'manual' && item.makeName && item.modelName && item.generationName && item.yearFrom) rows.push({ mode: 'manual', makeName: item.makeName.trim(), modelName: item.modelName.trim(), generationName: item.generationName.trim(), vehicleCategory: item.vehicleCategory, yearFrom: Number(item.yearFrom), ...(item.yearTo ? { yearTo: Number(item.yearTo) } : {}), ...(item.engineName ? { engineName: item.engineName.trim() } : {}), ...(item.engineCode ? { engineCode: item.engineCode.trim() } : {}), ...(item.fuel ? { fuel: item.fuel.trim() } : {}), ...(item.displacementCc ? { displacementCc: Number(item.displacementCc) } : {}), ...(item.powerKw ? { powerKw: Number(item.powerKw) } : {}), ...(item.variantName ? { variantName: item.variantName.trim() } : {}), ...(item.bodyStyle ? { bodyStyle: item.bodyStyle.trim() } : {}), ...(item.transmission ? { transmission: item.transmission.trim() } : {}), ...(item.drivetrain ? { drivetrain: item.drivetrain.trim() } : {}) });
      else if (item.mode === 'catalog' && item.generationId && item.year) rows.push({ mode: 'catalog', generationId: item.generationId, ...(item.engineId ? { engineId: item.engineId } : {}), ...(item.variantId ? { variantId: item.variantId } : {}), year: Number(item.year), ...(item.yearTo ? { yearTo: Number(item.yearTo) } : {}) });
      return rows;
    }, []);
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${API}/api/partner/offers/${editingOffer.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Modification impossible.');
      setOffers((items) => items.map((item) => item.id === editingOffer.id ? result.data : item)); void loadDashboardSummary(); setEditingOffer(null); setMessage(result.message || 'Pièce modifiée.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'API indisponible.'); }
    finally { setBusy(false); }
  };
  const submitInventoryMovement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const token = sessionStorage.getItem('ap360-token'); if (!token) return;
    setInventoryBusy(true); setInventoryError(''); setInventoryMessage(''); const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    try { const response = await fetch(`${API}/api/partner/inventory/movements`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Mise à jour du stock impossible.'); form.reset(); await loadInventory(); void loadDashboardSummary(); setInventoryMessage('Mouvement enregistré. Le disponible a été recalculé.'); }
    catch (reason) { setInventoryError(reason instanceof Error ? reason.message : 'API indisponible.'); }
    finally { setInventoryBusy(false); }
  };
  const roleLabel = role === 'SUPPLIER' ? 'Fournisseur partenaire' : 'Revendeur partenaire';
  const filteredOffers = offers.filter((offer) => (offerFilter === 'ALL' || (offerFilter === 'ARCHIVED' ? Boolean(offer.archivedAt) : !offer.archivedAt && offer.status === offerFilter)) && `${offer.product.name} ${offer.supplierSku} ${offer.product.references[0]?.value ?? ''}`.toLocaleLowerCase().includes(offerSearch.toLocaleLowerCase()));
  useEffect(() => { if (showOfferForm) document.getElementById('partner-new-offer')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [showOfferForm]);
  return <div className="partner-shell"><header className="partner-header"><a href="/" className="brand"><img className="brand-logo" src="/Logo.webp" alt="Ghorbel Automative Supply Group"/></a><div className="partner-header-right"><NotificationCenter/><a className="partner-secondary-action" href="/">Catalogue B2B</a><span className="partner-company-label">{company || roleLabel}</span><span>{email}</span><button onClick={onLogout}>Déconnexion</button></div></header><main className="partner-main"><div className="partner-welcome"><div><div className="auth-eyebrow">ESPACE PARTENAIRE · {roleLabel.toUpperCase()}</div><h1>Bienvenue{company ? ` chez ${company}` : ''}.</h1><p className="partner-intro">Suivez la validation de vos offres et proposez de nouvelles références.</p></div><button className="partner-primary-action" onClick={() => { if (partnerPage !== "catalog") navigate("/partner/catalog"); setShowOfferForm((open) => !open); window.setTimeout(() => document.getElementById('partner-new-offer')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0); }}>{showOfferForm ? 'Fermer le formulaire' : '＋ Proposer une pièce'}</button></div>    {legalProfileStatus && legalProfileStatus !== 'APPROVED' && <section className={`partner-legal-task ${legalProfileStatus === 'REVIEW_REQUIRED' ? 'needs-correction' : ''}`} aria-labelledby="partner-legal-task-title"><div className="partner-legal-task-priority"><span aria-hidden="true">!</span> PRIORITÉ ÉLEVÉE</div><div className="partner-legal-task-copy"><strong id="partner-legal-task-title">Validation des informations légales</strong><span>{legalProfileStatus === 'REVIEW_REQUIRED' ? 'Des corrections sont demandées. Mettez à jour les informations de votre entreprise.' : 'Complétez les informations légales de votre entreprise pour permettre leur vérification par GHORBEL.'}</span></div><button type="button" className="partner-primary-action" onClick={() => navigate('/partner/profile')}>{legalProfileStatus === 'REVIEW_REQUIRED' ? 'Corriger mon profil' : 'Compléter mon profil'}</button></section>}
    <nav className="partner-navigation" aria-label="Navigation de l’espace partenaire"><a className={partnerPage === "dashboard" ? "active" : ""} href="/partner">Tableau de bord</a><a className={partnerPage === "catalog" ? "active" : ""} href="/partner/catalog">Catalogue et pièces <span>{offers.length}</span></a>{(role === 'SUPPLIER' || role === 'RESELLER') && <a className={partnerPage === "orders" ? "active" : ""} href="/partner/orders">Commandes</a>}{(role === 'SUPPLIER' || role === 'RESELLER') && <a className={partnerPage === "inventory" ? "active" : ""} href="/partner/inventory">Stock et disponibilités <span>{inventory.items.length}</span></a>}{(role === 'SUPPLIER' || role === 'RESELLER') && <a className={partnerPage === "invoices" ? "active" : ""} href="/partner/invoices">Factures à GHORBEL</a>}<a className={partnerPage === "profile" ? "active" : ""} href="/partner/profile">Profil et sécurité</a><button type="button" className="partner-nav-new" onClick={() => { if (partnerPage !== "catalog") navigate("/partner/catalog"); setShowOfferForm(true); }}>＋ Nouvelle pièce</button></nav>
    {partnerPage === "dashboard" && <div className="partner-overview">{dashboardError && <div className="auth-alert error">{dashboardError}</div>}<div className="partner-metrics"><article><span>Références</span><b>{dashboardSummary?.offers.total ?? '—'}</b><small>dans votre catalogue</small></article><article><span>Publiées</span><b>{dashboardSummary?.offers.approved ?? '—'}</b><small>validées par GHORBEL</small></article><article><span>En validation</span><b>{dashboardSummary?.offers.pending ?? '—'}</b><small>en cours d’examen</small></article><article><span>À corriger / refusées</span><b>{dashboardSummary?.offers.rejected ?? '—'}</b><small>consultez le statut de l’offre</small></article>{(role === 'SUPPLIER' || role === 'RESELLER') && <><article><span>Archivées</span><b>{dashboardSummary?.offers.archived ?? '—'}</b><small>masquées du catalogue public</small></article><article><span>Ruptures</span><b>{dashboardSummary?.stock.outOfStock ?? '—'}</b><small>offres publiées sans quantité</small></article><article><span>Stocks faibles</span><b>{dashboardSummary?.stock.lowStock ?? '—'}</b><small>sous le seuil configuré</small></article><article><span>Commandes traitées</span><b>{dashboardSummary?.orders.count ?? '—'}</b><small>commandes attribuées</small></article><article><span>Factures en attente</span><b>{dashboardSummary?.pendingInvoices ?? '—'}</b><small>validation GHORBEL</small></article></>}</div>{(role === 'SUPPLIER' || role === 'RESELLER') && <div className="partner-dashboard-lower"><article className="partner-dashboard-spend"><span>Achats confirmés</span><strong>{dashboardSummary ? `${Number(dashboardSummary.orders.confirmedPurchaseTotal).toFixed(3)} TND HT` : '—'}</strong><small>Calculé à partir des lignes acceptées, en préparation ou livrées. Prix convenus avec GHORBEL.</small></article><article className="partner-dashboard-activity"><strong>Dernières activités</strong>{dashboardSummary?.recentActivity.length ? dashboardSummary.recentActivity.map((activity) => <div key={activity.id}><span>{activity.label}</span><time>{new Date(activity.createdAt).toLocaleString('fr-FR')}</time></div>) : <small>{dashboardSummary ? 'Aucune activité enregistrée.' : 'Chargement des activités…'}</small>}</article></div>}
    </div>}
    {error && <div className="auth-alert error">{error}</div>}{message && <div className="auth-alert success">{message}</div>}
    {(role === 'SUPPLIER' || role === 'RESELLER') && partnerPage === "orders" && <SupplierOrders/>}{(role === 'SUPPLIER' || role === 'RESELLER') && partnerPage === "invoices" && <SupplierInvoices/>}{partnerPage === "catalog" && <section className="partner-panel" id="partner-offers"><div className="partner-panel-heading"><div><span className="partner-panel-eyebrow">CATALOGUE PARTENAIRE</span><h2>Mes offres</h2><p>Votre prix proposé à GHORBEL reste confidentiel. GHORBEL fixe séparément sa marge et le prix affiché aux clients.</p></div><div className="partner-action-group">{(role === 'SUPPLIER' || role === 'RESELLER') && <button className="partner-secondary-action" disabled={catalogExportBusy} onClick={() => void exportSupplierCatalog()}>{catalogExportBusy ? 'Export…' : 'Exporter mon catalogue CSV'}</button>}<button className="partner-secondary-action" onClick={() => void loadOffers()}>Actualiser</button></div></div>
      <div className="partner-offer-toolbar"><input aria-label="Rechercher une offre" placeholder="Rechercher par nom, SKU ou référence" value={offerSearch} onChange={(event) => setOfferSearch(event.target.value)}/><div className="partner-filter-tabs">{([['ALL','Toutes'],['PENDING','En validation'],['APPROVED','Approuvées'],['REJECTED','Refusées'],['ARCHIVED','Archivées']] as const).map(([key,label]) => <button key={key} className={offerFilter === key ? 'selected' : ''} onClick={() => setOfferFilter(key)}>{label}<span>{key === 'ALL' ? offers.length : key === 'ARCHIVED' ? offers.filter((offer) => offer.archivedAt).length : offers.filter((offer) => !offer.archivedAt && offer.status === key).length}</span></button>)}</div></div>
      {(role === 'SUPPLIER' || role === 'RESELLER') && <SupplierPriceHistoryPanel offers={offers}/>}
      <div className="supplier-csv-import"><div><strong>Importer ou mettre à jour plusieurs pièces</strong><span>CSV : 2 Mo et 500 lignes maximum. Un SKU déjà présent met à jour cette offre; toute hausse de prix reste à approuver par GHORBEL.</span><a href="/supplier-offer-template.csv" download>Télécharger le modèle CSV</a><a href="/supplier-offer-guide.txt" download>Guide de remplissage</a></div><label className="supplier-csv-file">{supplierImportFileName || 'Choisir un fichier CSV'}<input type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; setSupplierImportPreview(null); setSupplierImportMessage(''); if (file.size > 2_000_000) { setSupplierImportError('Le fichier dépasse la limite de 2 Mo.'); return; } setSupplierImportFileName(file.name); setSupplierImportError(''); void file.text().then((csv) => { setSupplierImportCsv(csv); void importOffersCsv('preview', csv, file.name); }); }}/></label>{supplierImportBusy && <small>Analyse du fichier…</small>}{supplierImportError && <small className="supplier-csv-error">{supplierImportError}</small>}{supplierImportMessage && <small className="supplier-csv-success">{supplierImportMessage}</small>}{supplierImportPreview && <div className="supplier-csv-preview"><strong>{supplierImportPreview.importedRows !== undefined ? `${supplierImportPreview.createdRows ?? 0} ajoutée(s) · ${supplierImportPreview.updatedRows ?? 0} mise(s) à jour` : `${supplierImportPreview.acceptedRows} ligne(s) valide(s) · ${supplierImportPreview.rejectedRows} à corriger`}</strong>{supplierImportPreview.rejectedRows > 0 && <button type="button" className="partner-secondary-action" onClick={downloadSupplierImportReport}>Télécharger le rapport d’erreurs ({supplierImportPreview.rejectedRows})</button>}<div>{supplierImportPreview.rows.slice(0, 50).map((row) => <article className={row.errors.length ? 'invalid' : ''} key={`${row.line}-${row.supplierSku}`}><b>L{row.line}</b><span>{row.supplierSku} · {row.name}</span><small>{row.errors.length ? row.errors.join(' ') : row.action === 'UPDATE' ? 'Mettra à jour la référence existante' : 'Nouvelle pièce à ajouter'}</small></article>)}</div>{supplierImportPreview.rows.length > 50 && <small>Aperçu limité aux 50 premières lignes.</small>}{supplierImportPreview.importedRows === undefined && supplierImportPreview.acceptedRows > 0 && <button className="auth-submit" disabled={supplierImportBusy} onClick={() => void importOffersCsv('commit')}>{supplierImportBusy ? 'Import…' : `Appliquer ${supplierImportPreview.acceptedRows} ligne(s) valide(s)`}</button>}</div>}</div>
    {loading ? <p className="partner-empty">Chargement des offres…</p> : filteredOffers.length === 0 ? <div className="partner-empty"><strong>{offers.length ? 'Aucun résultat avec ces filtres.' : 'Aucune offre soumise.'}</strong><span>{offers.length ? 'Modifiez la recherche ou le statut sélectionné.' : 'Proposez votre première référence avec le bouton en haut de la page.'}</span></div> : <div className="partner-offer-list">{filteredOffers.map((offer) => <article key={offer.id}><div className="partner-offer-product">{offer.product.images?.[0] ? <img className="partner-offer-thumbnail" src={imageSource(offer.product.images[0])} alt={`Photo de ${offer.product.name}`} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.display = 'none'; }}/> : <span className="partner-product-icon">{(offer.product.name[0] || 'P').toUpperCase()}</span>}<div><strong>{offer.product.name}</strong><span>SKU {offer.supplierSku}{offer.product.category ? ` · ${offer.product.category}` : ''}{offer.product.references[0] ? ` · ${offer.product.references[0].value}` : ''}</span><small>Prix proposé à GHORBEL : {Number(offer.purchasePrice).toFixed(3)} TND HT · TVA {Number(offer.purchaseVatRate).toFixed(2)}%{offer.pendingPurchasePrice != null ? ` · hausse en attente : ${Number(offer.pendingPurchasePrice).toFixed(3)} TND` : ''}</small>{offer.fitmentSuggestions?.map((suggestion) => <small key={suggestion.id}>Compatibilité déclarée : {fitmentSuggestionLabel(suggestion)}</small>)}</div></div><b className={`offer-status ${offer.status.toLowerCase()}`}>{offer.archivedAt ? 'Archivée' : offer.status === 'PENDING' ? 'En validation' : offer.status === 'APPROVED' ? 'Approuvée' : 'Refusée'}</b><button className="partner-secondary-action" onClick={() => { setEditingOffer(offer); setEditOfferImages(offer.product.images || []); setEditFitments(makeEditFitmentDrafts(offer)); }}>Modifier la pièce</button><button className="partner-secondary-action" disabled={busy} onClick={() => void toggleOfferArchive(offer)}>{offer.archivedAt ? 'Rétablir au catalogue' : 'Archiver l’offre'}</button>{(role === 'SUPPLIER' || role === 'RESELLER') && !offer.archivedAt && offer.status === 'APPROVED' && <PartnerOfferAvailabilityControl offerId={offer.id} warehouses={inventory.warehouses} items={inventory.items} busy={inventoryBusy} onSave={saveOfferAvailability}/>}</article>)}</div>}
    </section>}
    {(role === 'SUPPLIER' || role === 'RESELLER') && partnerPage === "inventory" && <section className="partner-panel" id="partner-inventory"><div className="partner-panel-heading"><div><span className="partner-panel-eyebrow">DISPONIBILITÉS</span><h2>Stock & disponibilités</h2><p>Modifiez directement la quantité dans « Mes offres ». Chaque entrepôt garde son stock; mettre une pièce hors stock bloque les nouvelles commandes.</p></div><button className="partner-secondary-action" onClick={() => void loadInventory()} disabled={inventoryBusy}>{inventoryBusy ? 'Actualisation…' : 'Actualiser'}</button></div>
      {inventoryError && <div className="auth-alert error">{inventoryError}</div>}{inventoryMessage && <div className="auth-alert success">{inventoryMessage}</div>}
      {inventory.warehouses.length === 0 && <div className="partner-empty"><strong>Chargement de votre entrepôt…</strong><span>Votre espace de stock personnel se crée automatiquement. Actualisez cette section dans quelques instants.</span></div>}
      {inventory.warehouses.length > 0 && offers.some((offer) => offer.status === 'APPROVED') && <form className="partner-stock-form" onSubmit={submitInventoryMovement}><label>Entrepôt<select name="warehouseId" required defaultValue=""><option value="" disabled>Choisir un entrepôt</option>{inventory.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.code}{warehouse.city ? ` · ${warehouse.city}` : ''}</option>)}</select></label><label>Offre approuvée<select name="offerId" required defaultValue=""><option value="" disabled>Choisir une offre</option>{offers.filter((offer) => offer.status === 'APPROVED').map((offer) => <option key={offer.id} value={offer.id}>{offer.product.name} · {offer.supplierSku}</option>)}</select></label><label>Mouvement<select name="type" defaultValue="RECEIPT"><option value="RECEIPT">Réception</option><option value="ADJUSTMENT">Ajustement (+/-)</option><option value="DAMAGE">Déclarer endommagé</option></select></label><label>Quantité<input name="quantity" type="number" min="-1000000" max="1000000" defaultValue="1" required/></label><label>Motif<input name="reason" minLength={3} maxLength={240} placeholder="Bon de livraison…" required/></label><button className="auth-submit" disabled={inventoryBusy}>{inventoryBusy ? 'Enregistrement…' : 'Mettre à jour le stock'}</button></form>}
      {inventory.items.length > 0 && <div className="partner-bulk-stock"><div><strong>Mise à jour groupée</strong><span>Sélectionnez jusqu’à 100 pièces approuvées et définissez leur quantité vendable dans votre entrepôt.</span></div><label>Unités disponibles<input type="number" min="0" max="1000000" step="1" value={bulkAvailableQuantity} onChange={(event) => setBulkAvailableQuantity(event.target.value)}/></label><button className="partner-primary-action" disabled={inventoryBusy || selectedStockIds.length === 0 || !bulkAvailableQuantity.trim()} onClick={() => void saveBulkAvailability()}>Appliquer à {selectedStockIds.length} pièce(s)</button><button type="button" className="partner-secondary-action" disabled={inventoryBusy || selectedStockIds.length === 0} onClick={() => setSelectedStockIds([])}>Effacer la sélection</button></div>}
      <div className="partner-stock-list">{inventory.items.length === 0 ? <div className="partner-empty">Aucun stock renseigné pour le moment.</div> : inventory.items.map((item) => <article key={item.id}><div><label className="partner-stock-select"><input type="checkbox" checked={selectedStockIds.includes(item.id)} disabled={item.offer.status !== 'APPROVED' || inventoryBusy || (!selectedStockIds.includes(item.id) && selectedStockIds.length >= 100)} onChange={(event) => setSelectedStockIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))}/> Sélectionner</label><strong>{item.offer.product.name}</strong><span>{item.warehouse.name} · {item.offer.supplierSku}</span><small>Physique {item.onHand} · Réservé {item.reserved} · Endommagé {item.damaged} · En commande {item.onOrder}</small>{item.offer.status === 'APPROVED' ? <><StockMinimumControl stockItemId={item.id} minimumStock={item.minimumStock} available={item.available} endpoint={`/api/partner/inventory/${item.id}/minimum-stock`}/><PartnerAvailabilityControl available={item.available} busy={inventoryBusy} onSave={(quantity) => void saveAvailableQuantity(item.id, quantity)}/></> : <small>Le stock sera publiable après approbation de l’offre.</small>}</div><b className={item.available > 0 && item.offer.status === 'APPROVED' ? 'stock-positive' : 'stock-zero'}>{item.offer.status !== 'APPROVED' ? 'En attente de validation' : item.available > 0 ? `En stock · ${item.available}` : 'Hors stock'}</b></article>)}</div>
      {inventory.movements.length > 0 && <details className="partner-stock-history"><summary>Derniers mouvements ({inventory.movements.length})</summary><div>{inventory.movements.map((movement) => <article key={movement.id}><strong>{movement.type} · {movement.quantity > 0 ? '+' : ''}{movement.quantity}</strong><span>{movement.offer.product.name} · {movement.warehouse.name} · {movement.reason}</span><small>{new Date(movement.createdAt).toLocaleString('fr-FR')}</small></article>)}</div></details>}
    </section>}
    {partnerPage === "catalog" && showOfferForm && <section className="partner-panel partner-form-panel" id="partner-new-offer"><div className="partner-panel-heading"><div><span className="partner-panel-eyebrow">NOUVELLE RÉFÉRENCE</span><h2>Proposer une pièce</h2><p>Les nouveaux produits sont soumis à validation avant publication.</p></div><button className="partner-secondary-action" onClick={() => setShowOfferForm(false)}>Annuler</button></div><form className="partner-offer-form" onSubmit={submitOffer}><label>Votre référence interne<input name="supplierSku" required maxLength={100}/></label><label>Nom de la pièce<input name="name" required maxLength={180}/></label><label>Catégorie<input name="category" list="part-category-options" maxLength={100}/></label><datalist id="part-category-options">{['Freinage','Moteur','Filtration','Suspension','Direction','Transmission','Embrayage','Refroidissement','Électricité','Éclairage','Carrosserie','Échappement','Climatisation','Pneumatiques','Huiles et fluides','Accessoires','Consommables','Autre'].map((category) => <option key={category} value={category}/>)}</datalist><label>Marque de la pièce<input name="pieceBrand" maxLength={100}/></label><label>Référence OEM ou équivalente<input name="reference" maxLength={100}/></label><label>Type de référence<select name="referenceType" defaultValue="OEM"><option value="OEM">OEM</option><option value="ALTERNATIVE">Équivalente</option></select></label><PartnerFitmentEditor value={fitments} onChange={setFitments}/><label>Prix proposé à GHORBEL HT (TND)<input name="purchasePrice" type="number" min="0.001" step="0.001" required/></label><label>TVA fournisseur (%)<input name="purchaseVatRate" type="number" min="0" max="100" step="0.01" defaultValue="19" required/></label><label className="partner-description">Description<textarea name="description" maxLength={2000}/></label><PartnerPhotoUpload value={newOfferImages} onChange={setNewOfferImages} onUploading={setPhotoUploading}/><button className="auth-submit" disabled={busy || photoUploading}>{photoUploading ? 'Attendez la fin de l’upload…' : busy ? 'Envoi…' : 'Soumettre à validation'}</button></form></section>}
    {partnerPage === "catalog" && editingOffer && <div className="partner-edit-overlay"><section className="partner-edit-dialog"><div className="partner-panel-heading"><div><span className="partner-panel-eyebrow">MODIFIER LE CATALOGUE</span><h2>{editingOffer.product.name}</h2><p>Vous proposez votre prix d’achat à GHORBEL. Une baisse s’applique directement; toute hausse attend l’approbation de l’administration.</p></div><button className="partner-secondary-action" type="button" onClick={() => setEditingOffer(null)}>Fermer</button></div><form className="partner-offer-form" onSubmit={submitOfferEdit}><label>Votre référence interne<input name="supplierSku" required maxLength={100} defaultValue={editingOffer.supplierSku}/></label><label>Nom de la pièce<input name="name" required maxLength={180} defaultValue={editingOffer.product.name}/></label><label>Catégorie<input name="category" list="part-category-options-edit" maxLength={100} defaultValue={editingOffer.product.category || ''}/></label><datalist id="part-category-options-edit">{['Freinage','Moteur','Filtration','Suspension','Direction','Transmission','Embrayage','Refroidissement','Électricité','Éclairage','Carrosserie','Échappement','Climatisation','Pneumatiques','Huiles et fluides','Accessoires','Consommables','Autre'].map((category) => <option key={category} value={category}/>)}</datalist><label>Marque de la pièce<input name="pieceBrand" maxLength={100} defaultValue={editingOffer.product.pieceBrand || ''}/></label><label>Prix proposé à GHORBEL HT (TND)<input name="purchasePrice" type="number" min="0.001" step="0.001" required defaultValue={editingOffer.pendingPurchasePrice ?? editingOffer.purchasePrice}/></label><label>TVA fournisseur (%)<input name="purchaseVatRate" type="number" min="0" max="100" step="0.01" required defaultValue={editingOffer.purchaseVatRate}/></label><label className="partner-description">Description<textarea name="description" maxLength={2000} defaultValue={editingOffer.product.description || ''}/></label><PartnerFitmentEditor value={editFitments} onChange={setEditFitments}/><PartnerPhotoUpload value={editOfferImages} onChange={setEditOfferImages} onUploading={setPhotoUploading}/>{(role === 'SUPPLIER' || role === 'RESELLER') && editingOffer.status === 'APPROVED' && <div className="partner-stock-edit"><strong>Stock dans votre entrepôt</strong><PartnerOfferAvailabilityControl offerId={editingOffer.id} warehouses={inventory.warehouses} items={inventory.items} busy={inventoryBusy} onSave={saveOfferAvailability}/><small>Les quantités restent dans votre entrepôt. Ghorbel Automative Supply Group récupère la pièce après votre préparation.</small></div>}<button className="auth-submit" disabled={busy || photoUploading}>{photoUploading ? 'Attendez la fin de l’upload…' : busy ? 'Enregistrement…' : 'Enregistrer les modifications'}</button></form></section></div>}
    {partnerPage === "profile" && <PartnerProfile email={email}/>}<footer className="partner-footer"><span>Ghorbel Automative Supply Group · Espace partenaire sécurisé</span><a className="partner-home" href="/">Retour au catalogue public</a></footer></main></div>;
}

function selectedGenerationYears(generations: Row[] | undefined, id: string): number[] {
  const generation = generations?.find((item) => item.id === id);
  if (!generation?.yearFrom) return [];
  const end = generation.yearTo ?? new Date().getFullYear();
  if (end - generation.yearFrom > 80) return [];
  return Array.from({ length: end - generation.yearFrom + 1 }, (_, index) => end - index);
}

export { AdminDashboard, AdminCompanyPaymentSettings, AdminProductCatalog, VehicleCatalogImporter, VehicleCatalogReview, AdminAuditLogs, StockMinimumControl, PartnerAvailabilityControl, PartnerOfferAvailabilityControl, StockManagement, PricingManagement, OrderCenter, SupplierOrders, SupplierInvoices, PartnerProfile, AdminOrderManagement, AdminSupplierInvoices, ProductDetailPage, AdminUsers, ContactPage, AdminContactInbox, PartnerFitmentEditor, SupplierPriceHistoryPanel, PartnerPhotoUpload, PartnerDashboard };
