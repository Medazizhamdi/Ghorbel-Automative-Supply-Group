import { lazy, useEffect, useState, type FormEvent } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, BadgeCheck, Bell, Box, CarFront, CheckCheck, ChevronDown, CircleHelp, Eye, EyeOff, FileSearch, Gauge, Menu, PackageSearch, Search, ShieldCheck, ShoppingCart, X, Truck, Wrench } from 'lucide-react';
const AdminDashboard = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.AdminDashboard })));
const AdminCompanyPaymentSettings = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.AdminCompanyPaymentSettings })));
const AdminProductCatalog = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.AdminProductCatalog })));
const VehicleCatalogImporter = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.VehicleCatalogImporter })));
const VehicleCatalogReview = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.VehicleCatalogReview })));
const AdminAuditLogs = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.AdminAuditLogs })));
const StockMinimumControl = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.StockMinimumControl })));
const PartnerAvailabilityControl = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.PartnerAvailabilityControl })));
const PartnerOfferAvailabilityControl = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.PartnerOfferAvailabilityControl })));
const StockManagement = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.StockManagement })));
const PricingManagement = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.PricingManagement })));
const OrderCenter = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.OrderCenter })));
const SupplierOrders = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.SupplierOrders })));
const SupplierInvoices = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.SupplierInvoices })));
const PartnerProfile = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.PartnerProfile })));
const AdminOrderManagement = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.AdminOrderManagement })));
const AdminSupplierInvoices = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.AdminSupplierInvoices })));
const ProductDetailPage = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.ProductDetailPage })));
const AdminUsers = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.AdminUsers })));
const ContactPage = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.ContactPage })));
const AdminContactInbox = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.AdminContactInbox })));
const PartnerFitmentEditor = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.PartnerFitmentEditor })));
const SupplierPriceHistoryPanel = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.SupplierPriceHistoryPanel })));
const PartnerPhotoUpload = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.PartnerPhotoUpload })));
const PartnerDashboard = lazy(() => import('./WorkspaceComponents').then((module) => ({ default: module.PartnerDashboard })));

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
  const load = async () => { const token = sessionStorage.getItem('ap360-token') || ''; if (!token) return; const response = await fetch(`${API}/api/notifications`, { headers: { Authorization: `Bearer ${token}` } }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Chargement des notifications impossible.'); setItems(result.data); setUnread(result.unreadCount); };
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'API indisponible.')); const timer = window.setInterval(() => { void load().catch(() => undefined); }, 60_000); return () => window.clearInterval(timer); }, []);
  const markRead = async (id: string) => { const token = sessionStorage.getItem('ap360-token') || ''; try { const response = await fetch(`${API}/api/notifications/${id}/read`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } }); if (!response.ok && response.status !== 404) throw new Error('Mise à jour impossible.'); setItems((current) => current.map((item) => item.id === id ? { ...item, readAt: item.readAt || new Date().toISOString() } : item)); setUnread((count) => Math.max(0, count - (items.find((item) => item.id === id && !item.readAt) ? 1 : 0))); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Mise à jour impossible.'); } };
  const markAllRead = async () => { const token = sessionStorage.getItem('ap360-token') || ''; try { const response = await fetch(`${API}/api/notifications/read-all`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error('Mise à jour impossible.'); setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() }))); setUnread(0); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Mise à jour impossible.'); } };
  return <div className="notification-center"><button className="notification-toggle" aria-label={`Notifications${unread ? `, ${unread} non lue(s)` : ''}`} aria-expanded={open} onClick={() => { setOpen((value) => !value); setError(''); }}><Bell size={17}/>{unread > 0 && <span>{unread > 99 ? '99+' : unread}</span>}</button>{open && <section className="notification-popover" aria-label="Centre de notifications"><header><strong>Notifications</strong><button onClick={() => void markAllRead()} disabled={!unread}><CheckCheck size={15}/> Tout lire</button></header>{error && <p className="notification-error">{error}</p>}{items.length === 0 ? <p className="notification-empty">Aucune notification pour le moment.</p> : <div>{items.map((item) => <a key={item.id} href={item.link || '#'} className={item.readAt ? '' : 'unread'} onClick={(event) => { event.preventDefault(); void (async () => { if (!item.readAt) await markRead(item.id); setOpen(false); if (item.link) navigate(item.link); })(); }}><strong>{item.title}</strong><span>{item.message}</span><small>{new Date(item.createdAt).toLocaleString('fr-FR')}</small></a>)}</div>}</section>}</div>;
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

type AuditEntry = { id: string; action: string; entityType: string; entityId: string; details?: Record<string, unknown> | null; createdAt: string; actor: { firstName: string; lastName: string; email: string; role: string } };
type BankTransferDetails = { accountHolder: string; bankName: string; rib: string; instructions?: string | null };
type CompanyPaymentSettings = { id: string; bankTransferEnabled: boolean; bankAccountHolder?: string | null; bankName?: string | null; bankRib?: string | null; bankInstructions?: string | null; updatedAt?: string | null };

type AdminCatalogProduct = { id: string; sku: string; name: string; description?: string | null; category?: string | null; pieceBrand?: string | null; images: string[]; status: string; listPrice?: string | number | null; vatRate: string | number; archivedAt?: string | null };

type VehicleImportPreviewRow = { line: number; make: string; model: string; category?: string; generation: string; yearFrom: number; yearTo?: number; engine?: string; engineCode?: string; fuel?: string; displacementCc?: number; powerKw?: number; variant?: string; bodyStyle?: string; transmission?: string; drivetrain?: string; source?: string; sourceReference?: string; verified: boolean; errors: string[] };

type VehicleContribution = {
  id: string; name: string; yearFrom: number; yearTo: number | null; status: string; source: string | null; sourceReference: string | null;
  model: { id: string; name: string; status: string; source: string | null; sourceReference: string | null; make: { id: string; name: string; status: string; source: string | null; sourceReference: string | null } };
  engines: Array<{ id: string; name: string; engineCode: string | null; fuel: string | null; displacementCc: number | null; powerKw: number | null; source: string | null; sourceReference: string | null }>;
  variants: Array<{ id: string; name: string; bodyStyle: string | null; transmission: string | null; drivetrain: string | null; source: string | null; sourceReference: string | null; engine: { name: string; engineCode: string | null } | null }>;
};

type AdminWarehouse = { id: string; code: string; name: string; city?: string | null };
type AdminStock = { id: string; onHand: number; reserved: number; damaged: number; onOrder: number; minimumStock: number; available: number; warehouse: AdminWarehouse; offer: { id: string; status: string; supplierSku: string; product: { sku: string; name: string }; supplier: { companyName?: string | null; email: string } } };
type AdminOffer = { id: string; supplierSku: string; status: string; product: { name: string }; supplier: { companyName?: string | null; email: string } };
type AdminMovement = { id: string; type: string; quantity: number; reason: string; createdAt: string; warehouse: { name: string; code: string }; offer: { supplierSku: string; product: { name: string } }; actor: { firstName: string; lastName: string } };
type PartnerInventoryData = { warehouses: AdminWarehouse[]; items: AdminStock[]; movements: Omit<AdminMovement, 'actor'>[] };

type PricingProfileRow = { id: string; name: string; description?: string | null; discountPercent: string | number; active: boolean; _count: { users: number }; productPrices?: { productId: string; discountPercent: string | number; product: { id: string; sku: string; name: string } }[]; categoryPrices?: { category: string; discountPercent: string | number }[] };
type PricingProductRow = { id: string; sku: string; name: string; category?: string | null; status: string; listPrice?: string | number | null; pricingMode?: 'MANUAL' | 'MARGIN'; marginPercent?: string | number | null; lowestSupplierCost?: string | number | null; effectiveMarginPercent?: string | number; vatRate: string | number };
type PricingAccountRow = { id: string; email: string; companyName?: string | null; role: string; status: string; pricingProfileId?: string | null };
type CategoryMarginRow = { category: string; marginPercent: string | number };

type CustomerOrder = { id: string; orderNumber: string; status: string; paymentMethod: string; paymentStatus: string; transferReference?: string | null; paymentProofs?: { id: string; fileName: string; mimeType: string; fileSize: number; createdAt: string }[]; currency: string; subtotalExclTax: string | number; vatTotal: string | number; totalInclTax: string | number; createdAt: string; guestAccessToken?: string; lines: { id: string; quantity: number; status: string; productNameSnapshot: string; carrierName?: string | null; trackingReference?: string | null; trackingUrl?: string | null; lineTotalInclTax: string | number }[] };
type DeliveryAddress = { id: string; label: string; recipientName: string; phone: string; address: string; city: string; isDefault: boolean };

type SupplierOrderLine = { id: string; orderId: string; quantity: number; status: string; productNameSnapshot: string; productSkuSnapshot: string; supplierSkuSnapshot: string; purchaseUnitPriceExclTaxSnapshot: string | number | null; purchaseVatRateSnapshot: string | number | null; purchaseLineTotalExclTax: string | null; purchaseLineTotalInclTax: string | null; carrierName?: string | null; trackingReference?: string | null; trackingUrl?: string | null; createdAt: string; warehouse: { code: string; name: string }; order: { orderNumber: string; status: string; createdAt: string } };

type SupplierInvoiceRecord = { id: string; invoiceNumber: string; fileName: string; status: 'PENDING' | 'ACCEPTED' | 'REJECTED'; reviewNote?: string | null; uploadedAt: string; order: { orderNumber: string }; events: { id: string; type: 'UPLOADED' | 'RESUBMITTED' | 'ACCEPTED' | 'REJECTED'; note?: string | null; createdAt: string; actor?: { email: string } }[] };

type AdminOrder = { id: string; orderNumber: string; status: string; paymentMethod: string; paymentStatus: string; transferReference?: string | null; paymentProofs: { id: string; fileName: string; mimeType: string; fileSize: number; createdAt: string }[]; paymentConfirmedAt?: string | null; subtotalExclTax: string | number; vatTotal: string | number; totalInclTax: string | number; createdAt: string; deliveryName: string; deliveryPhone: string; deliveryAddress: string; deliveryCity: string; guestEmail?: string | null; customer?: { email: string; companyName?: string | null; role?: string } | null; paymentEvents: { id: string; fromStatus: string; toStatus: string; transferReference?: string | null; note?: string | null; createdAt: string; actor: { email: string } }[]; lines: { id: string; quantity: number; status: string; productNameSnapshot: string; productSkuSnapshot: string; supplierSkuSnapshot: string; carrierName?: string | null; trackingReference?: string | null; trackingUrl?: string | null; lineTotalInclTax: string | number; warehouse?: { code: string; name: string; city?: string | null } | null; supplierOffer: { supplier: { companyName?: string | null; email: string } } }[] };
type AdminSupplierInvoice = SupplierInvoiceRecord & { supplier: { id: string; email: string; companyName?: string | null }; reviewedBy?: { email: string } | null; reviewNote?: string | null };

type AdminUserRecord = { id: string; email: string; phone: string | null; firstName: string; lastName: string; role: 'ADMIN' | 'SUPPLIER' | 'RESELLER' | 'CUSTOMER'; status: 'PENDING' | 'ACTIVE' | 'SUSPENDED'; companyName: string | null; legalName?: string | null; tradeName?: string | null; businessAddress?: string | null; businessCity?: string | null; postalCode?: string | null; taxIdentifier?: string | null; commercialRegisterNumber?: string | null; legalProfileStatus?: 'PENDING' | 'APPROVED' | 'REVIEW_REQUIRED'; pricingProfileId: string | null; createdAt: string };

type ContactMessageItem = { id: string; fullName: string; email: string; subject: string; body: string; readAt: string | null; createdAt: string; replies: { id: string; body: string; createdAt: string; admin: { firstName: string; lastName: string } | null }[] };

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [urlParams, setUrlParams] = useSearchParams();
  const isAdminPage = location.pathname.startsWith('/admin');
  const adminPage = isAdminPage ? (location.pathname.split('/')[2] || 'dashboard') : 'dashboard';
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot' | 'reset' | null>(() => location.pathname === '/reset-password' ? 'reset' : location.pathname.startsWith('/partner') && !['SUPPLIER', 'RESELLER'].includes(sessionStorage.getItem('ap360-role') || '') ? 'login' : null);
  const [authError, setAuthError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authPasswordVisible, setAuthPasswordVisible] = useState(false);
  const [authConfirmPasswordVisible, setAuthConfirmPasswordVisible] = useState(false);
  const [signedInAs, setSignedInAs] = useState(() => sessionStorage.getItem('ap360-user') || '');
  const [signedInRole, setSignedInRole] = useState(() => sessionStorage.getItem('ap360-role') || '');
  const [partnerCompany, setPartnerCompany] = useState(() => sessionStorage.getItem('ap360-company') || '');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null);
  const [orderCenterOpen, setOrderCenterOpen] = useState(false);
  const [orderCenterInitialView, setOrderCenterInitialView] = useState<'cart' | 'orders' | 'addresses'>('cart');
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminAccounts, setAdminAccounts] = useState<{id:string;email:string;phone?:string|null;firstName:string;lastName:string;role:string;status:string;companyName?:string|null;createdAt:string}[]>([]);
  const [adminError, setAdminError] = useState('');
  const [adminBusy, setAdminBusy] = useState('');
  const [importFileName, setImportFileName] = useState('catalogue.csv');
  const [importCsv, setImportCsv] = useState('');
  const [importBusy, setImportBusy] = useState(false);
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
    if (location.pathname === '/reset-password') {
      setAuthMode('reset'); setAuthError(''); setAuthMessage('');
    }
  }, [location.pathname]);

  useEffect(() => {
    setAuthPasswordVisible(false); setAuthConfirmPasswordVisible(false);
  }, [authMode]);

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
    try {
      if (authMode === 'forgot') {
        const response = await fetch(`${API}/api/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: String(fields.get('email') || '') }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Une erreur est survenue.');
        setAuthMessage(result.message || 'Si cette adresse correspond à un compte éligible, un lien de réinitialisation sera envoyé par e-mail.');
        return;
      }
      if (authMode === 'reset') {
        const password = String(fields.get('password') || '');
        if (password !== String(fields.get('confirmPassword') || '')) throw new Error('Les deux mots de passe ne correspondent pas.');
        const token = urlParams.get('token') || '';
        if (!token) throw new Error('Le lien de réinitialisation est incomplet. Demandez un nouveau lien.');
        const response = await fetch(`${API}/api/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Le lien est invalide ou expiré.');
        setAuthMode('login'); setAuthMessage(result.message || 'Mot de passe modifié. Vous pouvez maintenant vous connecter.');
        navigate('/', { replace: true });
        return;
      }
      const body: Record<string, string> = { email: String(fields.get('email') || ''), password: String(fields.get('password') || '') };
      if (authMode === 'register') {
        if (body.password !== String(fields.get('confirmPassword') || '')) throw new Error('Les deux mots de passe ne correspondent pas.');
        body.firstName = String(fields.get('firstName') || ''); body.lastName = String(fields.get('lastName') || ''); body.phone = String(fields.get('phone') || '');
      }
      const response = await fetch(`${API}/api/auth/${authMode === 'login' ? 'login' : 'register'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Une erreur est survenue.');
      if (authMode === 'login') {
        sessionStorage.setItem('ap360-token', result.token); sessionStorage.setItem('ap360-user', result.user.email); sessionStorage.setItem('ap360-role', result.user.role); sessionStorage.setItem('ap360-company', result.user.companyName || ''); setSignedInAs(result.user.email); setSignedInRole(result.user.role); setPartnerCompany(result.user.companyName || ''); setAuthMessage('Connexion réussie.');
        window.setTimeout(() => {
          setAuthMode(null);
          if (result.user.role === 'ADMIN') navigate('/admin');
          else if (result.user.role === 'SUPPLIER' || result.user.role === 'RESELLER') navigate('/partner');
          else { navigate('/'); setOrderCenterInitialView('orders'); setOrderCenterOpen(true); }
        }, 650);
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
    const token = sessionStorage.getItem('ap360-token'); if (!token || !importCsv.trim()) return;
    if (new TextEncoder().encode(importCsv).byteLength > 2_000_000) { setAdminError('Le fichier dépasse la limite de 2 Mo. Répartissez le catalogue en plusieurs imports.'); return; }
    setImportBusy(true); setAdminError(''); setImportPreview(null);
    try {
      const response = await fetch(`${API}/api/admin/catalog/imports/preview`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: importFileName, csv: importCsv }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Prévisualisation impossible.');
      setImportPreview(result.data); await refreshImportHistory();
    } catch (error) { setAdminError(error instanceof Error ? error.message : 'API indisponible.'); }
    finally { setImportBusy(false); }
  };
  const commitCatalogImport = async () => {
    const token = sessionStorage.getItem('ap360-token'); if (!token || !importPreview) return;
    setImportBusy(true); setAdminError('');
    try {
      const response = await fetch(`${API}/api/admin/catalog/imports/${importPreview.jobId}/commit`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Import impossible.');
      setImportPreview(null); setImportCsv(''); await refreshImportHistory();
      setAdminError(result.data.rejectedRows ? `${result.data.acceptedRows} ligne(s) importée(s), ${result.data.rejectedRows} rejetée(s). Consultez le rapport d’import.` : `${result.data.acceptedRows} ligne(s) importée(s).`);
    } catch (error) { setAdminError(error instanceof Error ? error.message : 'API indisponible.'); }
    finally { setImportBusy(false); }
  };
  if (location.pathname === '/contact') return <ContactPage signedInAs={signedInAs}/>;
  if (location.pathname.startsWith('/products/')) return <ProductDetailPage onAddToCart={addToCart}/>;
  if (isAdminPage && signedInRole !== 'ADMIN') return <Navigate to="/" replace/>;
  if (isAdminPage && adminPage === 'messages') return <Navigate to="/admin/dashboard" replace/>;
  if ((signedInRole === 'SUPPLIER' || signedInRole === 'RESELLER') && location.pathname.startsWith('/partner')) return <PartnerDashboard email={signedInAs} company={partnerCompany} role={signedInRole} onLogout={logout}/>;
  return <div className={`app-shell${isAdminPage ? ' admin-route-shell' : ''}`}><CartToast/>
    <div className="topline"><div className="wrap topline-inner"><span>Distribution automobile B2B & B2C</span><span className="topline-right"><span>Livraison dans toute la Tunisie</span><span className="separator">·</span><a href="#contact">Besoin d’aide ?</a></span></div></div>
    <header className="header"><div className="wrap nav-row"><a className="brand" href="#top" aria-label="Ghorbel Automative Supply Group accueil" onClick={() => setMobileMenuOpen(false)}><img className="brand-logo" src="/Logo.webp" alt="Ghorbel Automative Supply Group"/></a><nav id="mobile-site-menu" className={`nav-links${mobileMenuOpen ? ' mobile-open' : ''}`}><a className="active" href="#catalogue" onClick={() => setMobileMenuOpen(false)}>Catalogue</a><a href="#methode" onClick={() => setMobileMenuOpen(false)}>Comment commander</a><a href="#pro" onClick={() => setMobileMenuOpen(false)}>Espace professionnel</a><a href="#contact" onClick={() => setMobileMenuOpen(false)}>Contact</a><div className="mobile-menu-actions">{signedInRole === 'CUSTOMER' && <button onClick={() => { setOrderCenterInitialView('orders'); setOrderCenterOpen(true); setMobileMenuOpen(false); }}>Mon compte</button>}{(signedInRole === 'SUPPLIER' || signedInRole === 'RESELLER') && <button onClick={() => { navigate('/partner'); setMobileMenuOpen(false); }}>Mon espace professionnel</button>}{signedInRole === 'ADMIN' && <button onClick={() => { setAdminOpen(true); navigate('/admin'); setMobileMenuOpen(false); }}>Administration</button>}{signedInAs ? <button onClick={() => { logout(); setMobileMenuOpen(false); }}>Déconnexion</button> : <><button onClick={() => { setAuthError(''); setAuthMessage(''); setAuthMode('login'); setMobileMenuOpen(false); }}>Connexion</button><button onClick={() => { setAuthError(''); setAuthMessage(''); setAuthMode('register'); setMobileMenuOpen(false); }}>Créer un compte</button></>}</div></nav><div className="nav-actions">{signedInRole !== 'ADMIN' && <button className="login-btn cart-nav" onClick={() => { setOrderCenterInitialView('cart'); setOrderCenterOpen(true); }}><ShoppingCart size={16}/> Panier ({cart.reduce((count, line) => count + line.quantity, 0)})</button>}{signedInRole === 'CUSTOMER' && <button className="login-btn" onClick={() => { setOrderCenterInitialView('orders'); setOrderCenterOpen(true); }}>Mon compte</button>}{(signedInRole === 'RESELLER' || signedInRole === 'SUPPLIER') && <button className="login-btn" onClick={() => navigate('/partner')}>Mon espace pro</button>}{signedInAs && !isAdminPage && <NotificationCenter/>}{signedInAs ? <><span className="signed-in">{signedInAs}</span>{signedInRole === 'ADMIN' && <button className="login-btn" onClick={() => { setAdminOpen(true); navigate('/admin'); }}>Administration</button>}<button className="login-btn" onClick={logout}>Déconnexion</button></> : <><button className="login-btn" onClick={() => { setAuthError(''); setAuthMessage(''); setAuthMode('login'); }}>Connexion</button><button className="account-btn" onClick={() => { setAuthError(''); setAuthMessage(''); setAuthMode('register'); }}>Créer un compte <ArrowUpRight size={15}/></button></>}<button className="mobile-menu" aria-label={mobileMenuOpen ? 'Fermer le menu' : 'Ouvrir le menu'} aria-expanded={mobileMenuOpen} aria-controls="mobile-site-menu" onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? <X size={25}/> : <Menu size={25}/>}</button></div></div></header>
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
    {orderCenterOpen && signedInRole !== 'ADMIN' && <OrderCenter cart={cart} setCart={setCart} initialView={orderCenterInitialView} onClose={() => setOrderCenterOpen(false)} onLogin={() => { setOrderCenterOpen(false); setAuthError(''); setAuthMessage(''); setAuthMode('login'); }} signedIn={signedInRole === 'CUSTOMER' || signedInRole === 'RESELLER' || signedInRole === 'SUPPLIER'}/>}{authMode && <div className="auth-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthMode(null); }}><section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="auth-close" aria-label="Fermer" onClick={() => setAuthMode(null)}>×</button><div className="auth-eyebrow">GHORBEL AUTOMATIVE SUPPLY GROUP</div><h2 id="auth-title">{authMode === 'login' ? 'Connexion' : authMode === 'register' ? 'Créer un compte client' : authMode === 'forgot' ? 'Mot de passe oublié ?' : 'Choisir un nouveau mot de passe'}</h2><p className="auth-intro">{authMode === 'login' ? 'Connectez-vous à votre espace. Les partenaires utilisent les identifiants transmis par Ghorbel Automative Supply Group.' : authMode === 'register' ? 'Créez un compte client pour retrouver votre espace.' : authMode === 'forgot' ? 'Saisissez l’adresse e-mail associée à votre compte. Si le compte est éligible, vous recevrez un lien valable 30 minutes.' : 'Le nouveau mot de passe doit contenir au moins 8 caractères. Le lien ne peut être utilisé qu’une seule fois.'}</p><form className="auth-form" onSubmit={submitAuth}>{authMode === 'register' && <div className="auth-fields"><label>Prénom<input name="firstName" required maxLength={80}/></label><label>Nom<input name="lastName" required maxLength={80}/></label><label>Téléphone<input type="tel" name="phone" required autoComplete="tel" maxLength={24} placeholder="+216 …"/></label></div>}{authMode !== 'reset' && <label>Adresse e-mail<input type="email" name="email" required autoComplete="email" maxLength={254}/></label>}{(authMode === 'login' || authMode === 'register' || authMode === 'reset') && <label>{authMode === 'reset' ? 'Nouveau mot de passe' : 'Mot de passe'}<span className="auth-password-control"><input type={authPasswordVisible ? 'text' : 'password'} name="password" required minLength={authMode === 'reset' ? 8 : 1} maxLength={128} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}/><button type="button" aria-label={authPasswordVisible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} onClick={() => setAuthPasswordVisible((visible) => !visible)}>{authPasswordVisible ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span></label>}{authMode === 'register' && <label>Confirmer le mot de passe<span className="auth-password-control"><input type={authConfirmPasswordVisible ? 'text' : 'password'} name="confirmPassword" required minLength={1} maxLength={128} autoComplete="new-password"/><button type="button" aria-label={authConfirmPasswordVisible ? 'Masquer la confirmation' : 'Afficher la confirmation'} onClick={() => setAuthConfirmPasswordVisible((visible) => !visible)}>{authConfirmPasswordVisible ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span></label>}{authMode === 'reset' && <label>Confirmer le mot de passe<span className="auth-password-control"><input type={authConfirmPasswordVisible ? 'text' : 'password'} name="confirmPassword" required minLength={8} maxLength={128} autoComplete="new-password"/><button type="button" aria-label={authConfirmPasswordVisible ? 'Masquer la confirmation' : 'Afficher la confirmation'} onClick={() => setAuthConfirmPasswordVisible((visible) => !visible)}>{authConfirmPasswordVisible ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span></label>}{authError && <div className="auth-alert error">{authError}</div>}{authMessage && <div className="auth-alert success">{authMessage}</div>}{authMode === 'login' && <button type="button" className="auth-forgot" onClick={() => { setAuthError(''); setAuthMessage(''); setAuthMode('forgot'); }}>Mot de passe oublié ?</button>}<button className="auth-submit" type="submit" disabled={authBusy}>{authBusy ? 'Veuillez patienter…' : authMode === 'login' ? 'Se connecter' : authMode === 'register' ? 'Créer mon compte' : authMode === 'forgot' ? 'Envoyer le lien' : 'Modifier le mot de passe'}</button></form><p className="auth-switch">{authMode === 'login' ? 'Vous êtes partenaire et vous n’avez pas reçu vos accès ?' : authMode === 'register' ? 'Vous avez déjà un compte ?' : 'Vous vous souvenez de votre mot de passe ?'} <button onClick={() => { setAuthError(''); setAuthMessage(''); if (authMode === 'login') { setAuthMode(null); document.getElementById('pro')?.scrollIntoView({ behavior: 'smooth' }); } else setAuthMode('login'); }}>{authMode === 'login' ? 'Nous contacter' : 'Se connecter'}</button></p></section></div>}{adminOpen && <div className="auth-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isAdminPage) setAdminOpen(false); }}><section className="admin-dialog" role="main" aria-labelledby="admin-title"><button className="auth-close" aria-label={isAdminPage ? 'Retour au site' : 'Fermer'} onClick={() => { setAdminOpen(false); if (isAdminPage) navigate('/'); }}>{isAdminPage ? '← Retour au site' : '×'}</button><div className="auth-eyebrow">ADMINISTRATION</div><h2 id="admin-title">Gestion de la plateforme</h2><p className="admin-dashboard-intro">Centre de contrôle GHORBEL Ghorbel Automative Supply Group · Activité réelle issue de PostgreSQL.</p><div className="admin-topbar"><div className="admin-topbar-context"><Gauge size={16}/><span>Centre de contrôle · données PostgreSQL</span></div><div className="admin-topbar-actions"><NotificationCenter/><span className="admin-profile-name">{signedInAs}</span><button className="admin-logout" onClick={logout}>Déconnexion</button></div></div><div className="admin-workspace"><aside className="admin-sidebar"><span className="admin-sidebar-caption">ESPACE DE GESTION</span><nav className="admin-shortcuts"><a href="/admin/dashboard" className={adminPage === "dashboard" ? 'active' : ''}>Tableau de bord</a><a href="/admin/users" className={adminPage === "users" ? 'active' : ''}>Utilisateurs</a><a href="/admin/buyers" className={adminPage === "buyers" ? 'active' : ''}>Acheteurs</a><a href="/admin/partners" className={adminPage === "partners" ? 'active' : ''}>Partenaires</a><a href="/admin/offers" className={adminPage === "offers" ? 'active' : ''}>Offres à valider</a><a href="/admin/stock" className={adminPage === "stock" ? 'active' : ''}>Stocks</a><a href="/admin/pricing" className={adminPage === "pricing" ? 'active' : ''}>Prix et marges</a><a href="/admin/orders" className={adminPage === "orders" ? 'active' : ''}>Commandes</a><a href="/admin/invoices" className={adminPage === "invoices" ? 'active' : ''}>Factures fournisseurs</a><a href="/admin/catalog" className={adminPage === "catalog" ? 'active' : ''}>Catalogue et imports</a><a href="/admin/contacts" className={adminPage === "contacts" ? 'active' : ''}>Messages clients</a><a href="/admin/audit" className={adminPage === "audit" ? 'active' : ''}>Journal des actions</a><a href="/admin/settings" className={adminPage === "settings" ? 'active' : ''}>Coordonnées bancaires</a></nav></aside><div className="admin-main" data-admin-page={adminPage}>{adminPage === "dashboard" && <AdminDashboard/>}{adminPage === "contacts" && <AdminContactInbox/>}{adminPage === "settings" && <AdminCompanyPaymentSettings/>}{adminPage === "partners" && <><div className="admin-section" id="admin-partners"><h3>Créer un compte partenaire</h3><p className="auth-intro">Les fournisseurs et revendeurs n’ouvrent pas eux-mêmes de compte. Créez leurs accès ici après avoir convenu du partenariat.</p><form className="partner-create-form" onSubmit={createPartnerAccount}><div className="partner-create-grid"><label>Type de partenaire<select name="role" defaultValue="SUPPLIER"><option value="SUPPLIER">Fournisseur</option><option value="RESELLER">Revendeur / garage</option></select></label><label>Entreprise<input name="companyName" required maxLength={160}/></label><label>Prénom<input name="firstName" required maxLength={80}/></label><label>Nom<input name="lastName" required maxLength={80}/></label><label>Téléphone<input name="phone" type="tel" required maxLength={24} placeholder="+216 …"/></label><label>E-mail de connexion<input name="email" type="email" required maxLength={254}/></label><label>Mot de passe initial<input name="password" type="password" required maxLength={128}/></label></div>{partnerCreateError && <div className="auth-alert error">{partnerCreateError}</div>}{partnerCreateMessage && <div className="auth-alert success">{partnerCreateMessage}</div>}<button className="auth-submit" disabled={partnerCreating}>{partnerCreating ? 'Création…' : 'Créer le compte et activer l’accès'}</button></form></div><div className="admin-section" id="admin-partners-list"><h3>Comptes partenaires</h3><p className="auth-intro">Créez leurs accès, suspendez ou réactivez les comptes partenaires.</p>{adminError && <div className={`auth-alert ${adminError.includes('importée') ? 'success' : 'error'}`}>{adminError}</div>}{adminAccounts.length === 0 ? <div className="admin-empty">Aucune demande en attente.</div> : <div className="admin-list">{adminAccounts.map((account) => <article className="admin-account" key={account.id}><div><strong>{account.companyName || `${account.firstName} ${account.lastName}`}</strong><span>{account.email} · {account.phone || 'Sans téléphone'} · {account.role === 'SUPPLIER' ? 'Fournisseur' : 'Revendeur'}</span><small>Reçue le {new Date(account.createdAt).toLocaleDateString('fr-FR')}</small></div><div className="admin-actions">{account.status === 'ACTIVE' ? <button className="decline" disabled={adminBusy === account.id} onClick={() => updateAccountStatus(account.id, 'SUSPENDED')}>Suspendre</button> : <button disabled={adminBusy === account.id} onClick={() => updateAccountStatus(account.id, 'ACTIVE')}>Activer</button>}</div></article>)}</div>}</div></>}{adminPage === "users" && <AdminUsers/>}{adminPage === "buyers" && <AdminUsers buyerOnly/>}{adminPage === "offers" && <div className="admin-section" id="admin-offers"><h3>Offres partenaires à traiter</h3><p className="auth-intro">Les coûts d’achat restent réservés à l’administration et au partenaire concerné.</p>{supplierOffers.filter((offer) => offer.status === 'PENDING' || offer.pendingPurchasePrice != null || offer.fitmentSuggestions.some((item) => item.status === 'PENDING')).length === 0 ? <div className="admin-empty">Aucune offre en attente.</div> : <div className="admin-list">{supplierOffers.filter((offer) => offer.status === 'PENDING' || offer.pendingPurchasePrice != null || offer.fitmentSuggestions.some((item) => item.status === 'PENDING')).map((offer) => <article className="admin-account" key={offer.id}><div><strong>{offer.product.name}</strong><span>{offer.supplier.companyName || offer.supplier.email} · {offer.supplierSku}{offer.product.references[0] ? ` · ${offer.product.references[0].value}` : ''}</span><small>{Number(offer.purchasePrice).toFixed(3)} TND · TVA fournisseur {Number(offer.purchaseVatRate).toFixed(2)}%</small>{offer.fitmentSuggestions.map((suggestion) => <div className="fitment-review" key={suggestion.id}><strong>{fitmentSuggestionLabel(suggestion)}</strong>{suggestion.status === 'PENDING' ? <div><input aria-label="Source de vérification de compatibilité" placeholder="Source vérifiable (catalogue, document…)" value={fitmentSources[suggestion.id] || ''} onChange={(event) => setFitmentSources((values) => ({ ...values, [suggestion.id]: event.target.value }))}/><button disabled={adminBusy === suggestion.id || offer.status !== 'APPROVED'} onClick={() => void reviewFitmentSuggestion(suggestion, 'VERIFIED')}>Valider la compatibilité</button><button className="decline" disabled={adminBusy === suggestion.id} onClick={() => void reviewFitmentSuggestion(suggestion, 'REJECTED')}>Refuser</button>{offer.status !== 'APPROVED' && <small>Approuvez d’abord l’offre pour valider la compatibilité.</small>}</div> : <small>{suggestion.status === 'VERIFIED' ? `Compatibilité vérifiée · ${suggestion.source || 'source enregistrée'}` : 'Compatibilité refusée'}</small>}</div>)}</div><div className="admin-actions">{offer.pendingPurchasePrice != null && <><button disabled={adminBusy === offer.id} onClick={() => void reviewSupplierOfferPrice(offer.id, 'APPROVE')}>Approuver la hausse · {Number(offer.pendingPurchasePrice).toFixed(3)} TND</button><button className="decline" disabled={adminBusy === offer.id} onClick={() => void reviewSupplierOfferPrice(offer.id, 'REJECT')}>Refuser la hausse</button></>}{offer.status === 'PENDING' && <><button disabled={adminBusy === offer.id} onClick={() => updateSupplierOfferStatus(offer.id, 'APPROVED')}>Approuver l’offre</button><button className="decline" disabled={adminBusy === offer.id} onClick={() => updateSupplierOfferStatus(offer.id, 'REJECTED')}>Refuser l’offre</button></>}</div></article>)}</div>}</div>}{adminPage === "stock" && <StockManagement/>}{adminPage === "pricing" && <PricingManagement/>}{adminPage === "orders" && <AdminOrderManagement/>}{adminPage === "invoices" && <AdminSupplierInvoices/>}{adminPage === "audit" && <AdminAuditLogs/>}{adminPage === "catalog" && <><AdminProductCatalog/><div className="admin-section" id="admin-vehicle-entry"><h3>Ajouter un véhicule au référentiel</h3><p className="auth-intro">Ajoutez une marque, un modèle, une génération et sa plage d’années, puis complétez si possible la motorisation et la version. L’entrée sera disponible dans la recherche client.</p><form className="partner-create-form" onSubmit={saveAdminVehicleEntry}><div className="partner-create-grid"><label>Marque<input name="makeName" required maxLength={100} placeholder="Volkswagen"/></label><label>Modèle<input name="modelName" required maxLength={100} placeholder="Polo"/></label><label>Type de véhicule<select name="vehicleCategory" defaultValue="Voiture particulière"><option>Voiture particulière</option><option>Utilitaire léger</option><option>Pick-up</option><option>Camion</option><option>Bus / Autocar</option><option>Motocycle</option><option>Autre</option></select></label><label>Génération<input name="generationName" required maxLength={120} placeholder="Polo VIII"/></label><label>Année de début<input name="yearFrom" type="number" min="1900" max="2100" required/></label><label>Année de fin<input name="yearTo" type="number" min="1900" max="2100"/></label><label>Motorisation<input name="engineName" maxLength={120} placeholder="1.0 TSI"/></label><label>Code moteur<input name="engineCode" maxLength={80}/></label><label>Carburant<input name="fuel" maxLength={40} placeholder="Essence, diesel, électrique…"/></label><label>Cylindrée (cm³)<input name="displacementCc" type="number" min="50" max="30000"/></label><label>Puissance (kW)<input name="powerKw" type="number" min="1" max="5000"/></label><label>Version<input name="variantName" maxLength={120} placeholder="Life, GTI…"/></label><label>Carrosserie<input name="bodyStyle" maxLength={80} placeholder="Hayon, berline, tracteur…"/></label><label>Transmission<input name="transmission" maxLength={80}/></label><label>Motricité (traction, propulsion, 4x4)<input name="drivetrain" maxLength={80}/></label><label>Source (facultative)<input name="source" maxLength={240} placeholder="Catalogue constructeur"/></label><label>Référence de source<input name="sourceReference" maxLength={500}/></label></div>{vehicleCatalogError && <div className="auth-alert error">{vehicleCatalogError}</div>}{vehicleCatalogMessage && <div className="auth-alert success">{vehicleCatalogMessage}</div>}<button className="auth-submit" disabled={vehicleCatalogBusy}>{vehicleCatalogBusy ? 'Ajout…' : 'Ajouter au référentiel'}</button></form></div><VehicleCatalogReview onReviewed={() => { void makes.refetch(); }}/><VehicleCatalogImporter onImported={() => { void makes.refetch(); void refreshImportHistory(); }}/><div className="admin-section" id="admin-import"><h3>Importer le catalogue CSV</h3><p className="auth-intro">Prévisualisez les lignes avant l’import. Les données véhicule ne seront publiées comme vérifiées que si verified vaut true et qu’une source est indiquée. Un même SKU peut apparaître sur plusieurs lignes pour ses références et compatibilités, avec le même nom de pièce.</p><div className="import-toolbar"><a href="/catalog-import-template.csv" download>Télécharger le modèle CSV</a><label className="import-file">Choisir un fichier<input type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setImportPreview(null); if (file.size > 2_000_000) { setAdminError('Le fichier dépasse la limite de 2 Mo. Répartissez le catalogue en plusieurs imports.'); return; } setAdminError(''); setImportFileName(file.name); void file.text().then(setImportCsv); } }}/></label></div><textarea className="import-editor" value={importCsv} onChange={(event) => { setImportCsv(event.target.value); setImportPreview(null); }} placeholder="Chargez un CSV ou collez son contenu ici…" spellCheck={false}/><div className="import-footer"><span>{importFileName} · jusqu’à 2 Mo et 2 000 lignes · une référence ou compatibilité par ligne</span><button className="auth-submit import-preview-button" disabled={importBusy || !importCsv.trim()} onClick={previewCatalogImport}>{importBusy ? 'Traitement…' : 'Prévisualiser'}</button></div>{importPreview && <div className="import-preview"><div className="import-summary">{importPreview.acceptedRows} valide(s) · {importPreview.rejectedRows} avec erreur(s)</div><div className="import-preview-rows">{importPreview.rows.slice(0, 50).map((row) => <div className={`import-preview-row ${row.errors.length ? 'invalid' : ''}`} key={`${row.line}-${row.sku}`}><b>L{row.line}</b><span>{row.sku} · {row.name}</span><small>{row.errors.length ? row.errors.join(' ') : ([row.make, row.model, row.generation, row.yearFrom && (row.yearFrom + '–' + (row.yearTo || '…')), row.engineCode || row.engine, row.fuel, row.displacementCc && (row.displacementCc + ' cm³'), row.powerKw && (row.powerKw + ' kW'), row.variant, row.bodyStyle, row.transmission, row.drivetrain, row.source && 'Source : ' + row.source, row.sourceReference].filter(Boolean).join(' · ') || 'Pièce seule') + (row.verified ? ' · Vérifié' : ' · Démonstration')}</small></div>)}</div>{importPreview.previewTruncated && <small>Aperçu limité aux 50 premières lignes sur {importPreview.rowCount}.</small>}<button className="auth-submit import-confirm-button" disabled={importBusy || importPreview.acceptedRows === 0} onClick={commitCatalogImport}>{importBusy ? 'Import en cours…' : `Confirmer l’import de ${importPreview.acceptedRows} ligne(s)`}</button></div>}</div><div className="admin-section" id="admin-history"><h3>Historique des imports</h3>{importHistory.length === 0 ? <div className="admin-empty">Aucun import pour le moment.</div> : <div className="import-history">{importHistory.map((job) => <div className="import-history-row" key={job.id}><span>{job.fileName}</span><small>{new Date(job.createdAt).toLocaleString('fr-FR')}</small><b>{job.acceptedRows}/{job.rowCount} · {job.status === 'COMPLETED' ? 'Terminé' : 'Prévisualisé'}</b></div>)}</div>}</div></>}</div></div></section></div>}
  </div>;
}

type FitmentDraft = { key: string; mode: 'catalog' | 'manual'; makeId: string; modelId: string; generationId: string; engineId: string; variantId: string; year: string; makeName: string; modelName: string; generationName: string; vehicleCategory: string; yearFrom: string; yearTo: string; engineName: string; engineCode: string; fuel: string; displacementCc: string; powerKw: string; variantName: string; bodyStyle: string; transmission: string; drivetrain: string };
const newFitmentDraft = (): FitmentDraft => ({ key: crypto.randomUUID(), mode: 'catalog', makeId: '', modelId: '', generationId: '', engineId: '', variantId: '', year: '', makeName: '', modelName: '', generationName: '', vehicleCategory: 'Voiture particulière', yearFrom: '', yearTo: '', engineName: '', engineCode: '', fuel: '', displacementCc: '', powerKw: '', variantName: '', bodyStyle: '', transmission: '', drivetrain: '' });

type PartnerOffer = { id:string;supplierSku:string;purchasePrice:string|number;pendingPurchasePrice?:string|number|null;purchaseVatRate:string|number;status:string;archivedAt?:string|null;product:{name:string;description?:string|null;category?:string|null;pieceBrand?:string|null;images?:string[];references:{value:string;type:string}[];compatibilities?:{generationId:string;engineId?:string|null;variantId?:string|null;yearFrom:number;yearTo:number|null;generation:{id:string;name:string;model:{id:string;name:string;category?:string|null;make:{id:string;name:string}}};engine?:{id:string;name:string;engineCode?:string|null;fuel?:string|null;displacementCc?:number|null;powerKw?:number|null}|null;variant?:{id:string;name:string;bodyStyle?:string|null;transmission?:string|null;drivetrain?:string|null}|null}[]};fitmentSuggestions?:PartnerFitmentSuggestion[] };
type PartnerDashboardSummary = { offers: { total: number; pending: number; approved: number; rejected: number; archived: number }; stock: { outOfStock: number; lowStock: number }; orders: { count: number; confirmedPurchaseTotal: string }; pendingInvoices: number; recentActivity: { id: string; label: string; createdAt: string }[] };
type SupplierPriceHistoryEvent = { id: string; action: string; previousPurchasePrice: string | null; effectivePurchasePrice: string | null; requestedPurchasePrice: string | null; pendingApproval: boolean; createdAt: string };
const makeEditFitmentDrafts = (offer: PartnerOffer): FitmentDraft[] => {
  const live = offer.product.compatibilities ?? [];
  const drafts: FitmentDraft[] = live.map((item) => ({ ...newFitmentDraft(), mode: 'catalog', makeId: item.generation.model.make.id, modelId: item.generation.model.id, generationId: item.generationId, engineId: item.engineId || '', variantId: item.variantId || '', year: String(item.yearFrom), yearTo: item.yearTo && item.yearTo !== item.yearFrom ? String(item.yearTo) : '', makeName: item.generation.model.make.name, modelName: item.generation.model.name, generationName: item.generation.name, vehicleCategory: item.generation.model.category || 'Voiture particulière', engineName: item.engine?.name || '', engineCode: item.engine?.engineCode || '', fuel: item.engine?.fuel || '', displacementCc: item.engine?.displacementCc ? String(item.engine.displacementCc) : '', powerKw: item.engine?.powerKw ? String(item.engine.powerKw) : '', variantName: item.variant?.name || '', bodyStyle: item.variant?.bodyStyle || '', transmission: item.variant?.transmission || '', drivetrain: item.variant?.drivetrain || '' }));
  for (const item of offer.fitmentSuggestions ?? []) {
    if (live.some((compatibility) => compatibility.generationId === item.generationId && (compatibility.engineId || null) === (item.engineId || null) && compatibility.yearFrom === item.year && (compatibility.yearTo ?? compatibility.yearFrom) === (item.yearTo ?? item.year))) continue;
    drafts.push({ ...newFitmentDraft(), mode: item.generationId ? 'catalog' : 'manual', makeId: item.generation?.model.make.id || '', modelId: item.generation?.model.id || '', generationId: item.generationId || '', engineId: item.engineId || '', variantId: item.variantId || '', year: item.generationId ? String(item.year) : '', yearTo: item.yearTo && item.yearTo !== item.year ? String(item.yearTo) : '', makeName: item.makeName || item.generation?.model.make.name || '', modelName: item.modelName || item.generation?.model.name || '', generationName: item.generationName || item.generation?.name || '', vehicleCategory: item.vehicleCategory || item.generation?.model.category || 'Voiture particulière', yearFrom: item.generationId ? '' : String(item.year), engineName: item.engineName || item.engine?.name || '', engineCode: item.engineCode || item.engine?.engineCode || '', fuel: item.fuel || item.engine?.fuel || '', displacementCc: item.displacementCc ? String(item.displacementCc) : '', powerKw: item.powerKw ? String(item.powerKw) : '', variantName: item.variantName || item.variant?.name || '', bodyStyle: item.bodyStyle || item.variant?.bodyStyle || '', transmission: item.transmission || item.variant?.transmission || '', drivetrain: item.drivetrain || '' });
  }
  return drafts;
};

function selectedGenerationYears(generations: Row[] | undefined, id: string): number[] {
  const generation = generations?.find((item) => item.id === id);
  if (!generation?.yearFrom) return [];
  const end = generation.yearTo ?? new Date().getFullYear();
  if (end - generation.yearFrom > 80) return [];
  return Array.from({ length: end - generation.yearFrom + 1 }, (_, index) => end - index);
}

export default App;
