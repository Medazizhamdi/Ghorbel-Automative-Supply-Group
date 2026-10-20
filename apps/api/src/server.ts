import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { PrismaClient, DataStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { supplierInvoiceLines, supplierOrderScope, supplierPurchaseTotals } from './supplier-order.logic.js';
import { createEmailDelivery } from './email-delivery.js';

// Local development keeps .env at the monorepo root; Render injects env vars.
try {
  process.loadEnvFile('../../.env');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const prisma = new PrismaClient();
const app = express();
const workingDirectory = process.cwd();
const apiDirectory = path.basename(workingDirectory) === 'api' && path.basename(path.dirname(workingDirectory)) === 'apps' ? workingDirectory : path.resolve(workingDirectory, 'apps/api');
const uploadsDirectory = path.resolve(process.env.UPLOADS_DIR ?? path.join(apiDirectory, 'uploads'));
const port = Number(process.env.API_PORT ?? process.env.PORT ?? 10000);
const webOrigins = (process.env.WEB_ORIGIN ?? 'http://localhost:5174').split(',').map((s) => s.trim());
const scrypt = promisify(scryptCallback);
const tokenSecret = process.env.JWT_SECRET ?? randomBytes(32).toString('hex');
const guestEmailSecretKey = createHash('sha256').update(process.env.GUEST_TOKEN_ENCRYPTION_KEY ?? tokenSecret).digest();
const encryptEmailSecret = (value: string) => {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', guestEmailSecretKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
};
const decryptEmailSecret = (value: string) => {
  const [iv, tag, encrypted] = value.split('.');
  const decipher = createDecipheriv('aes-256-gcm', guestEmailSecretKey, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
};
const emailDelivery = createEmailDelivery();

const enqueueNotification = async (tx: Prisma.TransactionClient, input: { userId: string | null; emailTo: string; eventKey: string; title: string; message: string; link?: string; emailSecretEncrypted?: string }) => tx.notification.upsert({
  where: { eventKey: input.eventKey },
  create: { ...input, emailStatus: 'QUEUED' },
  update: {},
  select: { id: true },
});
const contactInboxEmail = process.env.CONTACT_INBOX_EMAIL?.trim() || 'ghorbelautomotivesupplygroup@gmail.com';
const contactRateLimits = new Map<string, { count: number; resetAt: number }>();

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
let emailWorkerBusy = false;
const deliverEmailOutbox = async () => {
  if (!emailDelivery.enabled || emailWorkerBusy) return;
  emailWorkerBusy = true;
  const now = new Date();
  try {
    await prisma.notification.updateMany({ where: { emailStatus: 'PROCESSING', emailLockedAt: { lt: new Date(now.getTime() - 5 * 60_000) } }, data: { emailStatus: 'QUEUED', emailLockedAt: null, emailNextAttemptAt: now } });
    const queue = await prisma.notification.findMany({ where: { emailStatus: 'QUEUED', emailNextAttemptAt: { lte: now } }, orderBy: { createdAt: 'asc' }, take: 10 });
    for (const item of queue) {
      const claimed = await prisma.notification.updateMany({ where: { id: item.id, emailStatus: 'QUEUED', emailNextAttemptAt: { lte: now } }, data: { emailStatus: 'PROCESSING', emailAttempts: { increment: 1 }, emailLockedAt: now } });
      if (!claimed.count) continue;
      const attempt = item.emailAttempts + 1;
      try {
        const baseUrl = process.env.WEB_ORIGIN?.split(',')[0]?.trim().replace(/\/$/, '');
        const isPasswordReset = item.eventKey.startsWith('password.reset:');
        const isCustomerWelcome = item.eventKey.startsWith('welcome.customer:');
        const isPartnerWelcome = item.eventKey.startsWith('welcome.partner.');
        const isWelcome = isCustomerWelcome || isPartnerWelcome;
        const emailSecret = item.emailSecretEncrypted ? decryptEmailSecret(item.emailSecretEncrypted) : null;
        const href = isPasswordReset
          ? (baseUrl && emailSecret ? `${baseUrl}/reset-password?token=${encodeURIComponent(emailSecret)}` : undefined)
          : (item.link && baseUrl ? `${baseUrl}${item.link}` : undefined);
        if (isPasswordReset && !href) throw new Error('Lien de réinitialisation indisponible ; vérifiez WEB_ORIGIN et le jeton e-mail.');
        const secretText = emailSecret && !isPasswordReset ? `\n\nCode privé de suivi (valable 30 jours) : ${emailSecret}\nConservez-le avec votre numéro de commande.` : '';
        const secretHtml = emailSecret && !isPasswordReset ? `<p style="padding:14px;background:#eef5ff;border-radius:8px"><strong>Code privé de suivi (valable 30 jours)</strong><br><code>${escapeHtml(emailSecret)}</code><br>Conservez-le avec votre numéro de commande.</p>` : '';
        let orderSummaryText = '';
        let orderSummaryHtml = '';
        let attachments: { filename: string; content: Buffer; contentType: string }[] = [];
        const orderEmailMatch = /^order\.created\.(?:customer|guest):([0-9a-f-]{36})$/i.exec(item.eventKey);
        if (orderEmailMatch) {
          const order = await prisma.order.findUnique({
            where: { id: orderEmailMatch[1] },
            select: { orderNumber: true, invoiceNumber: true, invoicePdf: true, subtotalExclTax: true, vatTotal: true, totalInclTax: true, lines: { select: { productNameSnapshot: true, productSkuSnapshot: true, quantity: true, unitPriceExclTax: true, vatRateSnapshot: true, lineTotalInclTax: true }, orderBy: { createdAt: 'asc' } } },
          });
          if (!order?.invoicePdf || !order.invoiceNumber) throw new Error('La facture PDF de la commande est indisponible ; l’e-mail sera réessayé.');
          const amount = (value: Prisma.Decimal | number) => `${Number(value).toFixed(3)} TND`;
          const rowsText = order.lines.map((line) => `• ${line.productNameSnapshot} — Réf. ${line.productSkuSnapshot} — Qté ${line.quantity} — ${amount(line.unitPriceExclTax)} HT/unité — TVA ${Number(line.vatRateSnapshot).toFixed(2)} % — ${amount(line.lineTotalInclTax)} TTC`).join('\n');
          const rowsHtml = order.lines.map((line) => `<tr><td style="padding:9px;border-bottom:1px solid #e4eaf2">${escapeHtml(line.productNameSnapshot)}<br><small>Réf. ${escapeHtml(line.productSkuSnapshot)}</small></td><td style="padding:9px;border-bottom:1px solid #e4eaf2;text-align:center">${line.quantity}</td><td style="padding:9px;border-bottom:1px solid #e4eaf2;text-align:right">${amount(line.unitPriceExclTax)}</td><td style="padding:9px;border-bottom:1px solid #e4eaf2;text-align:center">${Number(line.vatRateSnapshot).toFixed(2)} %</td><td style="padding:9px;border-bottom:1px solid #e4eaf2;text-align:right">${amount(line.lineTotalInclTax)}</td></tr>`).join('');
          orderSummaryText = `\n\nRÉSUMÉ DE LA COMMANDE ${order.orderNumber}\n${rowsText}\n\nTotal HT : ${amount(order.subtotalExclTax)}\nTVA : ${amount(order.vatTotal)}\nTotal TTC : ${amount(order.totalInclTax)}\n\nVotre facture ${order.invoiceNumber} est jointe à cet e-mail.`;
          orderSummaryHtml = `<h3>Résumé de la commande ${escapeHtml(order.orderNumber)}</h3><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f2f6fc"><th style="padding:9px;text-align:left">Désignation / référence</th><th style="padding:9px">Qté</th><th style="padding:9px;text-align:right">PU HT</th><th style="padding:9px">TVA</th><th style="padding:9px;text-align:right">Total TTC</th></tr></thead><tbody>${rowsHtml}</tbody></table><div style="margin:16px 0 22px auto;max-width:260px"><p>Total HT : <strong>${amount(order.subtotalExclTax)}</strong></p><p>TVA : <strong>${amount(order.vatTotal)}</strong></p><p style="font-size:18px">Total TTC : <strong>${amount(order.totalInclTax)}</strong></p></div><p>La facture ${escapeHtml(order.invoiceNumber)} est jointe à cet e-mail.</p>`;
          attachments = [{ filename: `${order.invoiceNumber}.pdf`, content: Buffer.from(order.invoicePdf), contentType: 'application/pdf' }];
        }
        const welcomeGreeting = item.message.split('\n')[0] || 'Bienvenue';
        const welcomeContent = item.message.split('\n\n').slice(1).join('\n\n') || item.message;
        const welcomeButton = href ? `<a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 23px;border-radius:7px;background:#1263dc;color:#fff;text-decoration:none;font-weight:bold">${isPartnerWelcome ? 'Accéder à mon espace partenaire' : 'Découvrir le catalogue'}</a>` : '';
        const welcomeHtml = `<div style="margin:0;padding:32px 12px;background:#f1f5fb;font-family:Arial,Helvetica,sans-serif;color:#19324e"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:620px;margin:auto;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden"><tr><td style="padding:25px 32px;background:#0d2b4e;color:#fff"><div style="font-size:12px;letter-spacing:2px;font-weight:bold;color:#82c8ff">GHORBEL</div><div style="margin-top:5px;font-size:11px;letter-spacing:1px;color:#d8e8f8">AUTOMATIVE SUPPLY GROUP</div></td></tr><tr><td style="padding:34px 32px 14px"><div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#1263dc;font-weight:bold">${isPartnerWelcome ? 'Bienvenue dans notre réseau professionnel' : 'Bienvenue chez Ghorbel'}</div><h1 style="margin:12px 0 15px;font-size:27px;line-height:1.2;color:#132a46">${escapeHtml(welcomeGreeting)}</h1><p style="margin:0;color:#53677e;font-size:15px;line-height:1.75">${escapeHtml(welcomeContent).replace(/\n/g, '<br>')}</p><div style="margin:27px 0">${welcomeButton}</div>${isPartnerWelcome ? '<div style="padding:14px 16px;border-radius:8px;background:#f3f7fc;color:#61748a;font-size:12px;line-height:1.6">Votre adresse e-mail est votre identifiant de connexion. Pour votre sécurité, le mot de passe initial vous est communiqué séparément par l’administration.</div>' : '<div style="padding:14px 16px;border-radius:8px;background:#f3f7fc;color:#61748a;font-size:12px;line-height:1.6">Gardez cet e-mail pour retrouver facilement votre espace et vos prochaines commandes.</div>'}</td></tr><tr><td style="padding:18px 32px;border-top:1px solid #e8eef5;color:#8291a2;font-size:11px;line-height:1.6">Une question ? Écrivez à <a href="mailto:ghorbelautomotivesupplygroup@gmail.com" style="color:#1263dc">ghorbelautomotivesupplygroup@gmail.com</a><br>© Ghorbel Automative Supply Group · Tunisie</td></tr></table></div>`;
        const html = isWelcome ? welcomeHtml : `<div style="font-family:Arial,sans-serif;color:#18304c;max-width:700px;margin:auto"><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.message)}</p>${orderSummaryHtml}${secretHtml}${href ? `<p><a href="${escapeHtml(href)}" style="color:#1263dc">Ouvrir mon espace Ghorbel Automative Supply Group</a></p>` : ''}<hr><small>Ghorbel Automative Supply Group</small></div>`;
        await emailDelivery.send({ to: item.emailTo, subject: item.title, text: `${item.message}${orderSummaryText}${secretText}${href ? `\n\n${href}` : ''}`, html, attachments, messageId: `<${createHash('sha256').update(item.eventKey).digest('hex')}@autopieces360>` });
        await prisma.notification.update({ where: { id: item.id }, data: { emailStatus: 'SENT', emailSentAt: new Date(), emailLockedAt: null, emailLastError: null, emailSecretEncrypted: null } });
      } catch (error) {
        const failed = attempt >= 5;
        const backoffMs = Math.min(60 * 60_000, 15_000 * (2 ** (attempt - 1)));
        const message = error instanceof Error ? error.message.slice(0, 1000) : 'Échec de livraison e-mail inconnu.';
        await prisma.notification.update({ where: { id: item.id }, data: { emailStatus: failed ? 'FAILED' : 'QUEUED', emailLockedAt: null, emailNextAttemptAt: new Date(Date.now() + backoffMs), emailLastError: message } });
        console.error(JSON.stringify({ event: 'email_delivery_failed', notificationId: item.id, attempt, final: failed, error: message }));
      }
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'email_outbox_worker_failed', error: error instanceof Error ? error.message : 'Erreur inconnue.' }));
  } finally { emailWorkerBusy = false; }
};

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: webOrigins, methods: ['GET', 'POST', 'PATCH', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Bootstrap-Key'] }));
app.use(express.json({ limit: '8mb' }));
app.use('/uploads', express.static(uploadsDirectory, {
  fallthrough: false,
  index: false,
  maxAge: '7d',
  immutable: true,
  setHeaders: (response) => response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
}));

const authPayload = z.object({ sub: z.string().uuid(), role: z.enum(['ADMIN', 'SUPPLIER', 'RESELLER', 'CUSTOMER']), exp: z.number() });
type AuthenticatedRequest = Request & { user?: z.infer<typeof authPayload> };
const signToken = (payload: Omit<z.infer<typeof authPayload>, 'exp'>) => {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 })).toString('base64url');
  const signature = createHmac('sha256', tokenSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
};
const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const token = req.get('authorization')?.match(/^Bearer ([\w.-]+)$/)?.[1];
  if (!token) return res.status(401).json({ error: 'Authentification requise.' });
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra) return res.status(401).json({ error: 'Session invalide.' });
  const expected = createHmac('sha256', tokenSecret).update(body).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, 'base64url'); } catch { return res.status(401).json({ error: 'Session invalide.' }); }
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return res.status(401).json({ error: 'Session invalide.' });
  try {
    const parsed = authPayload.safeParse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
    if (!parsed.success || parsed.data.exp <= Date.now() / 1000) return res.status(401).json({ error: 'Session expirée.' });
    req.user = parsed.data;
    next();
  } catch { return res.status(401).json({ error: 'Session invalide.' }); }
};
const optionalAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const token = req.get('authorization')?.match(/^Bearer ([\w.-]+)$/)?.[1];
  if (!token) return next();
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra) return res.status(401).json({ error: 'Session invalide.' });
  const expected = createHmac('sha256', tokenSecret).update(body).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return res.status(401).json({ error: 'Session invalide.' });
  try {
    const parsed = authPayload.safeParse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
    if (!parsed.success || parsed.data.exp <= Date.now() / 1000) return res.status(401).json({ error: 'Session expirée.' });
    const user = await prisma.user.findUnique({ where: { id: parsed.data.sub }, select: { status: true } });
    if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'Compte indisponible.' });
    req.user = parsed.data;
    return next();
  } catch (error) { next(error); }
};
const requireAdmin = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ error: 'Authentification requise.' });
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { role: true, status: true } });
    if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'Compte indisponible.' });
    if (user.role !== 'ADMIN') return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
    next();
  } catch (error) { next(error); }
};
const recordAudit = (tx: Prisma.TransactionClient, input: { actorId: string; action: string; entityType: string; entityId: string; details?: Prisma.InputJsonObject }) => tx.auditLog.create({
  data: { actorId: input.actorId, action: input.action, entityType: input.entityType, entityId: input.entityId, ...(input.details ? { details: input.details } : {}) },
  select: { id: true },
});

const normalizeCategory = (value: string | null | undefined) => (value ?? '').trim().toLocaleLowerCase('fr');
const marginPrice = (purchasePrice: number, percent: number) => (Math.round(purchasePrice * (1 + percent / 100) * 1000) / 1000).toFixed(3);
const pricingModeForNewProduct = async (tx: Prisma.TransactionClient, category: string | null | undefined): Promise<'MANUAL' | 'MARGIN'> => {
  const normalizedCategory = normalizeCategory(category);
  const [categoryRule, settings] = await Promise.all([
    normalizedCategory ? tx.categoryMargin.findUnique({ where: { category: normalizedCategory }, select: { id: true } }) : null,
    tx.companySettings.findUnique({ where: { id: 'default' }, select: { defaultMarginPercent: true } }),
  ]);
  return categoryRule || Number(settings?.defaultMarginPercent ?? 0) > 0 ? 'MARGIN' : 'MANUAL';
};
const recalculateMarginPrices = async (tx: Prisma.TransactionClient, filter?: { category?: string | null; productId?: string }) => {
  const settings = await tx.companySettings.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {}, select: { defaultMarginPercent: true } });
  const categoryRules = await tx.categoryMargin.findMany({ select: { category: true, marginPercent: true } });
  const rules = new Map(categoryRules.map((rule) => [normalizeCategory(rule.category), Number(rule.marginPercent)]));
  const products = await tx.product.findMany({
    where: { pricingMode: 'MARGIN', ...(filter?.productId ? { id: filter.productId } : {}), ...(filter && 'category' in filter ? { category: filter.category ?? null } : {}) },
    select: { id: true, category: true, marginPercent: true, supplierOffers: { where: { status: 'APPROVED', archivedAt: null, supplier: { status: 'ACTIVE' } }, orderBy: [{ purchasePrice: 'asc' }, { createdAt: 'asc' }], take: 1, select: { purchasePrice: true } } },
  });
  for (const product of products) {
    const cost = product.supplierOffers[0]?.purchasePrice;
    const percent = product.marginPercent !== null ? Number(product.marginPercent) : (rules.get(normalizeCategory(product.category)) ?? Number(settings.defaultMarginPercent));
    await tx.product.update({ where: { id: product.id }, data: { listPrice: cost ? marginPrice(Number(cost), percent) : null } });
  }
  return products.length;
};
const requirePartner = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ error: 'Authentification requise.' });
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { role: true, status: true } });
    if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'Compte indisponible.' });
    if (user.role !== 'SUPPLIER' && user.role !== 'RESELLER') return res.status(403).json({ error: 'Accès réservé aux partenaires.' });
    next();
  } catch (error) { next(error); }
};
app.post('/api/partner/uploads/images', requireAuth, requirePartner, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }), async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'Sélectionnez une image JPEG, PNG ou WebP.' });
    const buffer = req.body as Buffer;
    const mime = req.get('content-type')?.split(';')[0].trim().toLowerCase();
    const isJpeg = mime === 'image/jpeg' && buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng = mime === 'image/png' && buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isWebp = mime === 'image/webp' && buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    if (!isJpeg && !isPng && !isWebp) return res.status(415).json({ error: 'Le contenu du fichier ne correspond pas à une image JPEG, PNG ou WebP valide.' });
    const extension = isJpeg ? 'jpg' : isPng ? 'png' : 'webp';
    const filename = `${randomUUID()}.${extension}`;
    await mkdir(uploadsDirectory, { recursive: true });
    await writeFile(path.join(uploadsDirectory, filename), buffer, { flag: 'wx' });
    return res.status(201).json({ data: { url: `/uploads/${filename}`, mimeType: mime, fileSize: buffer.length } });
  } catch (error) { next(error); }
});
const requirePurchaser = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ error: 'Authentification requise.' });
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { role: true, status: true } });
    if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'Compte indisponible.' });
    if (user.role !== 'CUSTOMER' && user.role !== 'RESELLER' && user.role !== 'SUPPLIER') return res.status(403).json({ error: 'Seuls les clients et partenaires peuvent commander.' });
    next();
  } catch (error) { next(error); }
};
const passwordHash = async (password: string) => {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
};
const passwordMatches = async (password: string, stored: string) => {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
const authAttempts = new Map<string, { count: number; resetAt: number }>();
const authRateLimit = (req: Request, res: Response, next: NextFunction) => {
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  const attempt = authAttempts.get(key);
  if (!attempt || attempt.resetAt <= now) authAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
  else if (attempt.count >= 20) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
  else attempt.count += 1;
  next();
};

const registerSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128), firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(8).max(24).regex(/^\+?[0-9\s().-]+$/),
}).strict();
app.post('/api/auth/register', authRateLimit, async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Informations de compte invalides.', details: parsed.error.flatten() });
  try {
    const { password, ...data } = parsed.data;
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { ...data, passwordHash: await passwordHash(password), role: 'CUSTOMER', status: 'ACTIVE' }, select: { id: true, email: true, phone: true, firstName: true, lastName: true, role: true, status: true } });
      await enqueueNotification(tx, { userId: created.id, emailTo: created.email, eventKey: `welcome.customer:${created.id}`, title: 'Bienvenue chez Ghorbel Automative Supply Group', message: `Bonjour ${created.firstName},\n\nVotre compte client est prêt. Vous pouvez parcourir le catalogue, rechercher les pièces compatibles avec votre véhicule et retrouver vos commandes depuis votre espace.`, link: '/' });
      return created;
    });
    return res.status(201).json({ data: user, message: 'Compte client créé.' });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ error: 'Cette adresse e-mail est déjà utilisée.' });
    next(error);
  }
});

app.post('/api/auth/login', authRateLimit, async (req, res, next) => {
  const parsed = z.object({ email: z.string().trim().email().transform((value) => value.toLowerCase()), password: z.string().min(1).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Adresse e-mail ou mot de passe invalide.' });
  try {
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user || !(await passwordMatches(parsed.data.password, user.passwordHash))) return res.status(401).json({ error: 'Adresse e-mail ou mot de passe incorrect.' });
    if (user.status !== 'ACTIVE') return res.status(403).json({ error: user.status === 'PENDING' ? 'Compte en attente de validation.' : 'Compte suspendu.' });
    return res.json({ token: signToken({ sub: user.id, role: user.role }), expiresIn: 43200, user: { id: user.id, email: user.email, phone: user.phone, firstName: user.firstName, lastName: user.lastName, role: user.role, companyName: user.companyName } });
  } catch (error) { next(error); }
});

app.post('/api/auth/forgot-password', authRateLimit, async (req, res, next) => {
  const parsed = z.object({ email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  try {
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email }, select: { id: true, email: true, role: true, status: true } });
    // Keep the response identical for unknown, inactive, and admin accounts.
    if (user && user.role !== 'ADMIN' && user.status === 'ACTIVE') {
      const rawToken = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
        await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(now.getTime() + 30 * 60_000) } });
        await enqueueNotification(tx, {
          userId: user.id,
          emailTo: user.email,
          eventKey: `password.reset:${randomUUID()}`,
          title: 'Réinitialisation de votre mot de passe',
          message: 'Une demande de réinitialisation a été effectuée pour votre compte. Utilisez le bouton ci-dessous dans les 30 minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.',
          link: '/reset-password',
          emailSecretEncrypted: encryptEmailSecret(rawToken),
        });
      });
    }
    return res.json({ message: 'Si cette adresse correspond à un compte éligible, un lien de réinitialisation sera envoyé par e-mail.' });
  } catch (error) { next(error); }
});

app.post('/api/auth/reset-password', authRateLimit, async (req, res, next) => {
  const parsed = z.object({ token: z.string().min(32).max(128), password: z.string().min(8).max(128) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Le lien est invalide ou le nouveau mot de passe ne respecte pas les critères requis (8 à 128 caractères).' });
  try {
    const tokenHash = createHash('sha256').update(parsed.data.token).digest('hex');
    const token = await prisma.passwordResetToken.findUnique({ where: { tokenHash }, select: { id: true, userId: true, expiresAt: true, usedAt: true, user: { select: { role: true, status: true } } } });
    const now = new Date();
    if (!token || token.usedAt || token.expiresAt <= now || token.user.role === 'ADMIN' || token.user.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'Lien de réinitialisation invalide ou expiré.' });
    }
    const newPasswordHash = await passwordHash(parsed.data.password);
    const changed = await prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (claimed.count !== 1) return false;
      const updated = await tx.user.updateMany({ where: { id: token.userId, role: { not: 'ADMIN' }, status: 'ACTIVE' }, data: { passwordHash: newPasswordHash } });
      if (updated.count !== 1) throw new Error('RESET_ACCOUNT_INELIGIBLE');
      await tx.passwordResetToken.updateMany({ where: { userId: token.userId, usedAt: null }, data: { usedAt: now } });
      return true;
    });
    if (!changed) return res.status(400).json({ error: 'Lien de réinitialisation invalide ou expiré.' });
    return res.json({ message: 'Mot de passe modifié. Vous pouvez maintenant vous connecter.' });
  } catch (error) {
    if (error instanceof Error && error.message === 'RESET_ACCOUNT_INELIGIBLE') return res.status(400).json({ error: 'Lien de réinitialisation invalide ou expiré.' });
    next(error);
  }
});

app.post('/api/auth/bootstrap-admin', authRateLimit, async (req, res, next) => {
  const key = process.env.ADMIN_BOOTSTRAP_KEY;
  if (!key || key.length < 32) return res.status(503).json({ error: 'Initialisation administrateur désactivée. Configurez ADMIN_BOOTSTRAP_KEY (32 caractères minimum) au déploiement.' });
  const supplied = req.get('x-bootstrap-key') ?? '';
  const suppliedBuffer = Buffer.from(supplied);
  const keyBuffer = Buffer.from(key);
  if (suppliedBuffer.length !== keyBuffer.length || !timingSafeEqual(suppliedBuffer, keyBuffer)) return res.status(401).json({ error: 'Clé d’initialisation invalide.' });
  const parsed = registerSchema.omit({ phone: true }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Informations de compte invalides.', details: parsed.error.flatten() });
  try {
    const admins = await prisma.user.count({ where: { role: 'ADMIN' } });
    if (admins > 0) return res.status(409).json({ error: 'Un administrateur existe déjà. Cette initialisation ne peut être utilisée qu’une fois.' });
    const { password, ...data } = parsed.data;
    const user = await prisma.user.create({ data: { ...data, passwordHash: await passwordHash(password), role: 'ADMIN', status: 'ACTIVE' }, select: { id: true, email: true, role: true, status: true } });
    return res.status(201).json({ data: user, message: 'Administrateur initial créé. Supprimez ADMIN_BOOTSTRAP_KEY des variables de déploiement.' });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ error: 'Cette adresse e-mail est déjà utilisée.' });
    next(error);
  }
});

app.get('/api/auth/me', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub }, select: { id: true, email: true, phone: true, firstName: true, lastName: true, role: true, status: true, companyName: true, legalName: true, tradeName: true, businessAddress: true, businessCity: true, postalCode: true, taxIdentifier: true, commercialRegisterNumber: true, legalProfileStatus: true } });
    if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'Compte indisponible.' });
    return res.json({ data: user });
  } catch (error) { next(error); }
});

const partnerProfilePayload = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(1).max(24),
  companyName: z.string().trim().min(1).max(160),
  legalName: z.string().trim().max(160).optional(),
  tradeName: z.string().trim().max(160).optional(),
  businessAddress: z.string().trim().max(300).optional(),
  businessCity: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  taxIdentifier: z.string().trim().max(80).optional(),
  commercialRegisterNumber: z.string().trim().max(80).optional(),
}).strict();
app.patch('/api/partner/profile', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  const payload = partnerProfilePayload.safeParse(req.body);
  if (!payload.success) return res.status(400).json({ error: 'Informations de profil invalides.', details: payload.error.flatten() });
  try {
    const userId = req.user!.sub;
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id: userId }, select: { legalName: true, tradeName: true, businessAddress: true, businessCity: true, postalCode: true, taxIdentifier: true, commercialRegisterNumber: true } });
      const legalFields = ['legalName', 'tradeName', 'businessAddress', 'businessCity', 'postalCode', 'taxIdentifier', 'commercialRegisterNumber'] as const;
      const legalChanged = !!current && legalFields.some((field) => (current[field] || '') !== ((payload.data[field] || '').trim()));
      const data = { ...payload.data, ...Object.fromEntries(legalFields.map((field) => [field, payload.data[field]?.trim() || null])), ...(legalChanged ? { legalProfileStatus: 'PENDING' as const } : {}) };
      const user = await tx.user.update({ where: { id: userId }, data, select: { id: true, email: true, phone: true, firstName: true, lastName: true, role: true, status: true, companyName: true, legalName: true, tradeName: true, businessAddress: true, businessCity: true, postalCode: true, taxIdentifier: true, commercialRegisterNumber: true, legalProfileStatus: true } });
      await recordAudit(tx, { actorId: userId, action: 'PARTNER_PROFILE_UPDATED', entityType: 'USER', entityId: userId, details: { fields: Object.keys(payload.data) } });
      return user;
    });
    return res.json({ data: updated, message: 'Profil mis à jour.' });
  } catch (error) { next(error); }
});

const partnerPasswordPayload = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(1).max(128) }).strict();
app.patch('/api/partner/password', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  const payload = partnerPasswordPayload.safeParse(req.body);
  if (!payload.success) return res.status(400).json({ error: 'Mot de passe invalide.', details: payload.error.flatten() });
  try {
    const userId = req.user!.sub;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true, status: true } });
    if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'Compte indisponible.' });
    if (!(await passwordMatches(payload.data.currentPassword, user.passwordHash))) return res.status(400).json({ error: 'Le mot de passe actuel est incorrect.' });
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash: await passwordHash(payload.data.newPassword) } });
      await recordAudit(tx, { actorId: userId, action: 'PARTNER_PASSWORD_CHANGED', entityType: 'USER', entityId: userId });
    });
    return res.json({ message: 'Mot de passe modifié.' });
  } catch (error) { next(error); }
});

app.get('/api/notifications', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const excludedTitles = ['Nouveau message fournisseur', 'Réponse d’un partenaire', 'Réponse de GHORBEL'];
    const where = { userId: req.user!.sub, NOT: { title: { in: excludedTitles } } };
    const [items, unreadCount] = await prisma.$transaction([
      prisma.notification.findMany({ where, select: { id: true, title: true, message: true, link: true, readAt: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 30 }),
      prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);
    return res.json({ data: items, unreadCount });
  } catch (error) { next(error); }
});

app.patch('/api/notifications/read-all', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await prisma.notification.updateMany({ where: { userId: req.user!.sub, readAt: null }, data: { readAt: new Date() } });
    return res.json({ data: { markedRead: result.count } });
  } catch (error) { next(error); }
});

app.patch('/api/notifications/:id/read', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Notification invalide.' });
  try {
    const changed = await prisma.notification.updateMany({ where: { id: id.data, userId: req.user!.sub, readAt: null }, data: { readAt: new Date() } });
    if (!changed.count) return res.status(404).json({ error: 'Notification introuvable.' });
    return res.json({ data: { id: id.data, read: true } });
  } catch (error) { next(error); }
});

app.get('/api/admin/audit-logs', requireAuth, requireAdmin, async (req, res, next) => {
  const parsed = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().uuid().optional(), actorId: z.string().uuid().optional(), action: z.string().trim().min(2).max(80).optional(), entityType: z.string().trim().min(2).max(80).optional() }).strict().safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Filtres du journal invalides.' });
  try {
    const rows = await prisma.auditLog.findMany({
      where: { ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}), ...(parsed.data.action ? { action: parsed.data.action } : {}), ...(parsed.data.entityType ? { entityType: parsed.data.entityType } : {}) },
      ...(parsed.data.cursor ? { cursor: { id: parsed.data.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: parsed.data.limit + 1,
      select: { id: true, action: true, entityType: true, entityId: true, details: true, createdAt: true, actor: { select: { id: true, email: true, firstName: true, lastName: true, role: true } } },
    });
    const hasMore = rows.length > parsed.data.limit;
    const data = hasMore ? rows.slice(0, parsed.data.limit) : rows;
    return res.json({ data, nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null });
  } catch (error) { next(error); }
});

const contactMessagePayload = z.object({
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254),
  subject: z.string().trim().min(3).max(180),
  body: z.string().trim().min(10).max(5000),
  website: z.string().max(200).optional(),
}).strict();

app.post('/api/contact-messages', async (req, res, next) => {
  const parsed = contactMessagePayload.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Vérifiez le nom, l’e-mail, l’objet et le contenu du message.' });
  if (parsed.data.website?.trim()) return res.status(202).json({ data: { accepted: true } });
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const limit = contactRateLimits.get(ip);
  if (limit && limit.resetAt > now && limit.count >= 5) return res.status(429).json({ error: 'Trop de messages envoyés. Réessayez dans quelques minutes.' });
  const resetAt = !limit || limit.resetAt <= now ? now + 15 * 60_000 : limit.resetAt;
  if (!limit || limit.resetAt <= now) contactRateLimits.set(ip, { count: 1, resetAt });
  else limit.count += 1;
  if (contactRateLimits.size > 5000) for (const [key, value] of contactRateLimits) if (value.resetAt <= now) contactRateLimits.delete(key);
  try {
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.contactMessage.create({
        data: { fullName: parsed.data.fullName, email: parsed.data.email.toLowerCase(), subject: parsed.data.subject, body: parsed.data.body },
        select: { id: true, fullName: true, email: true, subject: true, body: true, createdAt: true },
      });
      await enqueueNotification(tx, {
        userId: null,
        emailTo: contactInboxEmail,
        eventKey: `contact.message.received:${created.id}`,
        title: `Nouveau message du site : ${created.subject}`,
        message: `De : ${created.fullName}\nE-mail : ${created.email}\nObjet : ${created.subject}\n\n${created.body}`,
        link: '/admin/contacts',
      });
      return created;
    });
    return res.status(201).json({ data: { id: message.id, accepted: true } });
  } catch (error) {
    // Failed database writes must not consume the visitor's contact-message quota.
    const currentLimit = contactRateLimits.get(ip);
    if (currentLimit?.resetAt === resetAt) {
      currentLimit.count = Math.max(0, currentLimit.count - 1);
      if (currentLimit.count === 0) contactRateLimits.delete(ip);
    }
    next(error);
  }
});

app.get('/api/admin/contact-messages', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    await prisma.contactMessage.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
    const data = await prisma.contactMessage.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, fullName: true, email: true, subject: true, body: true, readAt: true, createdAt: true, replies: { orderBy: { createdAt: 'asc' }, select: { id: true, body: true, createdAt: true, admin: { select: { firstName: true, lastName: true } } } } },
    });
    return res.json({ data });
  } catch (error) { next(error); }
});

app.post('/api/admin/contact-messages/:id/replies', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const payload = z.object({ body: z.string().trim().min(2).max(5000) }).strict().safeParse(req.body);
  if (!id.success) return res.status(400).json({ error: 'Message introuvable.' });
  if (!payload.success) return res.status(400).json({ error: 'La réponse doit contenir entre 2 et 5 000 caractères.' });
  try {
    const message = await prisma.contactMessage.findUnique({ where: { id: id.data }, select: { id: true, fullName: true, email: true, subject: true } });
    if (!message) return res.status(404).json({ error: 'Message introuvable.' });
    const reply = await prisma.$transaction(async (tx) => {
      const created = await tx.contactMessageReply.create({ data: { messageId: message.id, adminId: req.user!.sub, body: payload.data.body }, select: { id: true, body: true, createdAt: true } });
      await enqueueNotification(tx, {
        userId: null,
        emailTo: message.email,
        eventKey: `contact.message.reply:${created.id}`,
        title: `Réponse de GHORBEL : ${message.subject}`,
        message: `Bonjour ${message.fullName},\n\n${payload.data.body}\n\nEn réponse à votre message : « ${message.subject} »`,
      });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'CONTACT_MESSAGE_REPLIED', entityType: 'CONTACT_MESSAGE', entityId: message.id, details: { subject: message.subject, replyId: created.id } });
      return created;
    });
    return res.status(201).json({ data: reply });
  } catch (error) { next(error); }
});

app.delete('/api/admin/contact-messages/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Message introuvable.' });
  try {
    const message = await prisma.contactMessage.findUnique({ where: { id: id.data }, select: { id: true, subject: true, email: true } });
    if (!message) return res.status(404).json({ error: 'Message introuvable.' });
    await prisma.$transaction(async (tx) => {
      await tx.contactMessage.delete({ where: { id: message.id } });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'CONTACT_MESSAGE_DELETED', entityType: 'CONTACT_MESSAGE', entityId: message.id, details: { subject: message.subject, sender: message.email } });
    });
    return res.json({ data: { id: message.id, deleted: true } });
  } catch (error) { next(error); }
});

const paymentSettingsSelect = { id: true, bankTransferEnabled: true, bankAccountHolder: true, bankName: true, bankRib: true, bankInstructions: true, updatedAt: true } as const;
app.get('/api/payments/bank-transfer-details', async (_req, res, next) => {
  try {
    const settings = await prisma.companySettings.findUnique({ where: { id: 'default' }, select: paymentSettingsSelect });
    if (!settings?.bankTransferEnabled || !settings.bankAccountHolder || !settings.bankName || !settings.bankRib) return res.json({ data: null });
    return res.json({ data: { accountHolder: settings.bankAccountHolder, bankName: settings.bankName, rib: settings.bankRib, instructions: settings.bankInstructions } });
  } catch (error) { next(error); }
});

app.get('/api/admin/company-settings/payment', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const settings = await prisma.companySettings.findUnique({ where: { id: 'default' }, select: paymentSettingsSelect });
    return res.json({ data: settings ?? { id: 'default', bankTransferEnabled: false, bankAccountHolder: '', bankName: '', bankRib: '', bankInstructions: '', updatedAt: null } });
  } catch (error) { next(error); }
});

app.patch('/api/admin/company-settings/payment', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const parsed = z.object({
    bankTransferEnabled: z.boolean(),
    bankAccountHolder: z.string().trim().max(160).default(''),
    bankName: z.string().trim().max(120).default(''),
    bankRib: z.string().trim().max(64).default(''),
    bankInstructions: z.string().trim().max(1000).default(''),
  }).strict().superRefine((value, ctx) => {
    if (!value.bankTransferEnabled) return;
    for (const key of ['bankAccountHolder', 'bankName', 'bankRib'] as const) if (!value[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Champ requis pour activer le virement.' });
    if (/demo|fictif|000000/i.test(value.bankRib)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bankRib'], message: 'Un RIB fictif ou de démonstration ne peut pas être activé.' });
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Coordonnées bancaires invalides.', details: parsed.error.flatten() });
  try {
    const settings = await prisma.$transaction(async (tx) => {
      const updated = await tx.companySettings.upsert({
        where: { id: 'default' },
        create: { id: 'default', ...parsed.data, updatedById: req.user!.sub },
        update: { ...parsed.data, updatedById: req.user!.sub },
        select: paymentSettingsSelect,
      });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'BANK_TRANSFER_SETTINGS_UPDATED', entityType: 'COMPANY_SETTINGS', entityId: updated.id, details: { enabled: updated.bankTransferEnabled, hasAccountHolder: Boolean(updated.bankAccountHolder), hasBankName: Boolean(updated.bankName), hasRib: Boolean(updated.bankRib) } });
      return updated;
    });
    return res.json({ data: settings, message: 'Paramètres de virement enregistrés.' });
  } catch (error) { next(error); }
});

app.get('/api/admin/dashboard/summary', requireAuth, requireAdmin, async (req, res, next) => {
  const parsedDays = z.coerce.number().int().refine((value) => [7, 30, 90].includes(value)).default(30).safeParse(req.query.days);
  if (!parsedDays.success) return res.status(400).json({ error: 'Période invalide. Valeurs autorisées : 7, 30 ou 90 jours.' });
  const now = new Date();
  const from = new Date(now.getTime() - parsedDays.data * 24 * 60 * 60 * 1000);
  const tunisParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((part) => [part.type, part.value]));
  const today = new Date(`${tunisParts.year}-${tunisParts.month}-${tunisParts.day}T00:00:00+01:00`);
  const monthStart = new Date(`${tunisParts.year}-${tunisParts.month}-01T00:00:00+01:00`);
  const yearStart = new Date(`${tunisParts.year}-01-01T00:00:00+01:00`);
  const previousFrom = new Date(from.getTime() - parsedDays.data * 24 * 60 * 60 * 1000);
  try {
    const [orders, todayOrders, paidToday, transfersToReview, partnerAccounts, pendingOffers, productStatuses, stock, invoicesToReview, dailySales, topProducts, categorySales, salesByBuyer, salesBySupplier, missingSupplierInvoices, grossMargin] = await Promise.all([
      prisma.order.aggregate({ where: { createdAt: { gte: from }, status: { not: 'CANCELLED' } }, _count: { _all: true }, _sum: { totalInclTax: true }, _avg: { totalInclTax: true } }),
      prisma.order.aggregate({ where: { createdAt: { gte: today }, status: { not: 'CANCELLED' } }, _count: { _all: true }, _sum: { totalInclTax: true } }),
      prisma.order.aggregate({ where: { paymentStatus: 'PAID', paymentConfirmedAt: { gte: today } }, _sum: { totalInclTax: true }, _count: { _all: true } }),
      prisma.order.count({ where: { paymentStatus: 'TRANSFER_SUBMITTED', status: { not: 'CANCELLED' } } }),
      prisma.user.count({ where: { role: { in: ['SUPPLIER', 'RESELLER'] }, status: 'ACTIVE' } }),
      prisma.supplierOffer.count({ where: { OR: [{ status: 'PENDING' }, { pendingPurchasePrice: { not: null } }] } }),
      prisma.product.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.stockItem.aggregate({ where: { offer: { status: 'APPROVED', archivedAt: null } }, _sum: { onHand: true, reserved: true, damaged: true, onOrder: true } }),
      prisma.supplierInvoice.count({ where: { status: 'PENDING' } }),
      prisma.$queryRaw<{ day: string; orderCount: number; total: string }[]>(Prisma.sql`
        SELECT TO_CHAR(date_trunc('day', o."createdAt" AT TIME ZONE 'Africa/Tunis'), 'YYYY-MM-DD') AS day,
               COUNT(*)::int AS "orderCount",
               COALESCE(SUM(o."totalInclTax"), 0)::text AS total
        FROM "Order" o
        WHERE o."createdAt" >= ${from} AND o.status <> 'CANCELLED'
        GROUP BY date_trunc('day', o."createdAt" AT TIME ZONE 'Africa/Tunis') ORDER BY date_trunc('day', o."createdAt" AT TIME ZONE 'Africa/Tunis')
      `),
      prisma.$queryRaw<{ name: string; sku: string; quantity: number; total: string }[]>(Prisma.sql`
        SELECT ol."productNameSnapshot" AS name, ol."productSkuSnapshot" AS sku,
               COALESCE(SUM(ol.quantity), 0)::int AS quantity,
               COALESCE(SUM(ol."lineTotalInclTax"), 0)::text AS total
        FROM "OrderLine" ol JOIN "Order" o ON o.id = ol."orderId"
        WHERE o."createdAt" >= ${from} AND o.status <> 'CANCELLED' AND ol.status <> 'CANCELLED'
        GROUP BY ol."productNameSnapshot", ol."productSkuSnapshot"
        ORDER BY SUM(ol.quantity) DESC, SUM(ol."lineTotalInclTax") DESC LIMIT 5
      `),
      prisma.$queryRaw<{ category: string; total: string }[]>(Prisma.sql`
        SELECT COALESCE(NULLIF(p.category, ''), 'Sans catégorie') AS category,
               COALESCE(SUM(ol."lineTotalInclTax"), 0)::text AS total
        FROM "OrderLine" ol JOIN "Order" o ON o.id = ol."orderId" JOIN "Product" p ON p.id = ol."productId"
        WHERE o."createdAt" >= ${from} AND o.status <> 'CANCELLED' AND ol.status <> 'CANCELLED'
        GROUP BY COALESCE(NULLIF(p.category, ''), 'Sans catégorie')
        ORDER BY SUM(ol."lineTotalInclTax") DESC LIMIT 6
      `),
      prisma.$queryRaw<{ buyer: string; role: string; orderCount: number; total: string }[]>(Prisma.sql`
        SELECT COALESCE(NULLIF(u."companyName", ''), NULLIF(CONCAT_WS(' ', u."firstName", u."lastName"), ''), o."guestEmail", 'Client invité') AS buyer,
               COALESCE(u.role::text, 'GUEST') AS role,
               COUNT(*)::int AS "orderCount",
               COALESCE(SUM(o."totalInclTax"), 0)::text AS total
        FROM "Order" o LEFT JOIN "User" u ON u.id = o."customerId"
        WHERE o."createdAt" >= ${from} AND o.status <> 'CANCELLED'
        GROUP BY buyer, role ORDER BY SUM(o."totalInclTax") DESC LIMIT 8
      `),
      prisma.$queryRaw<{ supplier: string; orderCount: number; quantity: number; total: string }[]>(Prisma.sql`
        SELECT COALESCE(NULLIF(u."companyName", ''), CONCAT_WS(' ', u."firstName", u."lastName"), u.email) AS supplier,
               COUNT(DISTINCT o.id)::int AS "orderCount",
               COALESCE(SUM(ol.quantity), 0)::int AS quantity,
               COALESCE(SUM(ol."lineTotalInclTax"), 0)::text AS total
        FROM "OrderLine" ol JOIN "Order" o ON o.id = ol."orderId"
        JOIN "SupplierOffer" so ON so.id = ol."supplierOfferId" JOIN "User" u ON u.id = so."supplierId"
        WHERE o."createdAt" >= ${from} AND o.status <> 'CANCELLED' AND ol.status <> 'CANCELLED'
        GROUP BY so."supplierId", u."companyName", u."firstName", u."lastName", u.email
        ORDER BY SUM(ol."lineTotalInclTax") DESC LIMIT 8
      `),
      prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS count FROM (
          SELECT DISTINCT o.id AS "orderId", so."supplierId"
          FROM "OrderLine" ol
          JOIN "Order" o ON o.id = ol."orderId"
          JOIN "SupplierOffer" so ON so.id = ol."supplierOfferId"
          WHERE o."createdAt" >= ${from} AND o.status <> 'CANCELLED' AND ol.status IN ('SHIPPED', 'DELIVERED')
            AND NOT EXISTS (SELECT 1 FROM "SupplierInvoice" si WHERE si."orderId" = o.id AND si."supplierId" = so."supplierId")
        ) missing
      `),
      prisma.$queryRaw<{ salesExclTax: string; purchaseCostExclTax: string; coveredLineCount: number; missingCostLineCount: number }[]>(Prisma.sql`
        SELECT COALESCE(SUM(ol."lineSubtotalExclTax") FILTER (WHERE ol."purchaseUnitPriceExclTaxSnapshot" IS NOT NULL), 0)::text AS "salesExclTax",
               COALESCE(SUM(ol."purchaseUnitPriceExclTaxSnapshot" * ol.quantity), 0)::text AS "purchaseCostExclTax",
               COUNT(*) FILTER (WHERE ol."purchaseUnitPriceExclTaxSnapshot" IS NOT NULL)::int AS "coveredLineCount",
               COUNT(*) FILTER (WHERE ol."purchaseUnitPriceExclTaxSnapshot" IS NULL)::int AS "missingCostLineCount"
        FROM "OrderLine" ol JOIN "Order" o ON o.id = ol."orderId"
        WHERE o."createdAt" >= ${from} AND o.status <> 'CANCELLED' AND ol.status <> 'CANCELLED'
      `),
    ]);
    const [previousOrders, monthOrders, yearOrders, orderStatuses, awaitingPaymentOrders, activeCustomers, activeSuppliers, referencesAvailable, stockHealth] = await Promise.all([
      prisma.order.aggregate({ where: { createdAt: { gte: previousFrom, lt: from }, status: { not: 'CANCELLED' } }, _count: { _all: true }, _sum: { totalInclTax: true } }),
      prisma.order.aggregate({ where: { createdAt: { gte: monthStart }, status: { not: 'CANCELLED' } }, _count: { _all: true }, _sum: { totalInclTax: true } }),
      prisma.order.aggregate({ where: { createdAt: { gte: yearStart }, status: { not: 'CANCELLED' } }, _count: { _all: true }, _sum: { totalInclTax: true } }),
      prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.order.count({ where: { status: { not: 'CANCELLED' }, paymentStatus: { not: 'PAID' } } }),
      prisma.user.count({ where: { role: 'CUSTOMER', status: 'ACTIVE' } }),
      prisma.user.count({ where: { role: 'SUPPLIER', status: 'ACTIVE' } }),
      prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
        SELECT COUNT(DISTINCT pr.id)::int AS count
        FROM "ProductReference" pr JOIN "Product" p ON p.id = pr."productId"
        WHERE p.status = 'VERIFIED' AND EXISTS (
          SELECT 1 FROM "SupplierOffer" so JOIN "StockItem" si ON si."offerId" = so.id
          WHERE so."productId" = p.id AND so.status = 'APPROVED'
            AND (si."onHand" - si.reserved - si.damaged) > 0
        )
      `),
      prisma.$queryRaw<{ outOfStockProducts: number; lowStockProducts: number }[]>(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE available <= 0)::int AS "outOfStockProducts",
               COUNT(*) FILTER (WHERE available > 0 AND available <= minimum)::int AS "lowStockProducts"
        FROM (
          SELECT p.id,
                 COALESCE(SUM(GREATEST(si."onHand" - si.reserved - si.damaged, 0)), 0)::int AS available,
                 COALESCE(SUM(si."minimumStock"), 0)::int AS minimum
          FROM "Product" p
          JOIN "SupplierOffer" so ON so."productId" = p.id AND so.status = 'APPROVED'
          LEFT JOIN "StockItem" si ON si."offerId" = so.id
          WHERE p.status = 'VERIFIED'
          GROUP BY p.id
        ) inventory
      `),
    ]);
    const orderCountByStatus = new Map(orderStatuses.map((item) => [item.status, item._count._all]));
    const previousTotal = Number(previousOrders._sum.totalInclTax || 0);
    const currentTotal = Number(orders._sum.totalInclTax || 0);
    const periodChangePercent = previousTotal > 0 ? Number(((currentTotal - previousTotal) / previousTotal * 100).toFixed(1)) : currentTotal === 0 ? 0 : null;
    const productCounts = { verified: 0, demonstration: 0 };
    for (const item of productStatuses) {
      if (item.status === 'VERIFIED') productCounts.verified = item._count._all;
      else productCounts.demonstration = item._count._all;
    }
    const asAmount = (value: Prisma.Decimal | null | undefined) => Number(value || 0).toFixed(3);
    return res.json({ data: {
      periodDays: parsedDays.data,
      sales: { orderCount: orders._count._all, totalInclTax: asAmount(orders._sum.totalInclTax), averageBasketInclTax: asAmount(orders._avg.totalInclTax) },
      previousPeriod: { orderCount: previousOrders._count._all, totalInclTax: asAmount(previousOrders._sum.totalInclTax), changePercent: periodChangePercent },
      today: { orderCount: todayOrders._count._all, totalInclTax: asAmount(todayOrders._sum.totalInclTax), collectedOrderCount: paidToday._count._all, collectedInclTax: asAmount(paidToday._sum.totalInclTax) },
      month: { orderCount: monthOrders._count._all, totalInclTax: asAmount(monthOrders._sum.totalInclTax) },
      year: { orderCount: yearOrders._count._all, totalInclTax: asAmount(yearOrders._sum.totalInclTax) },
      orderFlow: { total: [...orderCountByStatus.entries()].reduce((sum, [status, count]) => sum + (status === 'CANCELLED' ? 0 : count), 0), cancelled: orderCountByStatus.get('CANCELLED') || 0, toProcess: (orderCountByStatus.get('PLACED') || 0) + (orderCountByStatus.get('PROCESSING') || 0), shippedOrDelivered: (orderCountByStatus.get('SHIPPED') || 0) + (orderCountByStatus.get('PARTIALLY_SHIPPED') || 0) + (orderCountByStatus.get('DELIVERED') || 0), awaitingPayment: awaitingPaymentOrders },
      attention: { transfersToReview, pendingOffers, invoicesToReview, missingSupplierInvoices: missingSupplierInvoices[0]?.count ?? 0 },
      partners: { activeAccounts: partnerAccounts, activeCustomers, activeSuppliers },
      catalog: { ...productCounts, referencesAvailable: referencesAvailable[0]?.count ?? 0 },
      stock: { physical: stock._sum.onHand ?? 0, reserved: stock._sum.reserved ?? 0, damaged: stock._sum.damaged ?? 0, onOrder: stock._sum.onOrder ?? 0, outOfStockProducts: stockHealth[0]?.outOfStockProducts ?? 0, lowStockProducts: stockHealth[0]?.lowStockProducts ?? 0 },
      grossMargin: (() => { const row = grossMargin[0] ?? { salesExclTax: '0', purchaseCostExclTax: '0', coveredLineCount: 0, missingCostLineCount: 0 }; const sales = Number(row.salesExclTax); const cost = Number(row.purchaseCostExclTax); return { salesExclTax: sales.toFixed(3), purchaseCostExclTax: cost.toFixed(3), amountExclTax: (sales - cost).toFixed(3), ratePercent: sales > 0 ? Number(((sales - cost) / sales * 100).toFixed(2)) : null, coveredLineCount: row.coveredLineCount, missingCostLineCount: row.missingCostLineCount }; })(),
      dailySales: dailySales.map((item) => ({ ...item, total: Number(item.total) })),
      topProducts: topProducts.map((item) => ({ ...item, total: Number(item.total) })),
      categorySales: categorySales.map((item) => ({ ...item, total: Number(item.total) })),
      salesByBuyer: salesByBuyer.map((item) => ({ ...item, total: Number(item.total) })),
      salesBySupplier: salesBySupplier.map((item) => ({ ...item, total: Number(item.total) })),
      definitions: { sales: 'Total TTC des commandes créées pendant la période, hors commandes annulées; ce montant ne représente pas les encaissements.', collected: 'Commandes marquées payées aujourd’hui par l’administration, comptées en TTC.', stock: 'Sommes des quantités des offres approuvées; la disponibilité vendable correspond au stock physique moins les réservations et les quantités endommagées.', grossMargin: 'Estimation HT calculée sur les lignes non annulées dont le coût fournisseur HT a été figé lors de la commande; les anciennes lignes sans instantané sont exclues.' },
    } });
  } catch (error) { next(error); }
});

app.get('/api/admin/reports/sales.csv', requireAuth, requireAdmin, async (req, res, next) => {
  const parsedDays = z.coerce.number().int().refine((value) => [7, 30, 90].includes(value)).default(30).safeParse(req.query.days);
  if (!parsedDays.success) return res.status(400).json({ error: 'Période invalide. Valeurs autorisées : 7, 30 ou 90 jours.' });
  const from = new Date(Date.now() - parsedDays.data * 24 * 60 * 60 * 1000);
  try {
    const lines = await prisma.orderLine.findMany({
      where: { order: { createdAt: { gte: from }, status: { not: 'CANCELLED' } }, status: { not: 'CANCELLED' } },
      orderBy: [{ order: { createdAt: 'desc' } }, { id: 'asc' }], take: 20001,
      select: {
        productNameSnapshot: true, productSkuSnapshot: true, supplierSkuSnapshot: true, quantity: true, status: true,
        unitPriceExclTax: true, vatRateSnapshot: true, lineSubtotalExclTax: true, lineVat: true, lineTotalInclTax: true,
        order: { select: { orderNumber: true, createdAt: true, status: true, paymentMethod: true, paymentStatus: true, customer: { select: { role: true, companyName: true, firstName: true, lastName: true } }, guestEmail: true } },
        supplierOffer: { select: { supplier: { select: { companyName: true, email: true } } } },
      },
    });
    if (lines.length > 20000) return res.status(413).json({ error: 'Export trop volumineux (plus de 20 000 lignes). Réduisez la période et relancez.' });
    const csvValue = (raw: unknown) => {
      let value = String(raw ?? '');
      if (/^[\s\u0000-\u001f]*[=+\-@]/.test(value)) value = `'${value}`;
      return `"${value.replace(/"/g, '""')}"`;
    };
    const columns = ['Commande', 'Date', 'Client', 'Type client', 'Fournisseur exécutant', 'SKU fournisseur', 'Pièce', 'SKU catalogue', 'Quantité', 'Statut ligne', 'Prix unitaire HT TND', 'TVA %', 'Total HT TND', 'TVA TND', 'Total TTC TND', 'Paiement', 'Statut paiement'];
    const rows = lines.map((line) => {
      const buyer = line.order.customer;
      const buyerName = buyer?.companyName || [buyer?.firstName, buyer?.lastName].filter(Boolean).join(' ') || 'Client invité';
      const buyerType = buyer?.role === 'RESELLER' ? 'Revendeur' : buyer?.role === 'CUSTOMER' ? 'Particulier' : 'Invité';
      const supplier = line.supplierOffer?.supplier?.companyName || 'Fournisseur supprimé';
      return [line.order.orderNumber, line.order.createdAt.toISOString(), buyerName, buyerType, supplier, line.supplierSkuSnapshot, line.productNameSnapshot, line.productSkuSnapshot, line.quantity, line.status, Number(line.unitPriceExclTax).toFixed(3), Number(line.vatRateSnapshot).toFixed(2), Number(line.lineSubtotalExclTax).toFixed(3), Number(line.lineVat).toFixed(3), Number(line.lineTotalInclTax).toFixed(3), line.order.paymentMethod, line.order.paymentStatus].map(csvValue).join(';');
    });
    const content = `\uFEFF${[columns.map(csvValue).join(';'), ...rows].join('\r\n')}`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="autopieces-ventes-${parsedDays.data}j-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(content);
  } catch (error) { next(error); }
});

app.get('/api/admin/accounts', requireAuth, requireAdmin, async (req, res, next) => {
  const status = z.enum(['PENDING', 'ACTIVE', 'SUSPENDED']).optional().safeParse(req.query.status);
  if (!status.success) return res.status(400).json({ error: 'Statut de compte invalide.' });
  try {
    const accounts = await prisma.user.findMany({
      where: { ...(status.data ? { status: status.data } : {}), role: { in: ['SUPPLIER', 'RESELLER', 'CUSTOMER'] } },
      select: { id: true, email: true, phone: true, firstName: true, lastName: true, role: true, status: true, companyName: true, legalName: true, legalProfileStatus: true, pricingProfileId: true, createdAt: true },
      orderBy: { createdAt: 'desc' }, take: 200,
    });
    return res.json({ data: accounts });
  } catch (error) { next(error); }
});

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res, next) => {
  const parsed = z.object({
    q: z.string().trim().max(120).optional(),
    role: z.enum(['ADMIN', 'SUPPLIER', 'RESELLER', 'CUSTOMER']).optional(),
    status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }).strict().safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Filtres des utilisateurs invalides.' });
  try {
    const { q, role, status, page, limit } = parsed.data;
    const where: Prisma.UserWhereInput = {
      ...(role ? { role } : {}), ...(status ? { status } : {}),
      ...(q ? { OR: [
        { email: { contains: q, mode: 'insensitive' } }, { phone: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } },
        { companyName: { contains: q, mode: 'insensitive' } },
      ] } : {}),
    };
    const [users, total] = await prisma.$transaction([
      prisma.user.findMany({ where, select: { id: true, email: true, phone: true, firstName: true, lastName: true, role: true, status: true, companyName: true, legalName: true, tradeName: true, businessAddress: true, businessCity: true, postalCode: true, taxIdentifier: true, commercialRegisterNumber: true, legalProfileStatus: true, pricingProfileId: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.user.count({ where }),
    ]);
    return res.json({ data: users, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

app.patch('/api/admin/users/:id/legal-profile-status', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  const payload = z.object({ status: z.enum(['APPROVED', 'REVIEW_REQUIRED']) }).strict().safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Décision de validation invalide.' });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: id.data }, select: { id: true, role: true, legalProfileStatus: true } });
      if (!user) return null;
      if (user.role !== 'SUPPLIER') throw Object.assign(new Error('Cette validation concerne uniquement les fournisseurs.'), { statusCode: 409 });
      const updated = await tx.user.update({ where: { id: id.data }, data: { legalProfileStatus: payload.data.status }, select: { id: true, legalProfileStatus: true } });
      await recordAudit(tx, { actorId: req.user!.sub, action: payload.data.status === 'APPROVED' ? 'SUPPLIER_LEGAL_PROFILE_APPROVED' : 'SUPPLIER_LEGAL_PROFILE_REVIEW_REQUIRED', entityType: 'USER', entityId: id.data, details: { fromStatus: user.legalProfileStatus, toStatus: updated.legalProfileStatus } });
      return updated;
    });
    if (!result) return res.status(404).json({ error: 'Fournisseur introuvable.' });
    return res.json({ data: result, message: payload.data.status === 'APPROVED' ? 'Profil légal validé.' : 'Une correction du profil est demandée.' });
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) return res.status((error as { statusCode: number }).statusCode).json({ error: (error as Error).message });
    next(error);
  }
});

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  const payload = z.object({
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).optional(),
    phone: z.union([z.string().trim().min(8).max(24).regex(/^\\+?[0-9\\s().-]+$/), z.literal('')]).optional(),
    firstName: z.string().trim().min(1).max(80).optional(), lastName: z.string().trim().min(1).max(80).optional(),
    companyName: z.union([z.string().trim().min(1).max(160), z.literal('')]).optional(),
    status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED']).optional(),
  }).strict().refine((data) => Object.keys(data).length > 0, 'Aucun champ à modifier.').safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Informations utilisateur invalides.', ...(payload.success ? {} : { details: payload.error.flatten() }) });
  try {
    const user = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id: id.data }, select: { id: true, role: true, status: true } });
      if (!current) return null;
      if (current.role === 'ADMIN' && payload.data.status && payload.data.status !== 'ACTIVE') throw Object.assign(new Error('Le statut d’un compte administrateur ne peut pas être modifié ici.'), { statusCode: 409 });
      const data = { ...payload.data, ...(payload.data.phone !== undefined ? { phone: payload.data.phone || null } : {}), ...(payload.data.companyName !== undefined ? { companyName: payload.data.companyName || null } : {}) };
      const updated = await tx.user.update({ where: { id: id.data }, data, select: { id: true, email: true, phone: true, firstName: true, lastName: true, role: true, status: true, companyName: true, pricingProfileId: true, createdAt: true, updatedAt: true } });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'USER_DETAILS_UPDATED', entityType: 'USER', entityId: updated.id, details: { changedFields: Object.keys(payload.data), statusChanged: current.status !== updated.status } });
      return updated;
    });
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    return res.json({ data: user, message: 'Compte mis à jour.' });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ error: 'Cette adresse e-mail est déjà utilisée.' });
    if ((error as { statusCode?: number }).statusCode) return res.status((error as { statusCode: number }).statusCode).json({ error: (error as Error).message });
    next(error);
  }
});

app.patch('/api/admin/users/:id/password', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  const payload = z.object({ password: z.string().min(1).max(128) }).strict().safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Nouveau mot de passe invalide.', ...(payload.success ? {} : { details: payload.error.flatten() }) });
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: id.data }, select: { id: true } });
      if (!user) return false;
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: await passwordHash(payload.data.password) } });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'USER_PASSWORD_RESET', entityType: 'USER', entityId: user.id, details: { resetByAdmin: true } });
      return true;
    });
    if (!updated) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    return res.json({ message: 'Mot de passe réinitialisé.' });
  } catch (error) { next(error); }
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Identifiant utilisateur invalide.' });
  if (id.data === req.user!.sub) return res.status(409).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
  try {
    let filesToClean: string[] = [];
    const deleted = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: id.data }, select: { id: true, role: true, email: true, companyName: true } });
      if (!user) return null;
      if (user.role !== 'SUPPLIER') throw Object.assign(new Error('La suppression définitive est réservée aux comptes fournisseur.'), { httpStatus: 409 });
      const offers = await tx.supplierOffer.findMany({ where: { supplierId: user.id }, select: { id: true, productId: true } });
      const offerIds = offers.map((offer) => offer.id);
      const productIds = [...new Set(offers.map((offer) => offer.productId))];
      const [ownedCompatibilityPaths, ownedSuggestions] = await Promise.all([
        productIds.length ? tx.vehicleCompatibility.findMany({ where: { productId: { in: productIds } }, select: { generationId: true } }) : [],
        offerIds.length ? tx.partnerFitmentSuggestion.findMany({ where: { offerId: { in: offerIds }, generationId: { not: null } }, select: { generationId: true } }) : [],
      ]);
      const supplierGenerationIds = [...new Set([...ownedCompatibilityPaths, ...ownedSuggestions].map((entry) => entry.generationId).filter((generationId): generationId is string => Boolean(generationId)))];

      const affectedOrderLines = offerIds.length ? await tx.orderLine.findMany({ where: { supplierOfferId: { in: offerIds } }, select: { id: true, orderId: true } }) : [];
      if (offerIds.length) {
        await tx.orderLine.updateMany({ where: { supplierOfferId: { in: offerIds } }, data: { supplierOfferId: null, warehouseId: null, stockItemId: null, supplierSkuSnapshot: 'FOURNISSEUR_SUPPRIME', purchaseUnitPriceExclTaxSnapshot: null, purchaseVatRateSnapshot: null, carrierName: null, trackingReference: null, trackingUrl: null } });
        await tx.orderLine.updateMany({ where: { id: { in: affectedOrderLines.map((line) => line.id) }, status: { in: ['RESERVED', 'ACCEPTED', 'PREPARING'] } }, data: { status: 'CANCELLED' } });
      }
      await tx.stockMovement.deleteMany({ where: { OR: [...(offerIds.length ? [{ offerId: { in: offerIds } }] : []), { actorId: user.id }] } });
      if (offerIds.length) {
        await tx.stockItem.deleteMany({ where: { offerId: { in: offerIds } } });
        await tx.supplierOffer.deleteMany({ where: { id: { in: offerIds } } });
      }
      const affectedOrderIds = [...new Set(affectedOrderLines.map((line) => line.orderId))];
      for (const orderId of affectedOrderIds) {
        const remainingLines = await tx.orderLine.count({ where: { orderId, status: { not: 'CANCELLED' } } });
        if (!remainingLines) await tx.order.updateMany({ where: { id: orderId, status: { notIn: ['CANCELLED', 'DELIVERED', 'SHIPPED'] } }, data: { status: 'CANCELLED' } });
      }

      await tx.supplierInvoiceEvent.deleteMany({ where: { actorId: user.id } });
      await tx.supplierInvoice.deleteMany({ where: { supplierId: user.id } });
      await tx.paymentEvent.deleteMany({ where: { actorId: user.id } });
      await tx.auditLog.deleteMany({ where: { actorId: user.id } });
      await tx.importJob.deleteMany({ where: { uploadedById: user.id } });
      await tx.warehouse.deleteMany({ where: { ownerId: user.id, stockItems: { none: {} }, movements: { none: {} }, orderLines: { none: {} } } });
      await tx.warehouse.updateMany({ where: { ownerId: user.id }, data: { ownerId: null } });

      if (productIds.length) {
        await tx.vehicleCompatibility.deleteMany({ where: { productId: { in: productIds }, source: 'Déclarée par le fournisseur' } });
        const exclusivelyOwnedProducts = await tx.product.findMany({ where: { id: { in: productIds }, supplierOffers: { none: {} } }, select: { id: true, images: true } });
        const deletableProductIds = exclusivelyOwnedProducts.map((product) => product.id);
        if (deletableProductIds.length) {
          filesToClean = exclusivelyOwnedProducts.flatMap((product) => product.images);
          await tx.orderLine.updateMany({ where: { productId: { in: deletableProductIds } }, data: { productId: null } });
          await tx.product.deleteMany({ where: { id: { in: deletableProductIds } } });
        }
      }

      const unusedSupplierGenerations = supplierGenerationIds.length ? await tx.vehicleGeneration.findMany({ where: { id: { in: supplierGenerationIds }, status: DataStatus.CONTRIBUTED, source: 'Saisie partenaire', compatibilities: { none: {} }, partnerFitmentSuggestions: { none: {} } }, select: { id: true, modelId: true } }) : [];
      for (const generation of unusedSupplierGenerations) {
        await tx.vehicleVariant.deleteMany({ where: { generationId: generation.id, status: DataStatus.CONTRIBUTED, source: 'Saisie partenaire', compatibilities: { none: {} }, partnerFitmentSuggestions: { none: {} } } });
        await tx.engine.deleteMany({ where: { generationId: generation.id, status: DataStatus.CONTRIBUTED, source: 'Saisie partenaire', compatibilities: { none: {} }, partnerFitmentSuggestions: { none: {} }, variants: { none: {} } } });
        await tx.vehicleGeneration.deleteMany({ where: { id: generation.id, engines: { none: {} }, variants: { none: {} }, compatibilities: { none: {} }, partnerFitmentSuggestions: { none: {} } } });
      }
      const usedModels = [...new Set(unusedSupplierGenerations.map((generation) => generation.modelId))];
      if (usedModels.length) {
        await tx.vehicleModel.deleteMany({ where: { id: { in: usedModels }, status: DataStatus.CONTRIBUTED, source: 'Saisie partenaire', generations: { none: {} } } });
        await tx.vehicleMake.deleteMany({ where: { models: { none: {} }, status: DataStatus.CONTRIBUTED, source: 'Saisie partenaire' } });
      }

      await tx.user.delete({ where: { id: user.id } });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'SUPPLIER_ACCOUNT_DELETED', entityType: 'USER', entityId: `deleted:${randomUUID()}`, details: { role: user.role, offerCount: offers.length } });
      return { id: user.id, email: user.email, deletedOffers: offers.length };
    }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 20000 });
    if (!deleted) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    for (const image of new Set(filesToClean)) {
      const filename = /^\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp))$/i.exec(image)?.[1];
      if (!filename || await prisma.product.count({ where: { images: { has: image } } })) continue;
      await unlink(path.resolve(uploadsDirectory, filename)).catch(() => undefined);
    }
    return res.json({ data: deleted, message: 'Compte fournisseur et données de catalogue supprimés. Les commandes clients conservent leurs lignes et montants figés, sans rattachement au fournisseur.' });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2034') return res.status(409).json({ error: 'Le compte ou son stock a été modifié simultanément. Actualisez puis réessayez.' });
    next(error);
  }
});

app.post('/api/admin/accounts', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const parsed = z.object({
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()), password: z.string().min(1).max(128),
    firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80),
    companyName: z.string().trim().min(1).max(160), phone: z.string().trim().min(8).max(24).regex(/^\+?[0-9\s().-]+$/), role: z.enum(['SUPPLIER', 'RESELLER']),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Informations partenaire invalides.', details: parsed.error.flatten() });
  try {
    const { password, ...data } = parsed.data;
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { ...data, passwordHash: await passwordHash(password), status: 'ACTIVE' }, select: { id: true, email: true, phone: true, firstName: true, lastName: true, companyName: true, role: true, status: true, createdAt: true } });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'PARTNER_ACCOUNT_CREATED', entityType: 'USER', entityId: created.id, details: { role: created.role, companyName: created.companyName ?? '' } });
      const partnerType = created.role === 'SUPPLIER' ? 'fournisseur' : 'revendeur';
      await enqueueNotification(tx, { userId: created.id, emailTo: created.email, eventKey: `welcome.partner.${created.role.toLowerCase()}:${created.id}`, title: 'Bienvenue dans le réseau partenaire GHORBEL', message: `Bonjour ${created.firstName},\n\nVotre compte ${partnerType} pour ${created.companyName} est actif. Connectez-vous à votre espace partenaire pour gérer votre activité et retrouver les commandes qui vous sont attribuées.`, link: '/partner' });
      return created;
    });
    return res.status(201).json({ data: user, message: 'Compte partenaire créé. Remettez les identifiants au partenaire par un canal privé.' });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ error: 'Cette adresse e-mail est déjà utilisée.' });
    next(error);
  }
});

app.patch('/api/admin/accounts/:id/status', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  const payload = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) }).safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Compte ou statut invalide.' });
  try {
    const account = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findFirst({ where: { id: id.data, role: { in: ['SUPPLIER', 'RESELLER', 'CUSTOMER'] } }, select: { status: true } });
      if (!current) return null;
      const changed = await tx.user.updateMany({ where: { id: id.data, role: { in: ['SUPPLIER', 'RESELLER', 'CUSTOMER'] } }, data: { status: payload.data.status } });
      if (!changed.count) return null;
      if (current.status !== payload.data.status) await recordAudit(tx, { actorId: req.user!.sub, action: payload.data.status === 'ACTIVE' ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_SUSPENDED', entityType: 'USER', entityId: id.data, details: { from: current.status, to: payload.data.status } });
      return tx.user.findUnique({ where: { id: id.data }, select: { id: true, email: true, role: true, status: true } });
    });
    if (!account) return res.status(404).json({ error: 'Compte introuvable.' });
    return res.json({ data: account });
  } catch (error) { next(error); }
});

app.get('/api/admin/pricing-profiles', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const profiles = await prisma.pricingProfile.findMany({ include: { _count: { select: { users: true } }, productPrices: { include: { product: { select: { id: true, sku: true, name: true } } }, orderBy: { product: { name: 'asc' } } }, categoryPrices: { orderBy: { category: 'asc' } } }, orderBy: { name: 'asc' } });
    return res.json({ data: profiles });
  } catch (error) { next(error); }
});

app.patch('/api/admin/pricing-profiles/:id/categories', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const profileId = uuid.safeParse(req.params.id);
  const payload = z.object({ category: z.string().trim().min(2).max(100), discountPercent: z.coerce.number().min(0).max(100).nullable() }).strict().safeParse(req.body);
  if (!profileId.success || !payload.success) return res.status(400).json({ error: 'Profil, catégorie ou remise invalide.' });
  const category = payload.data.category.toLocaleLowerCase('fr-TN');
  try {
    const result = await prisma.$transaction(async (tx) => {
      const profile = await tx.pricingProfile.findUnique({ where: { id: profileId.data }, select: { id: true, active: true } });
      if (!profile?.active) throw Object.assign(new Error('Profil tarifaire actif introuvable.'), { httpStatus: 404 });
      if (payload.data.discountPercent === null) {
        await tx.profileCategoryPrice.deleteMany({ where: { profileId: profile.id, category } });
        await recordAudit(tx, { actorId: req.user!.sub, action: 'CATEGORY_PRICE_OVERRIDE_REMOVED', entityType: 'PRICING_PROFILE', entityId: profile.id, details: { category } });
        return null;
      }
      const rule = await tx.profileCategoryPrice.upsert({ where: { profileId_category: { profileId: profile.id, category } }, create: { profileId: profile.id, category, discountPercent: payload.data.discountPercent.toFixed(2) }, update: { discountPercent: payload.data.discountPercent.toFixed(2) } });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'CATEGORY_PRICE_OVERRIDE_SET', entityType: 'PRICING_PROFILE', entityId: profile.id, details: { category, discountPercent: rule.discountPercent.toFixed(2) } });
      return rule;
    });
    return res.json({ data: result });
  } catch (error) { const status = (error as { httpStatus?: number }).httpStatus; if (status) return res.status(status).json({ error: (error as Error).message }); next(error); }
});

app.patch('/api/admin/pricing-profiles/:id/products/:productId', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const profileId = uuid.safeParse(req.params.id); const productId = uuid.safeParse(req.params.productId);
  const payload = z.object({ discountPercent: z.coerce.number().min(0).max(100).nullable() }).strict().safeParse(req.body);
  if (!profileId.success || !productId.success || !payload.success) return res.status(400).json({ error: 'Profil, pièce ou remise invalide.' });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const [profile, product] = await Promise.all([
        tx.pricingProfile.findUnique({ where: { id: profileId.data }, select: { id: true, active: true } }),
        tx.product.findUnique({ where: { id: productId.data }, select: { id: true } }),
      ]);
      if (!profile?.active || !product) throw Object.assign(new Error('Profil actif ou pièce introuvable.'), { httpStatus: 404 });
      if (payload.data.discountPercent === null) {
        await tx.profileProductPrice.deleteMany({ where: { profileId: profile.id, productId: product.id } });
        await recordAudit(tx, { actorId: req.user!.sub, action: 'PRODUCT_PRICE_OVERRIDE_REMOVED', entityType: 'PRICING_PROFILE', entityId: profile.id, details: { productId: product.id } });
        return null;
      }
      const rule = await tx.profileProductPrice.upsert({ where: { profileId_productId: { profileId: profile.id, productId: product.id } }, create: { profileId: profile.id, productId: product.id, discountPercent: payload.data.discountPercent.toFixed(2) }, update: { discountPercent: payload.data.discountPercent.toFixed(2) } });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'PRODUCT_PRICE_OVERRIDE_SET', entityType: 'PRICING_PROFILE', entityId: profile.id, details: { productId: product.id, discountPercent: rule.discountPercent.toFixed(2) } });
      return rule;
    });
    return res.json({ data: result });
  } catch (error) { const status = (error as { httpStatus?: number }).httpStatus; if (status) return res.status(status).json({ error: (error as Error).message }); next(error); }
});

app.post('/api/admin/pricing-profiles', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const payload = z.object({ name: z.string().trim().min(2).max(100), description: z.string().trim().max(500).optional(), discountPercent: z.coerce.number().min(0).max(100) }).strict().safeParse(req.body);
  if (!payload.success) return res.status(400).json({ error: 'Profil tarifaire invalide.', details: payload.error.flatten() });
  try {
    const profile = await prisma.$transaction(async (tx) => {
      const created = await tx.pricingProfile.create({ data: { ...payload.data, discountPercent: payload.data.discountPercent.toFixed(2) } });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'PRICING_PROFILE_CREATED', entityType: 'PRICING_PROFILE', entityId: created.id, details: { name: created.name, discountPercent: created.discountPercent.toFixed(2) } });
      return created;
    });
    return res.status(201).json({ data: profile });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ error: 'Ce nom de profil existe déjà.' });
    next(error);
  }
});

app.patch('/api/admin/accounts/:id/pricing-profile', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  const payload = z.object({ pricingProfileId: z.string().uuid().nullable() }).strict().safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Compte ou profil invalide.' });
  try {
    const account = await prisma.$transaction(async (tx) => {
      if (payload.data.pricingProfileId) {
        const profile = await tx.pricingProfile.findUnique({ where: { id: payload.data.pricingProfileId }, select: { active: true } });
        if (!profile?.active) throw Object.assign(new Error('Profil tarifaire actif introuvable.'), { httpStatus: 400 });
      }
      const current = await tx.user.findFirst({ where: { id: id.data, role: 'RESELLER', status: { not: 'SUSPENDED' } }, select: { pricingProfileId: true } });
      if (!current) throw Object.assign(new Error('Compte revendeur introuvable ou suspendu.'), { httpStatus: 404 });
      const updated = await tx.user.updateMany({ where: { id: id.data, role: 'RESELLER', status: { not: 'SUSPENDED' } }, data: { pricingProfileId: payload.data.pricingProfileId } });
      if (!updated.count) throw Object.assign(new Error('Compte revendeur introuvable ou suspendu.'), { httpStatus: 404 });
      if (current.pricingProfileId !== payload.data.pricingProfileId) await recordAudit(tx, { actorId: req.user!.sub, action: 'RESELLER_PRICING_PROFILE_CHANGED', entityType: 'USER', entityId: id.data, details: { fromProfileId: current.pricingProfileId, toProfileId: payload.data.pricingProfileId } });
      return tx.user.findUnique({ where: { id: id.data }, select: { id: true, email: true, companyName: true, pricingProfile: { select: { id: true, name: true, discountPercent: true } } } });
    });
    return res.json({ data: account });
  } catch (error) { const status = (error as { httpStatus?: number }).httpStatus; if (status) return res.status(status).json({ error: (error as Error).message }); next(error); }
});

app.get('/api/admin/products', requireAuth, requireAdmin, async (req, res, next) => {
  const search = z.string().trim().max(100).optional().safeParse(req.query.search);
  const includeArchived = z.enum(['true', 'false']).default('false').safeParse(req.query.includeArchived);
  if (!search.success || !includeArchived.success) return res.status(400).json({ error: 'Recherche produit invalide.' });
  try {
    const [products, settings, categoryMargins] = await Promise.all([
      prisma.product.findMany({ where: { ...(includeArchived.data === 'true' ? {} : { archivedAt: null }), ...(search.data ? { OR: [{ name: { contains: search.data, mode: 'insensitive' } }, { sku: { contains: search.data, mode: 'insensitive' } }] } : {}) }, select: { id: true, sku: true, name: true, description: true, category: true, pieceBrand: true, images: true, status: true, listPrice: true, pricingMode: true, marginPercent: true, vatRate: true, archivedAt: true, _count: { select: { supplierOffers: true } }, supplierOffers: { where: { status: 'APPROVED', archivedAt: null, supplier: { status: 'ACTIVE' } }, orderBy: [{ purchasePrice: 'asc' }, { createdAt: 'asc' }], take: 1, select: { purchasePrice: true } } }, orderBy: { name: 'asc' }, take: 250 }),
      prisma.companySettings.findUnique({ where: { id: 'default' }, select: { defaultMarginPercent: true } }),
      prisma.categoryMargin.findMany({ select: { category: true, marginPercent: true } }),
    ]);
    const margins = new Map(categoryMargins.map((rule) => [normalizeCategory(rule.category), Number(rule.marginPercent)]));
    return res.json({ data: products.map(({ supplierOffers, _count, ...product }) => ({ ...product, hasPartnerOffer: _count.supplierOffers > 0, lowestSupplierCost: supplierOffers[0]?.purchasePrice ?? null, effectiveMarginPercent: product.marginPercent !== null ? Number(product.marginPercent) : (margins.get(normalizeCategory(product.category)) ?? Number(settings?.defaultMarginPercent ?? 0)) })) });
  } catch (error) { next(error); }
});

const adminProductUpdateSchema = z.object({
  sku: z.string().trim().min(1).max(100), name: z.string().trim().min(2).max(180),
  description: z.string().trim().max(5000).nullable(), category: z.string().trim().max(100).nullable(), pieceBrand: z.string().trim().max(100).nullable(),
  images: z.array(z.string().trim().min(1).max(2000).refine((value) => value.startsWith('/uploads/') || (value.startsWith('https://') && z.string().url().safeParse(value).success), 'Les photos doivent être une URL HTTPS ou un chemin /uploads/.')).max(8),
}).strict();
app.patch('/api/admin/products/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id); const payload = adminProductUpdateSchema.safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Informations de catalogue invalides.', details: payload.success ? undefined : payload.error.flatten() });
  try {
    const product = await prisma.$transaction(async (tx) => {
      const current = await tx.product.findUnique({ where: { id: id.data }, select: { sku: true, name: true, description: true, category: true, pieceBrand: true, images: true } });
      if (!current) throw Object.assign(new Error('Pièce introuvable.'), { httpStatus: 404 });
      const updated = await tx.product.update({ where: { id: id.data }, data: { ...payload.data, description: payload.data.description || null, category: payload.data.category || null, pieceBrand: payload.data.pieceBrand || null }, select: { id: true, sku: true, name: true, description: true, category: true, pieceBrand: true, images: true } });
      if (current.category !== updated.category) await recalculateMarginPrices(tx, { productId: id.data });
      const changed = Object.keys(payload.data).filter((key) => JSON.stringify(current[key as keyof typeof current]) !== JSON.stringify(updated[key as keyof typeof updated]));
      if (changed.length) await recordAudit(tx, { actorId: req.user!.sub, action: 'PRODUCT_CATALOG_UPDATED', entityType: 'PRODUCT', entityId: id.data, details: { changedFields: changed, previousSku: current.sku, sku: updated.sku } });
      return updated;
    });
    return res.json({ data: product, message: 'Fiche catalogue mise à jour.' });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ error: 'Cette référence catalogue existe déjà.' });
    next(error);
  }
});

app.patch('/api/admin/products/:id/archive', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  const payload = z.object({ archived: z.boolean() }).strict().safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Action de catalogue invalide.' });
  try {
    const product = await prisma.$transaction(async (tx) => {
      const current = await tx.product.findUnique({ where: { id: id.data }, select: { id: true, sku: true, name: true, archivedAt: true } });
      if (!current) throw Object.assign(new Error('Pièce introuvable.'), { httpStatus: 404 });
      const archivedAt = payload.data.archived ? (current.archivedAt ?? new Date()) : null;
      const updated = await tx.product.update({ where: { id: id.data }, data: { archivedAt }, select: { id: true, sku: true, name: true, archivedAt: true } });
      if (Boolean(current.archivedAt) !== payload.data.archived) await recordAudit(tx, { actorId: req.user!.sub, action: payload.data.archived ? 'PRODUCT_ARCHIVED' : 'PRODUCT_RESTORED', entityType: 'PRODUCT', entityId: id.data, details: { sku: current.sku, name: current.name } });
      return updated;
    });
    return res.json({ data: product, message: product.archivedAt ? 'Pièce retirée du catalogue public.' : 'Pièce rétablie dans le catalogue public.' });
  } catch (error) { const status = (error as { httpStatus?: number }).httpStatus; if (status) return res.status(status).json({ error: (error as Error).message }); next(error); }
});

app.patch('/api/admin/products/:id/publication', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  const payload = z.object({ published: z.boolean() }).strict().safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Action de publication invalide.' });
  try {
    const product = await prisma.$transaction(async (tx) => {
      const current = await tx.product.findUnique({ where: { id: id.data }, select: { id: true, sku: true, name: true, status: true, _count: { select: { supplierOffers: true } } } });
      if (!current) throw Object.assign(new Error('Pièce introuvable.'), { httpStatus: 404 });
      if (current._count.supplierOffers > 0) throw Object.assign(new Error('La publication d’une pièce partenaire dépend de la validation de son offre fournisseur.'), { httpStatus: 409 });
      const status = payload.data.published ? DataStatus.VERIFIED : DataStatus.DEMONSTRATION;
      const updated = await tx.product.update({ where: { id: current.id }, data: { status }, select: { id: true, sku: true, name: true, status: true } });
      if (current.status !== status) await recordAudit(tx, { actorId: req.user!.sub, action: payload.data.published ? 'PRODUCT_PUBLISHED' : 'PRODUCT_UNPUBLISHED', entityType: 'PRODUCT', entityId: current.id, details: { sku: current.sku, name: current.name } });
      return updated;
    });
    return res.json({ data: product, message: product.status === DataStatus.VERIFIED ? 'Pièce publiée dans le catalogue client.' : 'Pièce retirée du catalogue client.' });
  } catch (error) { const status = (error as { httpStatus?: number }).httpStatus; if (status) return res.status(status).json({ error: (error as Error).message }); next(error); }
});

app.patch('/api/admin/products/:id/pricing', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  const payload = z.object({ mode: z.enum(['MANUAL', 'MARGIN']).default('MANUAL'), listPrice: z.coerce.number().finite().positive().max(100000000).optional(), vatRate: z.coerce.number().finite().refine((value) => value === 19, 'Le taux de vente configuré est fixé à 19 %.') }).strict().refine((value) => value.mode === 'MARGIN' || value.listPrice !== undefined, 'Un prix HT est obligatoire en mode manuel.').safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Prix produit invalide.', details: payload.success ? undefined : payload.error.flatten() });
  try {
    const product = await prisma.$transaction(async (tx) => {
      const current = await tx.product.findUnique({ where: { id: id.data }, select: { sku: true, category: true, listPrice: true, vatRate: true, pricingMode: true, _count: { select: { supplierOffers: true } } } });
      if (!current) throw Object.assign(new Error('Produit introuvable.'), { code: 'P2025' });
      if (current._count.supplierOffers > 0 && payload.data.mode === 'MANUAL') throw Object.assign(new Error('Pour une pièce partenaire, le prix client doit suivre le coût fournisseur et la marge GHORBEL. Le prix d’achat reste géré par le partenaire.'), { httpStatus: 409 });
      await tx.product.update({ where: { id: id.data }, data: { pricingMode: payload.data.mode, ...(payload.data.mode === 'MANUAL' ? { listPrice: payload.data.listPrice!.toFixed(3), marginPercent: null } : {}), vatRate: payload.data.vatRate.toFixed(2) } });
      if (payload.data.mode === 'MARGIN') await recalculateMarginPrices(tx);
      const updated = await tx.product.findUniqueOrThrow({ where: { id: id.data }, select: { id: true, sku: true, name: true, category: true, listPrice: true, pricingMode: true, vatRate: true } });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'PRODUCT_PRICE_UPDATED', entityType: 'PRODUCT', entityId: id.data, details: { sku: current.sku, previousPriceExclTax: current.listPrice?.toFixed(3) ?? null, priceExclTax: updated.listPrice?.toFixed(3) ?? null, pricingMode: updated.pricingMode, vatRate: updated.vatRate.toFixed(2) } });
      return updated;
    });
    return res.json({ data: product });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2025') return res.status(404).json({ error: 'Produit introuvable.' });
    const status = (error as { httpStatus?: number }).httpStatus; if (status) return res.status(status).json({ error: (error as Error).message });
    next(error);
  }
});

const productMarginPayload = z.object({ marginPercent: z.preprocess((value) => value === null || value === '' ? null : Number(value), z.union([z.number().finite().min(0).max(500), z.null()])) }).strict();
app.patch('/api/admin/products/:id/margin', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id); const payload = productMarginPayload.safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Marge spécifique invalide.', details: payload.success ? undefined : payload.error.flatten() });
  try {
    const product = await prisma.$transaction(async (tx) => {
      const current = await tx.product.findUnique({ where: { id: id.data }, select: { sku: true, name: true, marginPercent: true } });
      if (!current) throw Object.assign(new Error('Pièce introuvable.'), { code: 'P2025' });
      await tx.product.update({ where: { id: id.data }, data: { marginPercent: payload.data.marginPercent === null ? null : payload.data.marginPercent.toFixed(2), ...(payload.data.marginPercent === null ? {} : { pricingMode: 'MARGIN' as const }) } });
      await recalculateMarginPrices(tx, { productId: id.data });
      const updated = await tx.product.findUniqueOrThrow({ where: { id: id.data }, select: { id: true, sku: true, name: true, category: true, pricingMode: true, marginPercent: true, listPrice: true } });
      await recordAudit(tx, { actorId: req.user!.sub, action: payload.data.marginPercent === null ? 'PRODUCT_MARGIN_OVERRIDE_REMOVED' : 'PRODUCT_MARGIN_OVERRIDE_UPDATED', entityType: 'PRODUCT', entityId: id.data, details: { sku: current.sku, name: current.name, previousMarginPercent: current.marginPercent?.toFixed(2) ?? null, marginPercent: payload.data.marginPercent?.toFixed(2) ?? null } });
      return updated;
    });
    return res.json({ data: product, message: payload.data.marginPercent === null ? 'Marge spécifique retirée; la marge de catégorie ou générale s’applique désormais.' : 'Marge spécifique enregistrée et prix recalculé.' });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2025') return res.status(404).json({ error: 'Pièce introuvable.' });
    next(error);
  }
});

app.get('/api/admin/public-pricing', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const settings = await prisma.companySettings.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {}, select: { defaultMarginPercent: true } });
    const categories = await prisma.categoryMargin.findMany({ orderBy: { category: 'asc' }, select: { category: true, marginPercent: true } });
    return res.json({ data: { defaultMarginPercent: settings.defaultMarginPercent, categoryMargins: categories } });
  } catch (error) { next(error); }
});

app.patch('/api/admin/public-pricing/default', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const payload = z.object({ marginPercent: z.coerce.number().finite().min(0).max(500) }).strict().safeParse(req.body);
  if (!payload.success) return res.status(400).json({ error: 'Marge par défaut invalide.' });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const settings = await tx.companySettings.upsert({ where: { id: 'default' }, create: { id: 'default', defaultMarginPercent: payload.data.marginPercent.toFixed(2) }, update: { defaultMarginPercent: payload.data.marginPercent.toFixed(2) }, select: { defaultMarginPercent: true } });
      const updatedCount = await recalculateMarginPrices(tx);
      await recordAudit(tx, { actorId: req.user!.sub, action: 'DEFAULT_PRODUCT_MARGIN_UPDATED', entityType: 'COMPANY_SETTINGS', entityId: 'default', details: { marginPercent: settings.defaultMarginPercent.toFixed(2), recalculatedProducts: updatedCount } });
      return { settings, updatedCount };
    });
    return res.json({ data: result, message: 'Marge par défaut enregistrée; les prix gérés par marge ont été recalculés.' });
  } catch (error) { next(error); }
});

app.patch('/api/admin/public-pricing/categories', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const payload = z.object({ category: z.string().trim().min(2).max(100), marginPercent: z.preprocess((value) => value === null ? null : Number(value), z.union([z.number().finite().min(0).max(500), z.null()])), applyToExisting: z.boolean().default(true) }).strict().safeParse(req.body);
  if (!payload.success) return res.status(400).json({ error: 'Marge de catégorie invalide.' });
  const category = payload.data.category.toLocaleLowerCase('fr');
  try {
    const result = await prisma.$transaction(async (tx) => {
      if (payload.data.marginPercent === null) await tx.categoryMargin.deleteMany({ where: { category } });
      else await tx.categoryMargin.upsert({ where: { category }, create: { category, marginPercent: payload.data.marginPercent.toFixed(2) }, update: { marginPercent: payload.data.marginPercent.toFixed(2) } });
      const activatedCount = payload.data.marginPercent !== null && payload.data.applyToExisting
        ? (await tx.product.updateMany({ where: { category: { equals: payload.data.category, mode: 'insensitive' } }, data: { pricingMode: 'MARGIN' } })).count
        : 0;
      const updatedCount = await recalculateMarginPrices(tx);
      await recordAudit(tx, { actorId: req.user!.sub, action: payload.data.marginPercent === null ? 'CATEGORY_PRODUCT_MARGIN_REMOVED' : 'CATEGORY_PRODUCT_MARGIN_UPDATED', entityType: 'PRODUCT_CATEGORY', entityId: category, details: { category, marginPercent: payload.data.marginPercent, applyToExisting: payload.data.applyToExisting, activatedProducts: activatedCount, recalculatedProducts: updatedCount } });
      return { category, marginPercent: payload.data.marginPercent, activatedCount, updatedCount };
    });
    return res.json({ data: result, message: result.activatedCount ? `Règle appliquée à ${result.activatedCount} pièce(s) existante(s); les prix automatiques ont été recalculés.` : 'Marge de catégorie enregistrée; les prix gérés par marge ont été recalculés.' });
  } catch (error) { next(error); }
});

const supplierOfferSelect = {
  id: true, supplierId: true, supplierSku: true, purchasePrice: true, pendingPurchasePrice: true, purchaseVatRate: true, currency: true, status: true, archivedAt: true, createdAt: true, updatedAt: true,
  product: { select: { id: true, sku: true, name: true, description: true, category: true, pieceBrand: true, images: true, references: { select: { value: true, type: true } }, compatibilities: { select: { id: true, generationId: true, engineId: true, variantId: true, yearFrom: true, yearTo: true, source: true, sourceReference: true, verifiedAt: true, generation: { select: { id: true, name: true, yearFrom: true, yearTo: true, model: { select: { id: true, name: true, category: true, make: { select: { id: true, name: true } } } } } }, engine: { select: { id: true, name: true, engineCode: true, fuel: true, displacementCc: true, powerKw: true } }, variant: { select: { id: true, name: true, bodyStyle: true, transmission: true, drivetrain: true } } } } } },
  fitmentSuggestions: {
    select: {
      id: true, year: true, yearTo: true, status: true, source: true, sourceReference: true,
      makeName: true, modelName: true, generationName: true, vehicleCategory: true, engineName: true, engineCode: true, fuel: true, displacementCc: true, powerKw: true, variantName: true, bodyStyle: true, transmission: true, drivetrain: true,
      generation: { select: { id: true, name: true, model: { select: { id: true, name: true, category: true, make: { select: { id: true, name: true } } } } } },
      engine: { select: { name: true, engineCode: true, fuel: true } },
      variant: { select: { name: true, bodyStyle: true, transmission: true } },
    },
  },
} as const;
app.get('/api/partner/offers', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  try {
    const offers = await prisma.supplierOffer.findMany({ where: { supplierId: req.user!.sub }, select: supplierOfferSelect, orderBy: { createdAt: 'desc' }, take: 200 });
    return res.json({ data: offers });
  } catch (error) { next(error); }
});

app.get('/api/partner/offers/:id/price-history', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Référence d’offre invalide.' });
  try {
    const offer = await prisma.supplierOffer.findFirst({ where: { id: id.data, supplierId: req.user!.sub }, select: { id: true } });
    if (!offer) return res.status(404).json({ error: 'Offre introuvable dans votre catalogue.' });
    const events = await prisma.auditLog.findMany({ where: { entityType: 'SUPPLIER_OFFER', entityId: offer.id, action: { in: ['SUPPLIER_PRICE_INCREASE_REQUESTED', 'SUPPLIER_PRICE_INCREASE_APPROVED', 'SUPPLIER_PRICE_INCREASE_REJECTED', 'SUPPLIER_OFFER_DETAILS_UPDATED', 'SUPPLIER_OFFER_CSV_UPDATED'] } }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, action: true, details: true, createdAt: true } });
    const history = events.flatMap((event) => {
      const details = event.details && typeof event.details === 'object' && !Array.isArray(event.details) ? event.details as Prisma.JsonObject : {};
      const previous = typeof details.previousPurchasePrice === 'string' ? details.previousPurchasePrice : null;
      const requested = typeof details.requestedPurchasePrice === 'string' ? details.requestedPurchasePrice : null;
      const effective = typeof details.effectivePurchasePrice === 'string' ? details.effectivePurchasePrice : event.action === 'SUPPLIER_PRICE_INCREASE_APPROVED' ? requested : previous;
      const priceChanged = details.priceChanged === true || event.action.startsWith('SUPPLIER_PRICE_INCREASE_') || details.priceChanged === undefined && previous !== null && requested !== null && previous !== requested;
      if (!priceChanged) return [];
      return [{ id: event.id, action: event.action, previousPurchasePrice: previous, effectivePurchasePrice: effective, requestedPurchasePrice: requested, pendingApproval: details.purchasePriceIncreasePendingApproval === true || event.action === 'SUPPLIER_PRICE_INCREASE_REQUESTED', createdAt: event.createdAt }];
    });
    return res.json({ data: history });
  } catch (error) { next(error); }
});

app.patch('/api/partner/offers/:id/archive', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  const payload = z.object({ archived: z.boolean() }).strict().safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Demande d’archivage invalide.' });
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.supplierOffer.findFirst({ where: { id: id.data, supplierId: req.user!.sub }, select: { id: true, productId: true, supplierSku: true, status: true, archivedAt: true, product: { select: { name: true } } } });
      if (!current) throw Object.assign(new Error('Offre introuvable dans votre catalogue.'), { httpStatus: 404 });
      const archivedAt = payload.data.archived ? (current.archivedAt ?? new Date()) : null;
      const changed = Boolean(current.archivedAt) !== payload.data.archived;
      const offer = await tx.supplierOffer.update({ where: { id: current.id }, data: { archivedAt }, select: supplierOfferSelect });
      if (changed) await recalculateMarginPrices(tx, { productId: current.productId });
      if (changed) await recordAudit(tx, { actorId: req.user!.sub, action: payload.data.archived ? 'SUPPLIER_OFFER_ARCHIVED' : 'SUPPLIER_OFFER_RESTORED', entityType: 'SUPPLIER_OFFER', entityId: current.id, details: { supplierSku: current.supplierSku, product: current.product.name, status: current.status } });
      return offer;
    });
    return res.json({ data: updated, message: updated.archivedAt ? 'Offre archivée et retirée du catalogue public.' : 'Offre rétablie selon son statut de validation.' });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    next(error);
  }
});

app.get('/api/partner/offers/export.csv', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  try {
    const supplierId = req.user!.sub;
    const offers = await prisma.supplierOffer.findMany({
      where: { supplierId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true, supplierSku: true, purchasePrice: true, purchaseVatRate: true, status: true, updatedAt: true,
        fitmentSuggestions: {
          select: {
            year: true, yearTo: true, makeName: true, modelName: true, generationName: true, engineName: true,
            engineCode: true, fuel: true, displacementCc: true, powerKw: true, variantName: true, bodyStyle: true,
            generation: { select: { name: true, model: { select: { name: true, make: { select: { name: true } } } } } },
          },
        },
        product: {
          select: {
            sku: true, name: true, description: true, category: true, pieceBrand: true, images: true,
            references: { select: { value: true, type: true } },
          },
        },
        stockItems: { select: { onHand: true, reserved: true, damaged: true, minimumStock: true, warehouse: { select: { name: true, code: true, city: true } } } },
      },
    });
    const csvCell = (value: unknown) => {
      const textValue = value == null ? '' : String(value);
      const safe = /^[\s]*[=+\-@\t\r]/.test(textValue) ? `'${textValue}` : textValue;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const headers = ['SKU fournisseur', 'SKU GHORBEL', 'Pièce', 'Catégorie', 'Marque pièce', 'Références', 'Prix proposé HT TND', 'TVA fournisseur %', 'Statut', 'Quantité physique', 'Réservé', 'Endommagé', 'Disponible', 'Seuil stock faible', 'Entrepôts', 'Compatibilités', 'Images', 'Description', 'Dernière mise à jour'];
    const rows = offers.map((offer) => {
      const onHand = offer.stockItems.reduce((sum, item) => sum + item.onHand, 0);
      const reserved = offer.stockItems.reduce((sum, item) => sum + item.reserved, 0);
      const damaged = offer.stockItems.reduce((sum, item) => sum + item.damaged, 0);
      const available = Math.max(0, onHand - reserved - damaged);
      const minimumStock = offer.stockItems.reduce((sum, item) => sum + item.minimumStock, 0);
      const warehouses = offer.stockItems.map((item) => [item.warehouse.name, item.warehouse.code, item.warehouse.city].filter(Boolean).join(' · ')).join(' | ');
      const references = offer.product.references.map((reference) => `${reference.type}: ${reference.value}`).join(' | ');
      const fitments = offer.fitmentSuggestions.map((item) => {
        const generation = item.generation;
        const make = generation?.model.make.name || item.makeName;
        const model = generation?.model.name || item.modelName;
        const generationName = generation?.name || item.generationName;
        const years = item.yearTo && item.yearTo !== item.year ? `${item.year}-${item.yearTo}` : String(item.year);
        return [make, model, generationName, years, item.engineCode || item.engineName, item.fuel, item.displacementCc ? `${item.displacementCc} cm3` : '', item.powerKw ? `${item.powerKw} kW` : '', item.variantName, item.bodyStyle].filter(Boolean).join(' · ');
      }).join(' | ');
      return [offer.supplierSku, offer.product.sku, offer.product.name, offer.product.category, offer.product.pieceBrand, references, offer.purchasePrice.toFixed(3), offer.purchaseVatRate.toFixed(2), offer.status, onHand, reserved, damaged, available, minimumStock, warehouses, fitments, offer.product.images.join(' | '), offer.product.description, offer.updatedAt.toISOString()].map(csvCell).join(',');
    });
    await prisma.$transaction((tx) => recordAudit(tx, { actorId: supplierId, action: 'SUPPLIER_CATALOG_EXPORTED', entityType: 'SUPPLIER_CATALOG', entityId: supplierId, details: { offerCount: offers.length, format: 'CSV' } }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="catalogue-fournisseur-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(`\uFEFF${[headers.map(csvCell).join(','), ...rows].join('\r\n')}`);
  } catch (error) { next(error); }
});

const supplierOfferEditSchema = z.object({
  supplierSku: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(180).optional(),
  description: z.union([z.string().trim().max(2000), z.literal('')]).optional(),
  category: z.union([z.string().trim().max(100), z.literal('')]).optional(),
  pieceBrand: z.union([z.string().trim().max(100), z.literal('')]).optional(),
  images: z.array(z.union([z.string().url().max(2000).refine((value) => value.startsWith('https://'), 'Les photos externes doivent utiliser une URL HTTPS.'), z.string().regex(/^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i)])).max(8).optional(),
  purchasePrice: z.coerce.number().finite().positive().max(10000000).optional(),
  purchaseVatRate: z.coerce.number().finite().min(0).max(100).optional(),
  fitments: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('catalog'), generationId: z.string().uuid(), engineId: z.string().uuid().optional(), variantId: z.string().uuid().optional(), year: z.coerce.number().int().min(1900).max(2100), yearTo: z.coerce.number().int().min(1900).max(2100).optional() }).strict(),
    z.object({ mode: z.literal('manual'), makeName: z.string().trim().min(1).max(100), modelName: z.string().trim().min(1).max(100), generationName: z.string().trim().min(1).max(120), vehicleCategory: z.string().trim().max(50).optional(), yearFrom: z.coerce.number().int().min(1900).max(2100), yearTo: z.coerce.number().int().min(1900).max(2100).optional(), engineName: z.string().trim().max(120).optional(), engineCode: z.string().trim().max(80).optional(), fuel: z.string().trim().max(40).optional(), displacementCc: z.coerce.number().int().min(50).max(30000).optional(), powerKw: z.coerce.number().int().min(1).max(5000).optional(), variantName: z.string().trim().max(120).optional(), bodyStyle: z.string().trim().max(80).optional(), transmission: z.string().trim().max(80).optional(), drivetrain: z.string().trim().max(80).optional() }).strict().refine((item) => item.yearTo === undefined || item.yearTo >= item.yearFrom, { message: 'L’année de fin doit être égale ou postérieure à l’année de début.', path: ['yearTo'] }),
  ])).max(100).optional(),
}).strict().refine((data) => Object.keys(data).length > 0, 'Aucune modification fournie.');

app.patch('/api/partner/offers/:id', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  const payload = supplierOfferEditSchema.safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Informations de pièce invalides.', ...(payload.success ? {} : { details: payload.error.flatten() }) });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.supplierOffer.findFirst({ where: { id: id.data, supplierId: req.user!.sub }, select: { id: true, supplierSku: true, purchasePrice: true, pendingPurchasePrice: true, productId: true, status: true, product: { select: { name: true } } } });
      if (!current) return null;
      const input = payload.data;
      const nextPurchase = input.purchasePrice;
      const isIncrease = nextPurchase !== undefined && nextPurchase > Number(current.purchasePrice);
      const offerData: Prisma.SupplierOfferUpdateInput = {
        ...(input.supplierSku !== undefined ? { supplierSku: input.supplierSku } : {}),
        ...(input.purchaseVatRate !== undefined ? { purchaseVatRate: input.purchaseVatRate.toFixed(2) } : {}),
        ...(nextPurchase !== undefined ? (isIncrease
          ? { pendingPurchasePrice: nextPurchase.toFixed(3) }
          : { purchasePrice: nextPurchase.toFixed(3), pendingPurchasePrice: null }) : {}),
      };
      const productData: Prisma.ProductUpdateInput = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.category !== undefined ? { category: input.category || null } : {}),
        ...(input.pieceBrand !== undefined ? { pieceBrand: input.pieceBrand || null } : {}),
        ...(input.images !== undefined ? { images: input.images } : {}),
      };
      if (input.fitments !== undefined) {
        const desired: Array<{ generationId: string; engineId?: string; variantId?: string; yearFrom: number; yearTo: number | null; snapshot: Record<string, unknown> }> = [];
        for (const fitment of input.fitments) {
          if (fitment.mode === 'catalog') {
            const generation = await tx.vehicleGeneration.findFirst({ where: { id: fitment.generationId, status: { in: vehicleStatuses }, model: { status: { in: vehicleStatuses }, make: { status: { in: vehicleStatuses } } } }, include: { model: { include: { make: true } } } });
            const yearTo = fitment.yearTo ?? fitment.year;
            if (!generation || fitment.year < generation.yearFrom || yearTo < fitment.year || (generation.yearTo !== null && yearTo > generation.yearTo)) throw Object.assign(new Error('Une génération ou une plage d’années ne correspond pas au catalogue.'), { httpStatus: 400 });
            const engine = fitment.engineId ? await tx.engine.findFirst({ where: { id: fitment.engineId, generationId: generation.id, status: { in: vehicleStatuses } } }) : null;
            if (fitment.engineId && !engine) throw Object.assign(new Error('La motorisation choisie ne correspond pas à la génération.'), { httpStatus: 400 });
            const variant = fitment.variantId ? await tx.vehicleVariant.findFirst({ where: { id: fitment.variantId, generationId: generation.id, ...(fitment.engineId ? { OR: [{ engineId: fitment.engineId }, { engineId: null }] } : {}), status: { in: vehicleStatuses } } }) : null;
            if (fitment.variantId && !variant) throw Object.assign(new Error('La version choisie ne correspond pas à la génération ou à la motorisation.'), { httpStatus: 400 });
            desired.push({ generationId: generation.id, ...(engine ? { engineId: engine.id } : {}), ...(variant ? { variantId: variant.id } : {}), yearFrom: fitment.year, yearTo: yearTo === fitment.year ? null : yearTo, snapshot: { makeName: generation.model.make.name, modelName: generation.model.name, generationName: generation.name, vehicleCategory: generation.model.category, ...(engine ? { engineName: engine.name, engineCode: engine.engineCode, fuel: engine.fuel, displacementCc: engine.displacementCc, powerKw: engine.powerKw } : {}), ...(variant ? { variantName: variant.name, bodyStyle: variant.bodyStyle, transmission: variant.transmission, drivetrain: variant.drivetrain } : {}) } });
          } else {
            const taxonomy = await upsertVehicleTaxonomy(tx, { ...fitment, yearFrom: fitment.yearFrom, yearTo: fitment.yearTo }, DataStatus.CONTRIBUTED, 'Saisie partenaire');
            desired.push({ generationId: taxonomy.generationId, ...(taxonomy.engineId ? { engineId: taxonomy.engineId } : {}), ...(taxonomy.variantId ? { variantId: taxonomy.variantId } : {}), yearFrom: fitment.yearFrom, yearTo: (fitment.yearTo ?? fitment.yearFrom) === fitment.yearFrom ? null : fitment.yearTo!, snapshot: { makeName: fitment.makeName, modelName: fitment.modelName, generationName: fitment.generationName, vehicleCategory: fitment.vehicleCategory || 'Voiture particulière', engineName: fitment.engineName, engineCode: fitment.engineCode, fuel: fitment.fuel, displacementCc: fitment.displacementCc, powerKw: fitment.powerKw, variantName: fitment.variantName, bodyStyle: fitment.bodyStyle, transmission: fitment.transmission, drivetrain: fitment.drivetrain } });
          }
        }
        const key = (item: { generationId: string; engineId?: string | null; yearFrom: number; yearTo: number | null }) => `${item.generationId}:${item.engineId || ''}:${item.yearFrom}:${item.yearTo ?? ''}`;
        const unique = new Set(desired.map(key));
        if (unique.size !== desired.length) throw Object.assign(new Error('Une compatibilité véhicule est répétée.'), { httpStatus: 400 });
        await tx.partnerFitmentSuggestion.deleteMany({ where: { offerId: current.id } });
        await tx.vehicleCompatibility.deleteMany({ where: { productId: current.productId } });
        if (desired.length) await tx.vehicleCompatibility.createMany({ data: desired.map((item) => ({
          productId: current.productId, generationId: item.generationId, engineId: item.engineId, variantId: item.variantId,
          yearFrom: item.yearFrom, yearTo: item.yearTo, source: 'Déclarée par le fournisseur', verifiedAt: new Date(),
        })) });
      }
      if (Object.keys(productData).length) await tx.product.update({ where: { id: current.productId }, data: productData });
      const updated = await tx.supplierOffer.update({ where: { id: current.id }, data: offerData, select: supplierOfferSelect });
      if (Object.keys(productData).length || (!isIncrease && nextPurchase !== undefined)) await recalculateMarginPrices(tx, { productId: current.productId });
      if (isIncrease) {
        const admins = await tx.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true, email: true } });
        for (const admin of admins) await enqueueNotification(tx, { userId: admin.id, emailTo: admin.email, eventKey: `supplierOffer.priceApproval:${current.id}:${Date.now()}:${admin.id}`, title: 'Hausse de prix fournisseur à valider', message: `Une hausse du coût d’achat est proposée pour « ${current.product.name} » (${input.supplierSku ?? current.supplierSku}). Le prix actuel reste actif jusqu’à votre décision.`, link: '/admin/offers' });
      }
      const priceChanged = nextPurchase !== undefined && Number(current.purchasePrice) !== nextPurchase;
      await recordAudit(tx, { actorId: req.user!.sub, action: isIncrease ? 'SUPPLIER_PRICE_INCREASE_REQUESTED' : 'SUPPLIER_OFFER_DETAILS_UPDATED', entityType: 'SUPPLIER_OFFER', entityId: current.id, details: { changedFields: Object.keys(input), previousPurchasePrice: current.purchasePrice.toFixed(3), effectivePurchasePrice: isIncrease ? current.purchasePrice.toFixed(3) : nextPurchase?.toFixed(3) ?? current.purchasePrice.toFixed(3), purchasePriceIncreasePendingApproval: isIncrease, priceChanged, ...(isIncrease ? { requestedPurchasePrice: nextPurchase!.toFixed(3) } : {}) } });
      return { offer: updated, priceIncreasePendingApproval: isIncrease };
    });
    if (!result) return res.status(404).json({ error: 'Pièce introuvable dans votre catalogue.' });
    return res.json({ data: result.offer, priceIncreasePendingApproval: result.priceIncreasePendingApproval, message: result.priceIncreasePendingApproval ? 'Modifications enregistrées. La hausse de prix attend l’approbation de l’administrateur; le prix actuel reste actif.' : 'Modifications enregistrées.' });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ error: 'Cette référence fournisseur existe déjà dans votre compte.' });
    next(error);
  }
});

const catalogFitmentSchema = z.object({ mode: z.literal('catalog'), generationId: z.string().uuid(), engineId: z.string().uuid().optional(), variantId: z.string().uuid().optional(), year: z.coerce.number().int().min(1900).max(2100) }).strict();
const manualFitmentSchema = z.object({
  mode: z.literal('manual'), makeName: z.string().trim().min(1).max(100), modelName: z.string().trim().min(1).max(100), generationName: z.string().trim().min(1).max(120),
  vehicleCategory: z.string().trim().max(50).optional(), yearFrom: z.coerce.number().int().min(1900).max(2100), yearTo: z.coerce.number().int().min(1900).max(2100).optional(),
  engineName: z.string().trim().max(120).optional(), engineCode: z.string().trim().max(80).optional(), fuel: z.string().trim().max(40).optional(),
  displacementCc: z.coerce.number().int().min(50).max(30000).optional(), powerKw: z.coerce.number().int().min(1).max(5000).optional(),
  variantName: z.string().trim().max(120).optional(), bodyStyle: z.string().trim().max(80).optional(), transmission: z.string().trim().max(80).optional(), drivetrain: z.string().trim().max(80).optional(),
}).strict().refine((item) => item.yearTo === undefined || item.yearTo >= item.yearFrom, { message: 'L’année de fin doit être égale ou postérieure à l’année de début.', path: ['yearTo'] });
type ManualFitment = z.infer<typeof manualFitmentSchema>;
const vehicleStatuses: DataStatus[] = [DataStatus.VERIFIED, DataStatus.CONTRIBUTED];
const nextVehicleStatus = (current: DataStatus, requested: DataStatus) => current === DataStatus.VERIFIED || requested === DataStatus.VERIFIED ? DataStatus.VERIFIED : requested;
const upsertVehicleTaxonomy = async (tx: Prisma.TransactionClient, input: ManualFitment, status: DataStatus, source: string, sourceReference?: string) => {
  const makeSlug = slugify(input.makeName); const modelSlug = slugify(input.modelName);
  let make = await tx.vehicleMake.findUnique({ where: { slug: makeSlug } });
  if (!make) make = await tx.vehicleMake.create({ data: { name: input.makeName, slug: makeSlug, status, source, sourceReference } });
  else make = await tx.vehicleMake.update({ where: { id: make.id }, data: { name: make.status === DataStatus.VERIFIED && status !== DataStatus.VERIFIED ? undefined : input.makeName, status: nextVehicleStatus(make.status, status), ...(make.status === DataStatus.VERIFIED && status !== DataStatus.VERIFIED ? {} : { source, sourceReference }) } });
  let model = await tx.vehicleModel.findUnique({ where: { makeId_slug: { makeId: make.id, slug: modelSlug } } });
  if (!model) model = await tx.vehicleModel.create({ data: { makeId: make.id, name: input.modelName, slug: modelSlug, category: input.vehicleCategory || 'Voiture particulière', status, source, sourceReference } });
  else model = await tx.vehicleModel.update({ where: { id: model.id }, data: { name: model.status === DataStatus.VERIFIED && status !== DataStatus.VERIFIED ? undefined : input.modelName, category: model.status === DataStatus.VERIFIED && status !== DataStatus.VERIFIED ? undefined : input.vehicleCategory || model.category, status: nextVehicleStatus(model.status, status), ...(model.status === DataStatus.VERIFIED && status !== DataStatus.VERIFIED ? {} : { source, sourceReference }) } });
  const yearTo = input.yearTo ?? input.yearFrom;
  let generation = await tx.vehicleGeneration.findFirst({ where: { modelId: model.id, name: input.generationName, yearFrom: input.yearFrom, yearTo } });
  if (!generation) generation = await tx.vehicleGeneration.create({ data: { modelId: model.id, name: input.generationName, yearFrom: input.yearFrom, yearTo, status, source, sourceReference } });
  else generation = await tx.vehicleGeneration.update({ where: { id: generation.id }, data: { status: nextVehicleStatus(generation.status, status), ...(generation.status === DataStatus.VERIFIED && status !== DataStatus.VERIFIED ? {} : { source, sourceReference }) } });
  let engine: { id: string; status: DataStatus } | null = null;
  const engineName = input.engineName || input.engineCode;
  if (engineName) {
    engine = await tx.engine.findFirst({ where: { generationId: generation.id, name: { equals: engineName, mode: 'insensitive' }, engineCode: input.engineCode ?? null }, select: { id: true, status: true } });
    if (!engine) engine = await tx.engine.create({ data: { generationId: generation.id, name: engineName, engineCode: input.engineCode, fuel: input.fuel, displacementCc: input.displacementCc, powerKw: input.powerKw, status, source, sourceReference }, select: { id: true, status: true } });
    else engine = await tx.engine.update({ where: { id: engine.id }, data: { fuel: engine.status === DataStatus.VERIFIED && status !== DataStatus.VERIFIED ? undefined : input.fuel, displacementCc: engine.status === DataStatus.VERIFIED && status !== DataStatus.VERIFIED ? undefined : input.displacementCc, powerKw: engine.status === DataStatus.VERIFIED && status !== DataStatus.VERIFIED ? undefined : input.powerKw, status: nextVehicleStatus(engine.status, status), ...(engine.status === DataStatus.VERIFIED && status !== DataStatus.VERIFIED ? {} : { source, sourceReference }) }, select: { id: true, status: true } });
  }
  let variant: { id: string; status: DataStatus } | null = null;
  if (input.variantName) {
    variant = await tx.vehicleVariant.findFirst({ where: { generationId: generation.id, name: { equals: input.variantName, mode: 'insensitive' }, engineId: engine?.id ?? null }, select: { id: true, status: true } });
    if (!variant) variant = await tx.vehicleVariant.create({ data: { generationId: generation.id, engineId: engine?.id, name: input.variantName, bodyStyle: input.bodyStyle, transmission: input.transmission, drivetrain: input.drivetrain, status, source, sourceReference }, select: { id: true, status: true } });
    else variant = await tx.vehicleVariant.update({ where: { id: variant.id }, data: { bodyStyle: variant.status === DataStatus.VERIFIED && status !== DataStatus.VERIFIED ? undefined : input.bodyStyle, transmission: variant.status === DataStatus.VERIFIED && status !== DataStatus.VERIFIED ? undefined : input.transmission, drivetrain: variant.status === DataStatus.VERIFIED && status !== DataStatus.VERIFIED ? undefined : input.drivetrain, status: nextVehicleStatus(variant.status, status), ...(variant.status === DataStatus.VERIFIED && status !== DataStatus.VERIFIED ? {} : { source, sourceReference }) }, select: { id: true, status: true } });
  }
  return { makeId: make.id, modelId: model.id, generationId: generation.id, engineId: engine?.id, variantId: variant?.id, yearTo };
};
const supplierOfferSchema = z.object({
  supplierSku: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(180), description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(100).optional(), pieceBrand: z.string().trim().max(100).optional(),
  images: z.array(z.union([z.string().url().max(2000).refine((value) => value.startsWith('https://'), 'Les photos externes doivent utiliser une URL HTTPS.'), z.string().regex(/^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i)])).max(8).default([]),
  reference: z.string().trim().max(100).optional(), referenceType: z.enum(['OEM', 'ALTERNATIVE']).default('OEM'),
  fitment: z.object({ generationId: z.string().uuid(), engineId: z.string().uuid().optional(), variantId: z.string().uuid().optional(), year: z.coerce.number().int().min(1900).max(2100) }).strict().optional(),
  fitments: z.array(z.discriminatedUnion('mode', [catalogFitmentSchema, manualFitmentSchema])).max(100).default([]),
  purchasePrice: z.coerce.number().finite().positive().max(10000000), purchaseVatRate: z.coerce.number().finite().min(0).max(100).default(19),
}).strict();
app.post('/api/partner/offers', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  const parsed = supplierOfferSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Informations d’offre invalides.', details: parsed.error.flatten() });
  try {
    const input = parsed.data;
    const normalizedReference = input.reference ? normalizeReference(input.reference) : undefined;
    const fitments = [...(input.fitment ? [{ mode: 'catalog' as const, ...input.fitment }] : []), ...input.fitments];
    const uniqueFitments = new Set(fitments.map((item) => item.mode === 'catalog'
      ? `catalog:${item.generationId}:${item.engineId || ''}:${item.variantId || ''}:${item.year}`
      : `manual:${slugify(item.makeName)}:${slugify(item.modelName)}:${slugify(item.generationName)}:${item.engineCode || slugify(item.engineName || '')}:${item.variantName ? slugify(item.variantName) : ''}:${item.yearFrom}:${item.yearTo ?? item.yearFrom}`));
    if (uniqueFitments.size !== fitments.length) return res.status(400).json({ error: 'Une compatibilité véhicule est répétée.' });
    const offer = await prisma.$transaction(async (tx) => {
      for (const fitment of fitments) {
        if (fitment.mode === 'manual') continue;
        const { generationId, engineId, variantId, year } = fitment;
        const generation = await tx.vehicleGeneration.findFirst({ where: { id: generationId, status: { in: vehicleStatuses }, model: { status: { in: vehicleStatuses }, make: { status: { in: vehicleStatuses } } } }, select: { id: true, yearFrom: true, yearTo: true } });
        if (!generation || year < generation.yearFrom || (generation.yearTo !== null && year > generation.yearTo)) throw Object.assign(new Error('La génération ou l’année choisie ne fait pas partie du catalogue vérifié.'), { httpStatus: 400 });
        if (engineId) {
          const engine = await tx.engine.findFirst({ where: { id: engineId, generationId, status: { in: vehicleStatuses } }, select: { id: true } });
          if (!engine) throw Object.assign(new Error('La motorisation choisie ne correspond pas à la génération.'), { httpStatus: 400 });
        }
        if (variantId) {
          const variant = await tx.vehicleVariant.findFirst({ where: { id: variantId, generationId, status: { in: vehicleStatuses } }, select: { id: true, engineId: true } });
          if (!variant || (variant.engineId && variant.engineId !== engineId)) throw Object.assign(new Error('La version choisie ne correspond pas à la génération et à la motorisation.'), { httpStatus: 400 });
        }
      }
      const pricingMode = await pricingModeForNewProduct(tx, input.category);
      const product = await tx.product.create({
        data: {
          sku: `PARTNER-${req.user!.sub.slice(0, 8)}-${randomUUID().slice(0, 8)}`,
          name: input.name, description: input.description, category: input.category, pieceBrand: input.pieceBrand, images: input.images, status: DataStatus.DEMONSTRATION,
          pricingMode,
          ...(input.reference && normalizedReference ? { references: { create: { value: input.reference, normalized: normalizedReference, type: input.referenceType, source: 'soumis par le partenaire' } } } : {}),
        },
      });
      const suggestions = [];
      for (const fitment of fitments) {
        if (fitment.mode === 'catalog') {
          suggestions.push({ generationId: fitment.generationId, engineId: fitment.engineId, variantId: fitment.variantId, year: fitment.year });
          continue;
        }
        const taxonomy = await upsertVehicleTaxonomy(tx, fitment, DataStatus.CONTRIBUTED, 'Saisie partenaire');
        const year = fitment.yearFrom; const yearTo = fitment.yearTo ?? fitment.yearFrom;
        suggestions.push({ generationId: taxonomy.generationId, engineId: taxonomy.engineId, variantId: taxonomy.variantId, year, yearTo, makeName: fitment.makeName, modelName: fitment.modelName, generationName: fitment.generationName, vehicleCategory: fitment.vehicleCategory, engineName: fitment.engineName, engineCode: fitment.engineCode, fuel: fitment.fuel, displacementCc: fitment.displacementCc, powerKw: fitment.powerKw, variantName: fitment.variantName, bodyStyle: fitment.bodyStyle, transmission: fitment.transmission, drivetrain: fitment.drivetrain });
      }
      if (suggestions.length) await tx.vehicleCompatibility.createMany({ data: suggestions.map((item) => ({ productId: product.id, generationId: item.generationId, engineId: item.engineId, variantId: item.variantId, yearFrom: item.year, yearTo: item.yearTo ?? null, source: 'Déclarée par le fournisseur', verifiedAt: new Date() })) });
      const createdOffer = await tx.supplierOffer.create({ data: { supplierId: req.user!.sub, productId: product.id, supplierSku: input.supplierSku, purchasePrice: input.purchasePrice.toFixed(3), purchaseVatRate: input.purchaseVatRate.toFixed(2) }, select: supplierOfferSelect });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'SUPPLIER_OFFER_CREATED', entityType: 'SUPPLIER_OFFER', entityId: createdOffer.id, details: { product: input.name, supplierSku: input.supplierSku } });
      return createdOffer;
    });
    return res.status(201).json({ data: offer, message: 'Offre soumise à validation. Elle n’est pas visible dans le catalogue public.' });
  } catch (error) {
    if ((error as { httpStatus?: number }).httpStatus === 400) return res.status(400).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ error: 'Cette référence fournisseur existe déjà dans votre compte.' });
    next(error);
  }
});

type SupplierCsvFitment = { make: string; model: string; generation: string; year: number; engineCode?: string; variant?: string };
type SupplierCsvLine = { line: number; supplierSku: string; name: string; errors: string[]; action?: 'CREATE' | 'UPDATE'; existingOfferId?: string; fitment?: SupplierCsvFitment; resolvedFitment?: { generationId: string; engineId?: string; variantId?: string; year: number }; input?: z.infer<typeof supplierOfferSchema> };
const parseSupplierOffersCsv = (csv: string): SupplierCsvLine[] => {
  const records = parseCsv(csv, detectCsvDelimiter(csv));
  if (records.length < 2) throw new Error('Le CSV doit contenir une ligne d’en-tête et au moins une offre.');
  if (records.length - 1 > 500) throw new Error('Un import fournisseur est limité à 500 offres.');
  const headers = records[0].map(headerName);
  if (new Set(headers).size !== headers.length) throw new Error('Le fichier contient des colonnes en double.');
  for (const required of ['suppliersku', 'name', 'purchaseprice']) if (!headers.includes(required)) throw new Error(`La colonne ${required} est obligatoire.`);
  const seen = new Set<string>();
  return records.slice(1).map((cells, index) => {
    const row: Record<string, string> = {}; headers.forEach((header, column) => { row[header] = (cells[column] ?? '').trim(); });
    const sku = row.suppliersku || ''; const name = row.name || '';
    const images = (row.images || '').split('|').map((url) => url.trim()).filter(Boolean);
    const fitmentNames = { make: row.make || '', model: row.model || '', generation: row.generation || '', year: Number(row.year), engineCode: row.enginecode || undefined, variant: row.variant || undefined };
    const hasFitment = Boolean(fitmentNames.make || fitmentNames.model || fitmentNames.generation || row.year || fitmentNames.engineCode || fitmentNames.variant);
    const raw = {
      supplierSku: sku, name, description: row.description || undefined, category: row.category || undefined, pieceBrand: row.piecebrand || undefined,
      reference: row.reference || undefined, referenceType: row.referencetype ? row.referencetype.toUpperCase() : 'OEM', images,
      purchasePrice: row.purchaseprice, purchaseVatRate: row.purchasevatrate || 19,
    };
    const parsed = supplierOfferSchema.safeParse(raw);
    const errors = parsed.success ? [] : Object.values(parsed.error.flatten().fieldErrors).flat().filter((value): value is string => Boolean(value));
    if (hasFitment && (!fitmentNames.make || !fitmentNames.model || !fitmentNames.generation || !Number.isInteger(fitmentNames.year) || fitmentNames.year < 1900 || fitmentNames.year > 2100)) errors.push('Compatibilité : make, model, generation et year (1900–2100) sont requis ensemble.');
    const key = sku.toLocaleUpperCase('fr-TN');
    if (key && seen.has(key)) errors.push('Cette référence fournisseur apparaît plusieurs fois dans le fichier.');
    if (key) seen.add(key);
    return { line: index + 2, supplierSku: sku, name, errors, ...(hasFitment && !errors.some((error) => error.startsWith('Compatibilité')) ? { fitment: fitmentNames } : {}), ...(parsed.success && !errors.length ? { input: parsed.data } : {}) };
  });
};
const resolveSupplierCsvFitment = async (db: Pick<Prisma.TransactionClient, 'vehicleGeneration' | 'engine' | 'vehicleVariant'>, fitment?: SupplierCsvFitment) => {
  if (!fitment) return undefined;
  const generation = await db.vehicleGeneration.findFirst({ where: { name: { equals: fitment.generation, mode: 'insensitive' }, status: DataStatus.VERIFIED, yearFrom: { lte: fitment.year }, OR: [{ yearTo: null }, { yearTo: { gte: fitment.year } }], model: { name: { equals: fitment.model, mode: 'insensitive' }, status: DataStatus.VERIFIED, make: { name: { equals: fitment.make, mode: 'insensitive' }, status: DataStatus.VERIFIED } } }, select: { id: true } });
  if (!generation) throw new Error(`Compatibilité introuvable ou non vérifiée : ${fitment.make} ${fitment.model} ${fitment.generation} ${fitment.year}.`);
  const engine = fitment.engineCode ? await db.engine.findFirst({ where: { generationId: generation.id, status: DataStatus.VERIFIED, OR: [{ engineCode: { equals: fitment.engineCode, mode: 'insensitive' } }, { name: { equals: fitment.engineCode, mode: 'insensitive' } }] }, select: { id: true } }) : null;
  if (fitment.engineCode && !engine) throw new Error(`Motorisation vérifiée introuvable : ${fitment.engineCode}.`);
  const variant = fitment.variant ? await db.vehicleVariant.findFirst({ where: { generationId: generation.id, status: DataStatus.VERIFIED, name: { equals: fitment.variant, mode: 'insensitive' }, ...(engine ? { OR: [{ engineId: engine.id }, { engineId: null }] } : {}) }, select: { id: true, engineId: true } }) : null;
  if (fitment.variant && (!variant || (variant.engineId && variant.engineId !== engine?.id))) throw new Error(`Version vérifiée introuvable ou incompatible : ${fitment.variant}.`);
  return { generationId: generation.id, ...(engine ? { engineId: engine.id } : {}), ...(variant ? { variantId: variant.id } : {}), year: fitment.year };
};
const validateSupplierCsvFitments = async (rows: SupplierCsvLine[], db: Pick<Prisma.TransactionClient, 'vehicleGeneration' | 'engine' | 'vehicleVariant'>) => {
  const rowsWithFitment = rows.filter((row) => !row.errors.length && row.fitment);
  for (let start = 0; start < rowsWithFitment.length; start += 20) {
    await Promise.all(rowsWithFitment.slice(start, start + 20).map(async (row) => {
      try { row.resolvedFitment = await resolveSupplierCsvFitment(db, row.fitment); }
      catch (error) { row.errors.push((error as Error).message); delete row.input; }
    }));
  }
};
const supplierImportReport = (rows: SupplierCsvLine[]) => rows.map(({ line, supplierSku, name, errors, action }) => ({ line, supplierSku, name, errors, action: action || 'CREATE' }));
const supplierImportSchema = z.object({ fileName: z.string().trim().min(1).max(200).default('offres-fournisseur.csv'), csv: z.string().min(1).max(2_000_000).refine((value) => Buffer.byteLength(value, 'utf8') <= 2_000_000, 'Le fichier dépasse la limite de 2 Mo.') }).strict();
app.post('/api/partner/offers/import/preview', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  const payload = supplierImportSchema.safeParse(req.body);
  if (!payload.success) return res.status(400).json({ error: 'Fichier fournisseur invalide.', details: payload.error.flatten() });
  try {
    const rows = parseSupplierOffersCsv(payload.data.csv);
    const existing = await prisma.supplierOffer.findMany({ where: { supplierId: req.user!.sub }, select: { id: true, supplierSku: true } });
    const existingSkus = new Map(existing.map((offer) => [offer.supplierSku.toLocaleUpperCase('fr-TN'), offer.id]));
    for (const row of rows) if (row.supplierSku && existingSkus.has(row.supplierSku.toLocaleUpperCase('fr-TN'))) { row.action = 'UPDATE'; row.existingOfferId = existingSkus.get(row.supplierSku.toLocaleUpperCase('fr-TN')); } else row.action = 'CREATE';
    await validateSupplierCsvFitments(rows, prisma);
    return res.json({ data: { fileName: payload.data.fileName, rowCount: rows.length, acceptedRows: rows.filter((row) => !row.errors.length).length, rejectedRows: rows.filter((row) => row.errors.length).length, rows: supplierImportReport(rows) } });
  } catch (error) { return res.status(400).json({ error: (error as Error).message }); }
});
app.post('/api/partner/offers/import/commit', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  const payload = supplierImportSchema.safeParse(req.body);
  if (!payload.success) return res.status(400).json({ error: 'Fichier fournisseur invalide.', details: payload.error.flatten() });
  try {
    const rows = parseSupplierOffersCsv(payload.data.csv);
    const existing = await prisma.supplierOffer.findMany({ where: { supplierId: req.user!.sub }, select: { id: true, supplierSku: true } });
    const existingSkus = new Map(existing.map((offer) => [offer.supplierSku.toLocaleUpperCase('fr-TN'), offer.id]));
    for (const row of rows) if (row.supplierSku && existingSkus.has(row.supplierSku.toLocaleUpperCase('fr-TN'))) { row.action = 'UPDATE'; row.existingOfferId = existingSkus.get(row.supplierSku.toLocaleUpperCase('fr-TN')); } else row.action = 'CREATE';
    await validateSupplierCsvFitments(rows, prisma);
    const validRows = rows.filter((row): row is SupplierCsvLine & { input: z.infer<typeof supplierOfferSchema> } => !row.errors.length && Boolean(row.input));
    if (!validRows.length) return res.status(400).json({ error: 'Aucune ligne valide à importer.', data: { rowCount: rows.length, acceptedRows: 0, rejectedRows: rows.length, rows: supplierImportReport(rows) } });
    const imported = await prisma.$transaction(async (tx) => {
      const offers: { id: string; supplierSku: string; action: 'CREATE' | 'UPDATE' }[] = [];
      for (const row of validRows) {
        const input = row.input; const normalizedReference = input.reference ? normalizeReference(input.reference) : undefined;
        const fitment = row.resolvedFitment;
        if (row.action === 'UPDATE' && row.existingOfferId) {
          const current = await tx.supplierOffer.findFirst({ where: { id: row.existingOfferId, supplierId: req.user!.sub }, select: { id: true, supplierSku: true, productId: true, purchasePrice: true, product: { select: { name: true } } } });
          if (!current) throw Object.assign(new Error(`La référence ${row.supplierSku} n’existe plus. Actualisez l’aperçu puis réessayez.`), { httpStatus: 409 });
          const increase = input.purchasePrice > Number(current.purchasePrice);
          await tx.product.update({ where: { id: current.productId }, data: { name: input.name, ...(input.description !== undefined ? { description: input.description || null } : {}), ...(input.category !== undefined ? { category: input.category || null } : {}), ...(input.pieceBrand !== undefined ? { pieceBrand: input.pieceBrand || null } : {}), ...(input.images.length ? { images: input.images } : {}) } });
          await tx.supplierOffer.update({ where: { id: current.id }, data: { supplierSku: input.supplierSku, purchaseVatRate: input.purchaseVatRate.toFixed(2), ...(increase ? { pendingPurchasePrice: input.purchasePrice.toFixed(3) } : { purchasePrice: input.purchasePrice.toFixed(3), pendingPurchasePrice: null }) } });
          if (input.reference && normalizedReference) {
            await tx.productReference.deleteMany({ where: { productId: current.productId, source: 'soumis par le partenaire' } });
            await tx.productReference.create({ data: { productId: current.productId, value: input.reference, normalized: normalizedReference, type: input.referenceType, source: 'soumis par le partenaire' } });
          }
          if (fitment) {
            await tx.vehicleCompatibility.deleteMany({ where: { productId: current.productId, source: 'Déclarée par le fournisseur' } });
            await tx.vehicleCompatibility.create({ data: { productId: current.productId, generationId: fitment.generationId, engineId: fitment.engineId, variantId: fitment.variantId, yearFrom: fitment.year, source: 'Déclarée par le fournisseur', verifiedAt: new Date() } });
          }
          if (!increase) await recalculateMarginPrices(tx, { productId: current.productId });
          if (increase) {
            const admins = await tx.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true, email: true } });
            for (const admin of admins) await enqueueNotification(tx, { userId: admin.id, emailTo: admin.email, eventKey: `supplierOffer.priceApproval:${current.id}:csv:${Date.now()}:${admin.id}`, title: 'Hausse de prix fournisseur à valider', message: `Une hausse du coût d’achat est proposée pour « ${input.name} » (${input.supplierSku}). Le prix actuel reste actif jusqu’à votre décision.`, link: '/admin/offers' });
          }
          const priceChanged = input.purchasePrice !== Number(current.purchasePrice);
          await recordAudit(tx, { actorId: req.user!.sub, action: increase ? 'SUPPLIER_PRICE_INCREASE_REQUESTED' : 'SUPPLIER_OFFER_CSV_UPDATED', entityType: 'SUPPLIER_OFFER', entityId: current.id, details: { supplierSku: input.supplierSku, purchasePriceIncreasePendingApproval: increase, priceChanged, effectivePurchasePrice: increase ? current.purchasePrice.toFixed(3) : input.purchasePrice.toFixed(3), requestedPurchasePrice: increase ? input.purchasePrice.toFixed(3) : undefined, previousPurchasePrice: current.purchasePrice.toFixed(3), source: 'CSV' } });
          offers.push({ id: current.id, supplierSku: input.supplierSku, action: 'UPDATE' });
          continue;
        }
        const pricingMode = await pricingModeForNewProduct(tx, input.category);
        const product = await tx.product.create({ data: { sku: `PARTNER-${req.user!.sub.slice(0, 8)}-${randomUUID().slice(0, 8)}`, name: input.name, description: input.description, category: input.category, pieceBrand: input.pieceBrand, images: input.images, status: DataStatus.DEMONSTRATION, pricingMode, ...(input.reference && normalizedReference ? { references: { create: { value: input.reference, normalized: normalizedReference, type: input.referenceType, source: 'soumis par le partenaire' } } } : {}) }, select: { id: true } });
        if (fitment) await tx.vehicleCompatibility.create({ data: { productId: product.id, generationId: fitment.generationId, engineId: fitment.engineId, variantId: fitment.variantId, yearFrom: fitment.year, source: 'Déclarée par le fournisseur', verifiedAt: new Date() } });
        const created = await tx.supplierOffer.create({ data: { supplierId: req.user!.sub, productId: product.id, supplierSku: input.supplierSku, purchasePrice: input.purchasePrice.toFixed(3), purchaseVatRate: input.purchaseVatRate.toFixed(2) }, select: { id: true, supplierSku: true } });
        offers.push({ ...created, action: 'CREATE' });
      }
      return offers;
    }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 30000 });
    const createdCount = imported.filter((offer) => offer.action === 'CREATE').length; const updatedCount = imported.length - createdCount;
    return res.status(200).json({ data: { importedRows: imported.length, createdRows: createdCount, updatedRows: updatedCount, rejectedRows: rows.filter((row) => row.errors.length).length, offers: imported, rows: supplierImportReport(rows) }, message: `${createdCount} offre(s) ajoutée(s) et ${updatedCount} mise(s) à jour. Les hausses de prix restent soumises à validation GHORBEL.` });
  } catch (error) {
    if ((error as { httpStatus?: number }).httpStatus === 400) return res.status(400).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ error: 'Une référence fournisseur a été créée entre l’aperçu et la confirmation. Actualisez l’aperçu puis réessayez.' });
    if ((error as { code?: string }).code === 'P2034') return res.status(409).json({ error: 'Un import concurrent a modifié les offres. Actualisez l’aperçu puis réessayez.' });
    next(error);
  }
});

app.get('/api/partner/inventory', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  if (req.user!.role !== 'SUPPLIER' && req.user!.role !== 'RESELLER') return res.status(403).json({ error: 'L’inventaire est réservé aux partenaires.' });
  try {
    const supplierId = req.user!.sub;
    let warehouses = await prisma.warehouse.findMany({ where: { OR: [{ ownerId: supplierId }, { ownerId: null }] }, select: { id: true, code: true, name: true, city: true, ownerId: true }, orderBy: { name: 'asc' } });
    // Suppliers hold their own stock, so always provision a private warehouse
    // rather than making stock entry depend on an admin-created shared depot.
    if (!warehouses.some((warehouse) => warehouse.ownerId === supplierId)) {
      const code = `SUP-${supplierId.slice(0, 8).toUpperCase()}`;
      await prisma.warehouse.upsert({ where: { code }, create: { code, name: 'Stock principal', ownerId: supplierId }, update: {} });
      warehouses = await prisma.warehouse.findMany({ where: { OR: [{ ownerId: supplierId }, { ownerId: null }] }, select: { id: true, code: true, name: true, city: true, ownerId: true }, orderBy: { name: 'asc' } });
    }
    warehouses.sort((a, b) => Number(b.ownerId === supplierId) - Number(a.ownerId === supplierId) || a.name.localeCompare(b.name));
    const [items, movements] = await Promise.all([
      prisma.stockItem.findMany({ where: { offer: { supplierId } }, include: { warehouse: { select: { id: true, code: true, name: true, city: true } }, offer: { select: { id: true, supplierSku: true, status: true, product: { select: { sku: true, name: true } } } } }, orderBy: [{ warehouse: { name: 'asc' } }, { offer: { product: { name: 'asc' } } }] }),
      prisma.stockMovement.findMany({ where: { offer: { supplierId } }, select: { id: true, type: true, quantity: true, reason: true, createdAt: true, warehouse: { select: { code: true, name: true } }, offer: { select: { supplierSku: true, product: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    return res.json({ data: { warehouses, items: items.map(({ onHand, reserved, onOrder, damaged, ...item }) => ({ ...item, onHand, reserved, onOrder, damaged, available: onHand - reserved - damaged })), movements } });
  } catch (error) { next(error); }
});

const offerAvailabilityPayload = z.object({ warehouseId: z.string().uuid(), availableQuantity: z.coerce.number().int().min(0).max(1000000) }).strict();
app.patch('/api/partner/offers/:id/availability', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  if (req.user!.role !== 'SUPPLIER' && req.user!.role !== 'RESELLER') return res.status(403).json({ error: 'Le stock est réservé aux partenaires.' });
  const id = uuid.safeParse(req.params.id); const payload = offerAvailabilityPayload.safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Entrepôt ou quantité disponible invalide.' });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const [offer, warehouse] = await Promise.all([
        tx.supplierOffer.findFirst({ where: { id: id.data, supplierId: req.user!.sub }, select: { id: true, status: true } }),
        tx.warehouse.findFirst({ where: { id: payload.data.warehouseId, OR: [{ ownerId: req.user!.sub }, { ownerId: null }] }, select: { id: true } }),
      ]);
      if (!offer || !warehouse) throw Object.assign(new Error('Offre ou entrepôt introuvable.'), { httpStatus: 404 });
      if (offer.status !== 'APPROVED') throw Object.assign(new Error('L’offre doit être approuvée avant la gestion du stock.'), { httpStatus: 409 });
      const stock = await tx.stockItem.upsert({ where: { warehouseId_offerId: { warehouseId: warehouse.id, offerId: offer.id } }, create: { warehouseId: warehouse.id, offerId: offer.id }, update: {} });
      const onHand = payload.data.availableQuantity + stock.reserved + stock.damaged;
      const delta = onHand - stock.onHand;
      const saved = await tx.stockItem.updateMany({ where: { id: stock.id, onHand: stock.onHand, reserved: stock.reserved, damaged: stock.damaged }, data: { onHand } });
      if (!saved.count) throw Object.assign(new Error('Le stock a changé entre-temps. Actualisez puis réessayez.'), { httpStatus: 409 });
      if (delta) await tx.stockMovement.create({ data: { stockItemId: stock.id, warehouseId: warehouse.id, offerId: offer.id, type: 'ADJUSTMENT', quantity: delta, reason: `Disponible fixé à ${payload.data.availableQuantity} par le fournisseur`, actorId: req.user!.sub } });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'SUPPLIER_STOCK_AVAILABILITY_CHANGED', entityType: 'STOCK_ITEM', entityId: stock.id, details: { previousAvailable: stock.onHand - stock.reserved - stock.damaged, availableQuantity: payload.data.availableQuantity } });
      return { id: stock.id, onHand, reserved: stock.reserved, damaged: stock.damaged, available: payload.data.availableQuantity };
    }, { isolationLevel: 'Serializable' });
    return res.json({ data: result, message: result.available > 0 ? 'Disponibilité mise à jour.' : 'Article mis hors stock; les nouvelles commandes sont bloquées.' });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2034') return res.status(409).json({ error: 'Le stock a changé entre-temps. Actualisez puis réessayez.' });
    next(error);
  }
});

const availableStockPayload = z.object({ availableQuantity: z.coerce.number().int().min(0).max(1000000) }).strict();
app.patch('/api/partner/inventory/:stockItemId/availability', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  if (req.user!.role !== 'SUPPLIER' && req.user!.role !== 'RESELLER') return res.status(403).json({ error: 'Le stock est réservé aux partenaires.' });
  const id = uuid.safeParse(req.params.stockItemId); const payload = availableStockPayload.safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Quantité disponible invalide.' });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const stock = await tx.stockItem.findFirst({ where: { id: id.data, offer: { supplierId: req.user!.sub } }, select: { id: true, warehouseId: true, offerId: true, onHand: true, reserved: true, damaged: true, offer: { select: { status: true } } } });
      if (!stock) throw Object.assign(new Error('Ligne de stock introuvable.'), { httpStatus: 404 });
      if (stock.offer.status !== 'APPROVED') throw Object.assign(new Error('Seules les offres approuvées peuvent être mises en stock.'), { httpStatus: 409 });
      const onHand = payload.data.availableQuantity + stock.reserved + stock.damaged;
      const delta = onHand - stock.onHand;
      const saved = await tx.stockItem.updateMany({ where: { id: stock.id, onHand: stock.onHand, reserved: stock.reserved, damaged: stock.damaged }, data: { onHand } });
      if (!saved.count) throw Object.assign(new Error('Le stock a changé entre-temps. Actualisez puis réessayez.'), { httpStatus: 409 });
      if (delta !== 0) await tx.stockMovement.create({ data: { stockItemId: stock.id, warehouseId: stock.warehouseId, offerId: stock.offerId, type: 'ADJUSTMENT', quantity: delta, reason: `Disponible fixé à ${payload.data.availableQuantity} par le fournisseur`, actorId: req.user!.sub } });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'SUPPLIER_STOCK_AVAILABILITY_CHANGED', entityType: 'STOCK_ITEM', entityId: stock.id, details: { previousAvailable: stock.onHand - stock.reserved - stock.damaged, availableQuantity: payload.data.availableQuantity } });
      return { id: stock.id, onHand, reserved: stock.reserved, damaged: stock.damaged, available: payload.data.availableQuantity };
    }, { isolationLevel: 'Serializable' });
    return res.json({ data: result, message: result.available > 0 ? 'Disponibilité mise à jour.' : 'Article mis hors stock; les nouvelles commandes sont bloquées.' });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2034') return res.status(409).json({ error: 'Le stock a changé entre-temps. Actualisez puis réessayez.' });
    next(error);
  }
});

const bulkAvailabilityPayload = z.object({ stockItemIds: z.array(z.string().uuid()).min(1).max(100), availableQuantity: z.coerce.number().int().min(0).max(1000000) }).strict().refine((value) => new Set(value.stockItemIds).size === value.stockItemIds.length, 'Les lignes de stock ne doivent pas être dupliquées.');
app.patch('/api/partner/inventory/bulk-availability', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  if (req.user!.role !== 'SUPPLIER' && req.user!.role !== 'RESELLER') return res.status(403).json({ error: 'Le stock est réservé aux partenaires.' });
  const payload = bulkAvailabilityPayload.safeParse(req.body);
  if (!payload.success) return res.status(400).json({ error: 'Sélection ou quantité invalide.', details: payload.error.flatten() });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.stockItem.findMany({ where: { id: { in: payload.data.stockItemIds }, offer: { supplierId: req.user!.sub } }, select: { id: true, warehouseId: true, offerId: true, onHand: true, reserved: true, damaged: true, offer: { select: { supplierSku: true, status: true } } } });
      if (rows.length !== payload.data.stockItemIds.length) throw Object.assign(new Error('Une ou plusieurs lignes de stock sont introuvables.'), { httpStatus: 404 });
      if (rows.some((row) => row.offer.status !== 'APPROVED')) throw Object.assign(new Error('Seules les offres approuvées peuvent être mises à jour en masse.'), { httpStatus: 409 });
      for (const row of rows) {
        const onHand = payload.data.availableQuantity + row.reserved + row.damaged;
        const delta = onHand - row.onHand;
        if (!delta) continue;
        const saved = await tx.stockItem.updateMany({ where: { id: row.id, onHand: row.onHand, reserved: row.reserved, damaged: row.damaged }, data: { onHand } });
        if (!saved.count) throw Object.assign(new Error('Le stock a changé pendant l’opération. Actualisez puis réessayez.'), { httpStatus: 409 });
        await tx.stockMovement.create({ data: { stockItemId: row.id, warehouseId: row.warehouseId, offerId: row.offerId, type: 'ADJUSTMENT', quantity: delta, reason: `Disponible fixé à ${payload.data.availableQuantity} en mise à jour groupée`, actorId: req.user!.sub } });
        await recordAudit(tx, { actorId: req.user!.sub, action: 'SUPPLIER_STOCK_AVAILABILITY_CHANGED', entityType: 'STOCK_ITEM', entityId: row.id, details: { previousAvailable: row.onHand - row.reserved - row.damaged, availableQuantity: payload.data.availableQuantity, bulkUpdate: true } });
      }
      return { updatedCount: rows.length, availableQuantity: payload.data.availableQuantity };
    }, { isolationLevel: 'Serializable' });
    return res.json({ data: result, message: `${result.updatedCount} stock(s) mis à jour. ${result.availableQuantity === 0 ? 'Les nouvelles commandes sont bloquées pour ces pièces.' : ''}` });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2034') return res.status(409).json({ error: 'Un stock a changé pendant l’opération. Actualisez puis réessayez.' });
    next(error);
  }
});

const minimumStockPayload = z.object({ minimumStock: z.coerce.number().int().min(0).max(1000000) }).strict();
app.patch('/api/partner/inventory/:stockItemId/minimum-stock', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  if (req.user!.role !== 'SUPPLIER' && req.user!.role !== 'RESELLER') return res.status(403).json({ error: 'Réglage réservé aux partenaires.' });
  const id = uuid.safeParse(req.params.stockItemId); const payload = minimumStockPayload.safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Seuil de stock invalide.' });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const stock = await tx.stockItem.findFirst({ where: { id: id.data, offer: { supplierId: req.user!.sub } }, select: { id: true, minimumStock: true } });
      if (!stock) throw Object.assign(new Error('Ligne de stock introuvable.'), { httpStatus: 404 });
      const updated = await tx.stockItem.update({ where: { id: stock.id }, data: { minimumStock: payload.data.minimumStock }, select: { id: true, minimumStock: true, onHand: true, reserved: true, damaged: true } });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'SUPPLIER_STOCK_MINIMUM_CHANGED', entityType: 'STOCK_ITEM', entityId: stock.id, details: { from: stock.minimumStock, to: updated.minimumStock } });
      return { ...updated, available: updated.onHand - updated.reserved - updated.damaged };
    });
    return res.json({ data: result });
  } catch (error) { const status = (error as { httpStatus?: number }).httpStatus; if (status) return res.status(status).json({ error: (error as Error).message }); next(error); }
});

app.post('/api/partner/inventory/movements', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  if (req.user!.role !== 'SUPPLIER' && req.user!.role !== 'RESELLER') return res.status(403).json({ error: 'L’inventaire est réservé aux partenaires.' });
  const payload = z.object({ warehouseId: z.string().uuid(), offerId: z.string().uuid(), type: z.enum(['RECEIPT', 'ADJUSTMENT', 'DAMAGE']), quantity: z.coerce.number().int().min(-1000000).max(1000000).refine((value) => value !== 0), reason: z.string().trim().min(3).max(240) }).strict().safeParse(req.body);
  if (!payload.success) return res.status(400).json({ error: 'Mouvement de stock invalide.', details: payload.error.flatten() });
  const { warehouseId, offerId, type, quantity, reason } = payload.data;
  if ((type === 'RECEIPT' || type === 'DAMAGE') && quantity < 0) return res.status(400).json({ error: 'La quantité doit être positive pour ce mouvement.' });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const supplierId = req.user!.sub;
      const [warehouse, offer] = await Promise.all([
        tx.warehouse.findFirst({ where: { id: warehouseId, OR: [{ ownerId: supplierId }, { ownerId: null }] }, select: { id: true } }),
        tx.supplierOffer.findFirst({ where: { id: offerId, supplierId, status: 'APPROVED' }, select: { id: true } }),
      ]);
      if (!warehouse || !offer) throw Object.assign(new Error('Entrepôt ou offre approuvée introuvable.'), { httpStatus: 404 });
      const stock = await tx.stockItem.upsert({ where: { warehouseId_offerId: { warehouseId, offerId } }, create: { warehouseId, offerId }, update: {} });
      const available = stock.onHand - stock.reserved - stock.damaged;
      let update: { onHand?: { increment: number }; damaged?: { increment: number } };
      if (type === 'RECEIPT') update = { onHand: { increment: quantity } };
      else if (type === 'DAMAGE') {
        if (quantity > available) throw Object.assign(new Error('Quantité endommagée supérieure au stock disponible.'), { httpStatus: 409 });
        update = { damaged: { increment: quantity } };
      } else {
        if (stock.onHand + quantity < stock.reserved + stock.damaged) throw Object.assign(new Error('Ajustement refusé : le stock disponible ne peut pas devenir négatif.'), { httpStatus: 409 });
        update = { onHand: { increment: quantity } };
      }
      const updated = await tx.stockItem.update({ where: { id: stock.id }, data: update });
      const movement = await tx.stockMovement.create({ data: { stockItemId: stock.id, warehouseId, offerId, type, quantity, reason, actorId: supplierId } });
      return { movement, available: updated.onHand - updated.reserved - updated.damaged };
    }, { isolationLevel: 'Serializable' });
    return res.status(201).json({ data: result });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2034') return res.status(409).json({ error: 'Mouvement simultané détecté. Rechargez l’inventaire puis réessayez.' });
    next(error);
  }
});

app.get('/api/admin/supplier-offers', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const offers = await prisma.supplierOffer.findMany({ select: { ...supplierOfferSelect, supplier: { select: { id: true, email: true, phone: true, companyName: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return res.json({ data: offers });
  } catch (error) { next(error); }
});

app.patch('/api/admin/supplier-offers/:id/status', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  const payload = z.object({ status: z.enum(['APPROVED', 'REJECTED']) }).safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Offre ou statut invalide.' });
  try {
    const offer = await prisma.$transaction(async (tx) => {
      const current = await tx.supplierOffer.findUnique({ where: { id: id.data }, select: { id: true, productId: true, status: true, supplierId: true, supplier: { select: { email: true } }, product: { select: { name: true } } } });
      if (!current || !current.supplierId || !current.supplier) throw Object.assign(new Error('Offre ou fournisseur introuvable.'), { httpStatus: 404 });
      const updated = await tx.supplierOffer.update({ where: { id: current.id }, data: { status: payload.data.status }, select: supplierOfferSelect });
      if (current.status !== payload.data.status) await recalculateMarginPrices(tx, { productId: current.productId });
      if (current.status !== payload.data.status) await enqueueNotification(tx, { userId: current.supplierId, emailTo: current.supplier.email, eventKey: `supplierOffer.status:${current.id}:${payload.data.status}:${Date.now()}`, title: payload.data.status === 'APPROVED' ? 'Pièce fournisseur approuvée' : 'Pièce fournisseur refusée', message: `Votre proposition « ${current.product.name} » a été ${payload.data.status === 'APPROVED' ? 'approuvée' : 'refusée'} par Ghorbel Automative Supply Group. Connectez-vous à votre espace partenaire pour consulter vos offres.`, link: '/partner' });
      if (current.status !== payload.data.status) await recordAudit(tx, { actorId: req.user!.sub, action: payload.data.status === 'APPROVED' ? 'SUPPLIER_OFFER_APPROVED' : 'SUPPLIER_OFFER_REJECTED', entityType: 'SUPPLIER_OFFER', entityId: current.id, details: { from: current.status, to: payload.data.status, product: current.product.name } });
      return updated;
    });
    return res.json({ data: offer });
  } catch (error) {
    if ((error as { httpStatus?: number }).httpStatus === 404) return res.status(404).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2025') return res.status(404).json({ error: 'Offre introuvable.' });
    next(error);
  }
});

app.patch('/api/admin/supplier-offers/:id/pending-price', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  const payload = z.object({ decision: z.enum(['APPROVE', 'REJECT']) }).strict().safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Décision de prix invalide.' });
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.supplierOffer.findUnique({ where: { id: id.data }, select: { id: true, productId: true, supplierId: true, supplierSku: true, purchasePrice: true, pendingPurchasePrice: true, supplier: { select: { email: true } }, product: { select: { name: true } } } });
      if (!current || !current.supplierId || !current.supplier) throw Object.assign(new Error('Offre ou fournisseur introuvable.'), { httpStatus: 404 });
      if (current.pendingPurchasePrice === null) throw Object.assign(new Error('Aucune hausse de prix n’attend une décision.'), { httpStatus: 409 });
      const approved = payload.data.decision === 'APPROVE';
      const saved = await tx.supplierOffer.updateMany({
        where: { id: current.id, pendingPurchasePrice: current.pendingPurchasePrice },
        data: { ...(approved ? { purchasePrice: current.pendingPurchasePrice } : {}), pendingPurchasePrice: null },
      });
      if (!saved.count) throw Object.assign(new Error('La demande de prix a changé entre-temps. Rechargez la page.'), { httpStatus: 409 });
      if (approved) await recalculateMarginPrices(tx, { productId: current.productId });
      await enqueueNotification(tx, { userId: current.supplierId, emailTo: current.supplier.email, eventKey: `supplierOffer.price:${current.id}:${payload.data.decision}:${Date.now()}`, title: approved ? 'Hausse de prix approuvée' : 'Hausse de prix refusée', message: `La demande de modification du prix d’achat pour « ${current.product.name} » (${current.supplierSku}) a été ${approved ? 'approuvée' : 'refusée'} par l’administration.`, link: '/partner' });
      await recordAudit(tx, { actorId: req.user!.sub, action: approved ? 'SUPPLIER_PRICE_INCREASE_APPROVED' : 'SUPPLIER_PRICE_INCREASE_REJECTED', entityType: 'SUPPLIER_OFFER', entityId: current.id, details: { sku: current.supplierSku, previousPurchasePrice: current.purchasePrice.toFixed(3), requestedPurchasePrice: current.pendingPurchasePrice.toFixed(3) } });
      return tx.supplierOffer.findUnique({ where: { id: current.id }, select: { ...supplierOfferSelect, supplier: { select: { id: true, email: true, phone: true, companyName: true } } } });
    });
    return res.json({ data: updated, message: payload.data.decision === 'APPROVE' ? 'Hausse de prix approuvée et appliquée.' : 'Hausse de prix refusée; le prix précédent reste actif.' });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    next(error);
  }
});

app.patch('/api/admin/fitment-suggestions/:id/review', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  const payload = z.object({ status: z.enum(['VERIFIED', 'REJECTED']), source: z.string().trim().min(3).max(240).optional(), sourceReference: z.string().trim().max(500).optional() }).strict().safeParse(req.body);
  if (!id.success || !payload.success || (payload.data.status === 'VERIFIED' && !payload.data.source)) return res.status(400).json({ error: 'Une source de vérification est obligatoire pour valider cette compatibilité.' });
  try {
    const suggestion = await prisma.$transaction(async (tx) => {
      const current = await tx.partnerFitmentSuggestion.findUnique({ where: { id: id.data }, include: { offer: { select: { id: true, supplierId: true, status: true, supplier: { select: { email: true } }, product: { select: { id: true, name: true } } } }, generation: { select: { id: true, yearFrom: true, yearTo: true, status: true, model: { select: { status: true, make: { select: { status: true } } } } } } } });
      if (!current) throw Object.assign(new Error('Suggestion de compatibilité introuvable.'), { httpStatus: 404 });
      if (!current.offer.supplierId || !current.offer.supplier) throw Object.assign(new Error('Fournisseur supprimé.'), { httpStatus: 404 });
      if (payload.data.status === 'VERIFIED') {
        if (current.offer.status !== 'APPROVED') throw Object.assign(new Error('Approuvez d’abord l’offre du partenaire.'), { httpStatus: 409 });
        let generationId = current.generationId;
        let engineId = current.engineId;
        let variantId = current.variantId;
        if (!generationId) {
          if (!current.makeName || !current.modelName || !current.generationName) throw Object.assign(new Error('La suggestion ne contient pas de marque, modèle et génération.'), { httpStatus: 409 });
          const makeSlug = slugify(current.makeName); const modelSlug = slugify(current.modelName);
          const make = await tx.vehicleMake.upsert({ where: { slug: makeSlug }, update: { name: current.makeName, status: DataStatus.VERIFIED, source: payload.data.source!, sourceReference: payload.data.sourceReference }, create: { name: current.makeName, slug: makeSlug, status: DataStatus.VERIFIED, source: payload.data.source!, sourceReference: payload.data.sourceReference } });
          const model = await tx.vehicleModel.upsert({ where: { makeId_slug: { makeId: make.id, slug: modelSlug } }, update: { name: current.modelName, category: current.vehicleCategory || 'Voiture particulière', status: DataStatus.VERIFIED, source: payload.data.source!, sourceReference: payload.data.sourceReference }, create: { makeId: make.id, name: current.modelName, slug: modelSlug, category: current.vehicleCategory || 'Voiture particulière', status: DataStatus.VERIFIED, source: payload.data.source!, sourceReference: payload.data.sourceReference } });
          const yearTo = current.yearTo ?? current.year;
          let generation = await tx.vehicleGeneration.findFirst({ where: { modelId: model.id, name: current.generationName, yearFrom: current.year, yearTo } });
          if (!generation) generation = await tx.vehicleGeneration.create({ data: { modelId: model.id, name: current.generationName, yearFrom: current.year, yearTo, status: DataStatus.VERIFIED, source: payload.data.source!, sourceReference: payload.data.sourceReference } });
          else if (generation.status !== DataStatus.VERIFIED || generation.source !== payload.data.source) generation = await tx.vehicleGeneration.update({ where: { id: generation.id }, data: { status: DataStatus.VERIFIED, source: payload.data.source!, sourceReference: payload.data.sourceReference } });
          generationId = generation.id;
          const engineName = current.engineName || current.engineCode;
          if (engineName) {
            let engine = await tx.engine.findFirst({ where: { generationId, name: engineName, engineCode: current.engineCode ?? null } });
            if (!engine) engine = await tx.engine.create({ data: { generationId, name: engineName, engineCode: current.engineCode, fuel: current.fuel, displacementCc: current.displacementCc, powerKw: current.powerKw, status: DataStatus.VERIFIED, source: payload.data.source!, sourceReference: payload.data.sourceReference } });
            else if (engine.status !== DataStatus.VERIFIED) engine = await tx.engine.update({ where: { id: engine.id }, data: { fuel: current.fuel, displacementCc: current.displacementCc, powerKw: current.powerKw, status: DataStatus.VERIFIED, source: payload.data.source!, sourceReference: payload.data.sourceReference } });
            engineId = engine.id;
          }
          if (current.variantName) {
            let variant = await tx.vehicleVariant.findFirst({ where: { generationId, name: current.variantName, engineId: engineId ?? null } });
            if (!variant) variant = await tx.vehicleVariant.create({ data: { generationId, engineId, name: current.variantName, bodyStyle: current.bodyStyle, transmission: current.transmission, drivetrain: current.drivetrain, status: DataStatus.VERIFIED, source: payload.data.source!, sourceReference: payload.data.sourceReference } });
            else if (variant.status !== DataStatus.VERIFIED) variant = await tx.vehicleVariant.update({ where: { id: variant.id }, data: { status: DataStatus.VERIFIED, source: payload.data.source!, sourceReference: payload.data.sourceReference } });
            variantId = variant.id;
          }
        } else if (current.makeName && current.modelName && current.generationName) {
          const taxonomy = await upsertVehicleTaxonomy(tx, {
            mode: 'manual', makeName: current.makeName, modelName: current.modelName, generationName: current.generationName,
            vehicleCategory: current.vehicleCategory ?? undefined, yearFrom: current.year, yearTo: current.yearTo ?? current.year,
            engineName: current.engineName ?? undefined, engineCode: current.engineCode ?? undefined, fuel: current.fuel ?? undefined,
            displacementCc: current.displacementCc ?? undefined, powerKw: current.powerKw ?? undefined,
            variantName: current.variantName ?? undefined, bodyStyle: current.bodyStyle ?? undefined, transmission: current.transmission ?? undefined, drivetrain: current.drivetrain ?? undefined,
          }, DataStatus.VERIFIED, payload.data.source!, payload.data.sourceReference);
          generationId = taxonomy.generationId; engineId = taxonomy.engineId ?? null; variantId = taxonomy.variantId ?? null;
        }
        const generation = generationId ? await tx.vehicleGeneration.findUnique({ where: { id: generationId }, include: { model: { include: { make: true } } } }) : null;
        const compatibilityYearTo = current.yearTo ?? current.year;
        const validVehicle = Boolean(generation && generation.status === DataStatus.VERIFIED && generation.model.status === DataStatus.VERIFIED && generation.model.make.status === DataStatus.VERIFIED && current.year >= generation.yearFrom && (generation.yearTo === null || compatibilityYearTo <= generation.yearTo));
        if (!validVehicle) throw Object.assign(new Error('Les données véhicule ne sont plus vérifiées ou l’année est hors période.'), { httpStatus: 409 });
        if (engineId) {
          const engine = await tx.engine.findFirst({ where: { id: engineId, generationId: generationId!, status: DataStatus.VERIFIED }, select: { id: true } });
          if (!engine) throw Object.assign(new Error('La motorisation sélectionnée n’est plus vérifiée.'), { httpStatus: 409 });
        }
        if (variantId) {
          const variant = await tx.vehicleVariant.findFirst({ where: { id: variantId, generationId: generationId!, status: DataStatus.VERIFIED }, select: { id: true, engineId: true } });
          if (!variant || (variant.engineId && variant.engineId !== engineId)) throw Object.assign(new Error('La version sélectionnée n’est plus vérifiée.'), { httpStatus: 409 });
        }
        const existing = await tx.vehicleCompatibility.findFirst({ where: { productId: current.offer.product.id, generationId: generationId!, engineId, yearFrom: current.year, yearTo: compatibilityYearTo } });
        if (existing) await tx.vehicleCompatibility.update({ where: { id: existing.id }, data: { variantId, source: payload.data.source!, sourceReference: payload.data.sourceReference, verifiedAt: new Date() } });
        else await tx.vehicleCompatibility.create({ data: { productId: current.offer.product.id, generationId: generationId!, engineId, variantId, yearFrom: current.year, yearTo: compatibilityYearTo, source: payload.data.source!, sourceReference: payload.data.sourceReference, verifiedAt: new Date() } });
        await tx.partnerFitmentSuggestion.update({ where: { id: current.id }, data: { generationId, engineId, variantId } });
      } else if (current.generationId) {
        await tx.vehicleCompatibility.deleteMany({ where: { productId: current.offer.product.id, generationId: current.generationId, engineId: current.engineId, yearFrom: current.year, yearTo: current.yearTo ?? current.year, source: 'Déclarée par le partenaire' } });
      }
      const updated = await tx.partnerFitmentSuggestion.update({ where: { id: current.id }, data: { status: payload.data.status, source: payload.data.status === 'VERIFIED' ? payload.data.source : null, sourceReference: payload.data.status === 'VERIFIED' ? payload.data.sourceReference : null, reviewedAt: new Date() }, select: { id: true, status: true, year: true, yearTo: true, source: true, sourceReference: true } });
      await enqueueNotification(tx, { userId: current.offer.supplierId, emailTo: current.offer.supplier.email, eventKey: `fitmentSuggestion.review:${current.id}:${payload.data.status}:${Date.now()}`, title: payload.data.status === 'VERIFIED' ? 'Compatibilité véhicule validée' : 'Compatibilité véhicule refusée', message: `La compatibilité proposée pour « ${current.offer.product.name} » a été ${payload.data.status === 'VERIFIED' ? 'validée' : 'refusée'} par l’administration.`, link: '/partner' });
      await recordAudit(tx, { actorId: req.user!.sub, action: payload.data.status === 'VERIFIED' ? 'FITMENT_SUGGESTION_VERIFIED' : 'FITMENT_SUGGESTION_REJECTED', entityType: 'PARTNER_FITMENT_SUGGESTION', entityId: current.id, details: { product: current.offer.product.name, make: current.makeName ?? null, model: current.modelName ?? null, generation: current.generationName ?? null, year: current.year, yearTo: current.yearTo, source: payload.data.source ?? null } });
      return updated;
    });
    return res.json({ data: suggestion });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    next(error);
  }
});

const warehouseSelect = { id: true, code: true, name: true, city: true, ownerId: true, owner: { select: { companyName: true, email: true } } } as const;
app.get('/api/admin/warehouses', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const warehouses = await prisma.warehouse.findMany({ select: warehouseSelect, orderBy: [{ name: 'asc' }] });
    return res.json({ data: warehouses });
  } catch (error) { next(error); }
});

app.post('/api/admin/warehouses', requireAuth, requireAdmin, async (req, res, next) => {
  const payload = z.object({ code: z.string().trim().min(2).max(32).transform((value) => value.toUpperCase()), name: z.string().trim().min(2).max(120), city: z.string().trim().max(100).optional(), ownerId: z.string().uuid().optional() }).strict().safeParse(req.body);
  if (!payload.success) return res.status(400).json({ error: 'Informations d’entrepôt invalides.', details: payload.error.flatten() });
  try {
    if (payload.data.ownerId) {
      const owner = await prisma.user.findUnique({ where: { id: payload.data.ownerId }, select: { role: true, status: true } });
      if (!owner || owner.role !== 'SUPPLIER' || owner.status !== 'ACTIVE') return res.status(400).json({ error: 'L’entrepôt doit appartenir à un fournisseur actif.' });
    }
    const warehouse = await prisma.warehouse.create({ data: payload.data, select: warehouseSelect });
    return res.status(201).json({ data: warehouse });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ error: 'Ce code d’entrepôt existe déjà.' });
    next(error);
  }
});

app.get('/api/admin/stock', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const items = await prisma.stockItem.findMany({
      include: { warehouse: { select: { id: true, code: true, name: true, city: true } }, offer: { select: { id: true, supplierSku: true, status: true, product: { select: { id: true, sku: true, name: true } }, supplier: { select: { id: true, companyName: true, email: true } } } } },
      orderBy: [{ warehouse: { name: 'asc' } }, { offer: { product: { name: 'asc' } } }], take: 1000,
    });
    return res.json({ data: items.map(({ onHand, reserved, onOrder, damaged, ...item }) => ({ ...item, onHand, reserved, onOrder, damaged, available: onHand - reserved - damaged })) });
  } catch (error) { next(error); }
});

app.patch('/api/admin/stock/:stockItemId/minimum-stock', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.stockItemId); const payload = minimumStockPayload.safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Seuil de stock invalide.' });
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.stockItem.findUnique({ where: { id: id.data }, select: { minimumStock: true } });
      if (!current) throw Object.assign(new Error('Ligne de stock introuvable.'), { httpStatus: 404 });
      const item = await tx.stockItem.update({ where: { id: id.data }, data: { minimumStock: payload.data.minimumStock }, select: { id: true, minimumStock: true, onHand: true, reserved: true, damaged: true } });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'ADMIN_STOCK_MINIMUM_CHANGED', entityType: 'STOCK_ITEM', entityId: item.id, details: { from: current.minimumStock, to: item.minimumStock } });
      return { ...item, available: item.onHand - item.reserved - item.damaged };
    });
    return res.json({ data: updated });
  } catch (error) { const status = (error as { httpStatus?: number }).httpStatus; if (status) return res.status(status).json({ error: (error as Error).message }); next(error); }
});

app.get('/api/admin/stock/movements', requireAuth, requireAdmin, async (req, res, next) => {
  const query = z.object({ warehouseId: uuid.optional(), offerId: uuid.optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: 'Filtres de mouvements invalides.', details: query.error.flatten() });
  try {
    const { warehouseId, offerId, page, limit } = query.data;
    const where = { ...(warehouseId ? { warehouseId } : {}), ...(offerId ? { offerId } : {}) };
    const [data, total] = await prisma.$transaction([
      prisma.stockMovement.findMany({ where, include: { warehouse: { select: { code: true, name: true } }, offer: { select: { supplierSku: true, product: { select: { sku: true, name: true } }, supplier: { select: { companyName: true, email: true } } } }, actor: { select: { email: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.stockMovement.count({ where }),
    ]);
    return res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

const stockMovementSchema = z.object({
  warehouseId: z.string().uuid(), offerId: z.string().uuid(), type: z.enum(['RECEIPT', 'ADJUSTMENT', 'DAMAGE', 'RESERVATION', 'RELEASE']),
  quantity: z.coerce.number().int().min(-1000000).max(1000000).refine((value) => value !== 0), reason: z.string().trim().min(3).max(240),
}).strict();
app.post('/api/admin/stock/movements', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const payload = stockMovementSchema.safeParse(req.body);
  if (!payload.success) return res.status(400).json({ error: 'Mouvement de stock invalide.', details: payload.error.flatten() });
  const { warehouseId, offerId, type, quantity, reason } = payload.data;
  if ((type === 'RECEIPT' || type === 'DAMAGE' || type === 'RESERVATION' || type === 'RELEASE') && quantity < 0) return res.status(400).json({ error: 'La quantité doit être positive pour ce type de mouvement.' });
  if (type === 'ADJUSTMENT' && quantity === 0) return res.status(400).json({ error: 'L’ajustement doit être différent de zéro.' });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const [warehouse, offer] = await Promise.all([
        tx.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true, ownerId: true } }),
        tx.supplierOffer.findUnique({ where: { id: offerId }, select: { id: true, supplierId: true, status: true } }),
      ]);
      if (!warehouse || !offer) throw Object.assign(new Error('Entrepôt ou offre introuvable.'), { httpStatus: 404 });
      if (offer.status !== 'APPROVED') throw Object.assign(new Error('Le stock ne peut être enregistré que pour une offre approuvée.'), { httpStatus: 409 });
      if (warehouse.ownerId && warehouse.ownerId !== offer.supplierId) throw Object.assign(new Error('Cet entrepôt appartient à un autre fournisseur.'), { httpStatus: 400 });
      const stock = await tx.stockItem.upsert({ where: { warehouseId_offerId: { warehouseId, offerId } }, create: { warehouseId, offerId }, update: {} });
      const currentAvailable = stock.onHand - stock.reserved - stock.damaged;
      let update: { onHand?: { increment: number }; reserved?: { increment: number } | { decrement: number }; damaged?: { increment: number } };
      if (type === 'RECEIPT') update = { onHand: { increment: quantity } };
      else if (type === 'ADJUSTMENT') {
        if (stock.onHand + quantity < stock.reserved + stock.damaged) throw Object.assign(new Error('Ajustement refusé : le stock disponible ne peut pas devenir négatif.'), { httpStatus: 409 });
        update = { onHand: { increment: quantity } };
      } else if (type === 'DAMAGE') {
        if (quantity > currentAvailable) throw Object.assign(new Error('Quantité endommagée supérieure au stock disponible.'), { httpStatus: 409 });
        update = { damaged: { increment: quantity } };
      } else if (type === 'RESERVATION') {
        if (quantity > currentAvailable) throw Object.assign(new Error('Stock disponible insuffisant pour cette réservation.'), { httpStatus: 409 });
        update = { reserved: { increment: quantity } };
      } else {
        if (quantity > stock.reserved) throw Object.assign(new Error('La libération dépasse la quantité réservée.'), { httpStatus: 409 });
        update = { reserved: { decrement: quantity } };
      }
      const updated = await tx.stockItem.update({ where: { id: stock.id }, data: update });
      const movement = await tx.stockMovement.create({ data: { stockItemId: stock.id, warehouseId, offerId, type, quantity, reason, actorId: req.user!.sub } });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'STOCK_MOVEMENT_RECORDED', entityType: 'STOCK_ITEM', entityId: stock.id, details: { movementId: movement.id, type, quantity, warehouseId, offerId, reason } });
      return { movement, stock: { ...updated, available: updated.onHand - updated.reserved - updated.damaged } };
    }, { isolationLevel: 'Serializable' });
    return res.status(201).json({ data: result });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2034') return res.status(409).json({ error: 'Mouvement simultané détecté. Rechargez le stock puis réessayez.' });
    next(error);
  }
});

const placeOrderSchema = z.object({
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(99) }).strict()).min(1).max(40),
  paymentMethod: z.enum(['CASH_ON_DELIVERY', 'BANK_TRANSFER']),
  guestEmail: z.string().trim().email().max(254).optional(),
  deliveryName: z.string().trim().min(2).max(160), deliveryPhone: z.string().trim().min(8).max(24).regex(/^\+?[0-9\s().-]+$/),
  deliveryAddress: z.string().trim().min(8).max(300), deliveryCity: z.string().trim().min(2).max(100), customerNote: z.string().trim().max(1000).optional(),
}).strict().refine(({ items }) => new Set(items.map((item) => item.productId)).size === items.length, { message: 'Chaque pièce ne doit apparaître qu’une fois.', path: ['items'] });

const guestLookupSchema = z.object({ orderNumber: z.string().trim().regex(/^AP-[0-9]{8}-[A-F0-9]{6}$/), accessToken: z.string().min(40).max(80) }).strict();
type InvoiceLine = { name: string; reference: string; quantity: number; unitPriceExclTax: number; vatRate: number; lineSubtotalExclTax?: number; lineVat?: number };
const cp1252Special = new Map(Object.entries({ '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '˜': 152, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159 }));
const pdfClean = (value: string) => [...value].map((character) => {
  let code = cp1252Special.get(character) ?? character.codePointAt(0) ?? 63;
  if (code === 160) code = 32;
  if (code < 32 || code > 255) return '?';
  if (code === 40 || code === 41 || code === 92) return `\\${String.fromCharCode(code)}`;
  return code > 126 ? `\\${code.toString(8).padStart(3, '0')}` : String.fromCharCode(code);
}).join('');
const pdfText = (x: number, y: number, value: string, size = 9, font = 'F1', color = '0.12 0.20 0.31') => `q ${color} rg BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfClean(value)}) Tj ET Q`;
const pdfRect = (x: number, y: number, width: number, height: number, color: string) => `q ${color} rg ${x} ${y} ${width} ${height} re f Q`;
const pdfLine = (x1: number, y1: number, x2: number, y2: number, color = '0.84 0.88 0.93', width = 0.6) => `q ${color} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S Q`;
const wrapPdfText = (value: string, maxChars: number) => {
  const words = value.split(/\s+/).filter(Boolean); const lines: string[] = []; let line = '';
  for (const word of words) { const next = line ? `${line} ${word}` : word; if (next.length > maxChars && line) { lines.push(line); line = word; } else line = next; }
  if (line) lines.push(line);
  return lines.length > 2 ? [lines[0], `${lines[1].slice(0, Math.max(0, maxChars - 3))}...`] : lines;
};
const standardInvoiceDocument = async (input: { invoiceNumber: string; issuedAt: Date; issuer: string; issuerContact?: string; recipient: string; recipientContact?: string; orderNumber: string; paymentLabel: string; lines: InvoiceLine[] }) => {
  const subtotalMills = input.lines.reduce((sum, line) => sum + (line.lineSubtotalExclTax === undefined ? Math.round(line.unitPriceExclTax * 1000) * line.quantity : Math.round(line.lineSubtotalExclTax * 1000)), 0);
  const vatByRate = new Map<number, number>();
  for (const line of input.lines) {
    const lineNet = line.lineSubtotalExclTax === undefined ? Math.round(line.unitPriceExclTax * 1000) * line.quantity : Math.round(line.lineSubtotalExclTax * 1000);
    const rate = Math.round(line.vatRate * 100);
    vatByRate.set(rate, (vatByRate.get(rate) ?? 0) + (line.lineVat === undefined ? Math.round(lineNet * rate / 10000) : Math.round(line.lineVat * 1000)));
  }
  const vatMills = [...vatByRate.values()].reduce((sum, value) => sum + value, 0);
  const logoPath = path.resolve(__dirname, '../assets/ghorbel-logo.png');
  const logoFile = await readFile(logoPath);
  if (logoFile.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Le logo PDF est invalide.');
  const logoWidth = logoFile.readUInt32BE(16); const logoHeight = logoFile.readUInt32BE(20); const colorType = logoFile[25]; const bitDepth = logoFile[24];
  if (colorType !== 2 || bitDepth !== 8) throw new Error('Le logo PDF doit être une image PNG RGB 8 bits.');
  const idat: Buffer[] = []; let chunkOffset = 8;
  while (chunkOffset + 12 <= logoFile.length) {
    const chunkLength = logoFile.readUInt32BE(chunkOffset); const chunkName = logoFile.subarray(chunkOffset + 4, chunkOffset + 8).toString('ascii');
    if (chunkOffset + chunkLength + 12 > logoFile.length) throw new Error('Le fichier du logo PNG est tronqué.');
    if (chunkName === 'IDAT') idat.push(logoFile.subarray(chunkOffset + 8, chunkOffset + 8 + chunkLength));
    chunkOffset += chunkLength + 12; if (chunkName === 'IEND') break;
  }
  const logoData = Buffer.concat(idat);
  if (!logoData.length) throw new Error('Les pixels du logo sont absents.');

  const pages: string[][] = [];
  const newPage = (continued: boolean) => {
    const ops = [pdfRect(0, 0, 595, 842, '1 1 1'), pdfRect(0, 827, 595, 15, '0.04 0.28 0.65')];
    if (!continued) {
      ops.push('q 64 0 0 64 42 744 cm /Logo Do Q');
      ops.push(pdfText(119, 790, 'GHORBEL AUTOMATIVE SUPPLY GROUP', 16, 'F2', '0.04 0.16 0.34'));
      ops.push(pdfText(119, 770, 'FACTURE', 11, 'F2', '0.04 0.36 0.86'));
      ops.push(pdfText(392, 790, `N° ${input.invoiceNumber}`, 10, 'F2'));
      ops.push(pdfText(392, 772, `Date : ${input.issuedAt.toISOString().slice(0, 10)}`, 9));
      ops.push(pdfText(392, 754, `Commande : ${input.orderNumber}`, 9));
      ops.push(pdfRect(40, 670, 250, 65, '0.96 0.98 1'));
      ops.push(pdfRect(305, 670, 250, 65, '0.96 0.98 1'));
      ops.push(pdfText(52, 718, 'EMETTEUR', 8, 'F2', '0.04 0.36 0.86'));
      ops.push(pdfText(52, 701, input.issuer, 10, 'F2'));
      if (input.issuerContact) ops.push(pdfText(52, 684, input.issuerContact.slice(0, 60), 8));
      ops.push(pdfText(317, 718, 'CLIENT', 8, 'F2', '0.04 0.36 0.86'));
      ops.push(pdfText(317, 701, input.recipient, 10, 'F2'));
      if (input.recipientContact) ops.push(pdfText(317, 684, input.recipientContact.slice(0, 60), 8));
      ops.push(pdfText(42, 647, `Paiement : ${input.paymentLabel}`, 9, 'F2'));
      ops.push(pdfText(42, 625, 'DETAIL DES ARTICLES', 9, 'F2', '0.04 0.36 0.86'));
      ops.push(pdfRect(40, 586, 515, 27, '0.04 0.19 0.39'));
      ops.push(pdfText(49, 596, 'Désignation', 8, 'F2', '1 1 1'));
      ops.push(pdfText(252, 596, 'Référence', 8, 'F2', '1 1 1'));
      ops.push(pdfText(376, 596, 'Qté', 8, 'F2', '1 1 1'));
      ops.push(pdfText(420, 596, 'PU HT (TND)', 7.5, 'F2', '1 1 1'));
      ops.push(pdfText(506, 596, 'TVA', 8, 'F2', '1 1 1'));
      return { ops, y: 586, bottom: 180 };
    }
    ops.push(pdfText(42, 792, 'FACTURE · SUITE', 12, 'F2', '0.04 0.16 0.34'));
    ops.push(pdfText(42, 772, `${input.invoiceNumber} · Commande ${input.orderNumber}`, 9));
    ops.push(pdfRect(40, 735, 515, 27, '0.04 0.19 0.39'));
    ops.push(pdfText(49, 745, 'Désignation', 8, 'F2', '1 1 1'));
    ops.push(pdfText(252, 745, 'Référence', 8, 'F2', '1 1 1'));
    ops.push(pdfText(376, 745, 'Qté', 8, 'F2', '1 1 1'));
    ops.push(pdfText(420, 745, 'PU HT (TND)', 7.5, 'F2', '1 1 1'));
    ops.push(pdfText(506, 745, 'TVA', 8, 'F2', '1 1 1'));
    return { ops, y: 735, bottom: 125 };
  };
  let page = newPage(false); pages.push(page.ops);
  let y = page.y;
  for (const [index, line] of input.lines.entries()) {
    const nameLines = wrapPdfText(line.name, 38); const refLines = wrapPdfText(line.reference, 22); const rowHeight = Math.max(30, Math.max(nameLines.length, refLines.length) * 10 + 14);
    if (y - rowHeight < page.bottom) { page = newPage(true); pages.push(page.ops); y = page.y; }
    const rowTop = y; const rowBottom = y - rowHeight;
    if (index % 2 === 1) page.ops.push(pdfRect(40, rowBottom, 515, rowHeight, '0.97 0.98 0.99'));
    page.ops.push(pdfLine(40, rowBottom, 555, rowBottom));
    nameLines.forEach((value, lineIndex) => page.ops.push(pdfText(49, rowTop - 18 - lineIndex * 10, value, 8)));
    refLines.forEach((value, lineIndex) => page.ops.push(pdfText(252, rowTop - 18 - lineIndex * 10, value, 7.5)));
    page.ops.push(pdfText(380, rowTop - 18, String(line.quantity), 8));
    page.ops.push(pdfText(418, rowTop - 18, line.unitPriceExclTax.toFixed(3), 8));
    page.ops.push(pdfText(506, rowTop - 18, `${line.vatRate.toFixed(0)} %`, 8));
    y = rowBottom;
  }
  const vatLines = [...vatByRate.entries()].sort(([left], [right]) => left - right);
  const totalBlockHeight = 99 + vatLines.length * 15;
  if (y - totalBlockHeight < page.bottom) { page = newPage(true); pages.push(page.ops); y = page.y; }
  let totalY = y - 26;
  page.ops.push(pdfLine(335, totalY + 13, 555, totalY + 13, '0.04 0.28 0.65', 1));
  page.ops.push(pdfText(350, totalY - 5, 'TOTAL HT', 9, 'F2'));
  page.ops.push(pdfText(473, totalY - 5, `${(subtotalMills / 1000).toFixed(3)} TND`, 9, 'F2'));
  totalY -= 20;
  for (const [rate, amount] of vatLines) {
    page.ops.push(pdfText(350, totalY, `TVA ${rate / 100} %${rate === 1900 ? ' (Taux normal)' : ''}`, 8.5));
    page.ops.push(pdfText(473, totalY, `${(amount / 1000).toFixed(3)} TND`, 8.5));
    totalY -= 15;
  }
  page.ops.push(pdfRect(335, totalY - 9, 220, 31, '0.91 0.96 1'));
  page.ops.push(pdfText(350, totalY + 2, 'TOTAL TTC', 10, 'F2', '0.04 0.28 0.65'));
  page.ops.push(pdfText(473, totalY + 2, `${((subtotalMills + vatMills) / 1000).toFixed(3)} TND`, 10, 'F2', '0.04 0.28 0.65'));
  for (const ops of pages) {
    ops.push(pdfLine(40, 42, 555, 42));
    ops.push(pdfText(42, 27, 'Ghorbel Automative Supply Group · Document genere automatiquement', 7.5, 'F1', '0.42 0.49 0.58'));
    ops.push(pdfText(500, 27, input.orderNumber, 7, 'F1', '0.42 0.49 0.58'));
  }

  const objects: Buffer[] = [Buffer.alloc(0)];
  const setObject = (id: number, content: Buffer | string) => { objects[id] = Buffer.isBuffer(content) ? content : Buffer.from(content, 'ascii'); };
  setObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  setObject(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  setObject(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const logoId = 5;
  const logoHeader = Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${logoWidth} /Height ${logoHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${logoWidth} >> /Length ${logoData.length} >>\nstream\n`, 'ascii');
  setObject(logoId, Buffer.concat([logoHeader, logoData, Buffer.from('\nendstream', 'ascii')]));
  const pageIds = pages.map((_, index) => 6 + index * 2);
  setObject(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((ops, index) => {
    const pageId = pageIds[index]; const contentId = pageId + 1; const content = Buffer.from(ops.join('\n'), 'ascii');
    setObject(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Logo ${logoId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    const streamHeader = Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'ascii');
    setObject(contentId, Buffer.concat([streamHeader, content, Buffer.from('\nendstream', 'ascii')]));
  });
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'ascii')]; const offsets = [0]; let totalBytes = chunks[0].length;
  for (let id = 1; id < objects.length; id += 1) { offsets[id] = totalBytes; const item = Buffer.concat([Buffer.from(`${id} 0 obj\n`, 'ascii'), objects[id], Buffer.from('\nendobj\n', 'ascii')]); chunks.push(item); totalBytes += item.length; }
  const xrefOffset = totalBytes;
  const xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(Buffer.from(xref, 'ascii'));
  return Buffer.concat(chunks);
};
const orderDocument = (order: { orderNumber: string; invoiceNumber?: string | null; invoiceIssuedAt?: Date | null; createdAt: Date; deliveryName: string; deliveryPhone: string; deliveryAddress: string; deliveryCity: string; paymentMethod: string; paymentStatus: string; subtotalExclTax: Prisma.Decimal; vatTotal: Prisma.Decimal; totalInclTax: Prisma.Decimal; lines: { productNameSnapshot: string; productSkuSnapshot: string; quantity: number; unitPriceExclTax: Prisma.Decimal; vatRateSnapshot: Prisma.Decimal; lineSubtotalExclTax: Prisma.Decimal; lineVat: Prisma.Decimal; lineTotalInclTax: Prisma.Decimal }[] }) => standardInvoiceDocument({
  invoiceNumber: order.invoiceNumber || `FACT-${order.orderNumber}`, issuedAt: order.invoiceIssuedAt || order.createdAt,
  issuer: 'Ghorbel Automative Supply Group', recipient: order.deliveryName, recipientContact: `${order.deliveryPhone} · ${order.deliveryAddress}, ${order.deliveryCity}`,
  orderNumber: order.orderNumber, paymentLabel: `${order.paymentMethod === 'CASH_ON_DELIVERY' ? 'A la livraison' : 'Virement bancaire'} · ${order.paymentStatus}`,
  lines: order.lines.map((line) => ({ name: line.productNameSnapshot, reference: line.productSkuSnapshot, quantity: line.quantity, unitPriceExclTax: Number(line.unitPriceExclTax), vatRate: Number(line.vatRateSnapshot), lineSubtotalExclTax: Number(line.lineSubtotalExclTax), lineVat: Number(line.lineVat) })),
});
const sendOrderDocument = async (res: Response, order: Parameters<typeof orderDocument>[0] & { invoicePdf?: Uint8Array | null }) => {
  const pdf = await orderDocument(order);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${order.invoiceNumber || `FACT-${order.orderNumber}`}-GHORBEL.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Length', pdf.byteLength);
  return res.send(pdf);
};
app.post('/api/orders/guest/lookup', async (req, res, next) => {
  const payload = guestLookupSchema.safeParse(req.body);
  if (!payload.success) return res.status(404).json({ error: 'Commande ou code de suivi invalide ou expiré.' });
  try {
    const order = await prisma.order.findFirst({ where: { orderNumber: payload.data.orderNumber, customerId: null, guestAccessExpiresAt: { gt: new Date() } }, select: { id: true, orderNumber: true, status: true, paymentMethod: true, paymentStatus: true, currency: true, subtotalExclTax: true, vatTotal: true, totalInclTax: true, createdAt: true, guestAccessTokenHash: true, paymentProofs: { select: { id: true, fileName: true, mimeType: true, fileSize: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5 }, lines: { select: { id: true, quantity: true, status: true, productNameSnapshot: true, carrierName: true, trackingReference: true, trackingUrl: true, lineTotalInclTax: true }, orderBy: { createdAt: 'asc' } } } });
    const suppliedHash = createHash('sha256').update(payload.data.accessToken).digest();
    const savedHash = order?.guestAccessTokenHash ? Buffer.from(order.guestAccessTokenHash, 'hex') : Buffer.alloc(32);
    if (!order || savedHash.length !== suppliedHash.length || !timingSafeEqual(savedHash, suppliedHash)) return res.status(404).json({ error: 'Commande ou code de suivi invalide ou expiré.' });
    const { guestAccessTokenHash: _hash, ...privateOrder } = order;
    return res.json({ data: privateOrder });
  } catch (error) { next(error); }
});
app.post('/api/orders/guest/document', async (req, res, next) => {
  const payload = guestLookupSchema.safeParse(req.body);
  if (!payload.success) return res.status(404).json({ error: 'Commande ou code de suivi invalide ou expiré.' });
  try {
    const order = await prisma.order.findFirst({ where: { orderNumber: payload.data.orderNumber, customerId: null, guestAccessExpiresAt: { gt: new Date() } }, select: { id: true, orderNumber: true, invoiceNumber: true, invoiceIssuedAt: true, invoicePdf: true, createdAt: true, deliveryName: true, deliveryPhone: true, deliveryAddress: true, deliveryCity: true, paymentMethod: true, paymentStatus: true, subtotalExclTax: true, vatTotal: true, totalInclTax: true, guestAccessTokenHash: true, lines: { select: { productNameSnapshot: true, productSkuSnapshot: true, quantity: true, unitPriceExclTax: true, vatRateSnapshot: true, lineSubtotalExclTax: true, lineVat: true, lineTotalInclTax: true }, orderBy: { createdAt: 'asc' } } } });
    const suppliedHash = createHash('sha256').update(payload.data.accessToken).digest(); const savedHash = order?.guestAccessTokenHash ? Buffer.from(order.guestAccessTokenHash, 'hex') : Buffer.alloc(32);
    if (!order || savedHash.length !== suppliedHash.length || !timingSafeEqual(savedHash, suppliedHash)) return res.status(404).json({ error: 'Commande ou code de suivi invalide ou expiré.' });
    const { guestAccessTokenHash: _hash, ...documentData } = order;
    return sendOrderDocument(res, documentData);
  } catch (error) { next(error); }
});
app.get('/api/orders/:id/document', requireAuth, requirePurchaser, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: 'Commande introuvable.' });
  try {
    const order = await prisma.order.findFirst({ where: { id: id.data, customerId: req.user!.sub }, select: { orderNumber: true, invoiceNumber: true, invoiceIssuedAt: true, invoicePdf: true, createdAt: true, deliveryName: true, deliveryPhone: true, deliveryAddress: true, deliveryCity: true, paymentMethod: true, paymentStatus: true, subtotalExclTax: true, vatTotal: true, totalInclTax: true, lines: { select: { productNameSnapshot: true, productSkuSnapshot: true, quantity: true, unitPriceExclTax: true, vatRateSnapshot: true, lineSubtotalExclTax: true, lineVat: true, lineTotalInclTax: true }, orderBy: { createdAt: 'asc' } } } });
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    return sendOrderDocument(res, order);
  } catch (error) { next(error); }
});

app.get('/api/account/addresses', requireAuth, requirePurchaser, async (req: AuthenticatedRequest, res, next) => {
  try {
    const addresses = await prisma.customerAddress.findMany({ where: { userId: req.user!.sub }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] });
    return res.json({ data: addresses });
  } catch (error) { next(error); }
});

app.post('/api/account/addresses', requireAuth, requirePurchaser, async (req: AuthenticatedRequest, res, next) => {
  const parsed = z.object({ label: z.string().trim().min(1).max(80).default('Adresse'), recipientName: z.string().trim().min(2).max(160), phone: z.string().trim().min(8).max(24), address: z.string().trim().min(8).max(300), city: z.string().trim().min(2).max(100), isDefault: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Vérifiez le nom, le téléphone et les coordonnées de livraison.' });
  try {
    const address = await prisma.$transaction(async (tx) => {
      const existing = await tx.customerAddress.count({ where: { userId: req.user!.sub } });
      if (existing >= 20) throw Object.assign(new Error('Vous pouvez enregistrer jusqu’à 20 adresses.'), { httpStatus: 409 });
      const isDefault = parsed.data.isDefault ?? existing === 0;
      if (isDefault) await tx.customerAddress.updateMany({ where: { userId: req.user!.sub }, data: { isDefault: false } });
      return tx.customerAddress.create({ data: { ...parsed.data, isDefault, userId: req.user!.sub } });
    });
    return res.status(201).json({ data: address });
  } catch (error) { next(error); }
});

app.patch('/api/account/addresses/:id/default', requireAuth, requirePurchaser, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: 'Adresse introuvable.' });
  try {
    const address = await prisma.$transaction(async (tx) => {
      const current = await tx.customerAddress.findFirst({ where: { id: id.data, userId: req.user!.sub }, select: { id: true } });
      if (!current) return null;
      await tx.customerAddress.updateMany({ where: { userId: req.user!.sub }, data: { isDefault: false } });
      return tx.customerAddress.update({ where: { id: current.id }, data: { isDefault: true } });
    });
    if (!address) return res.status(404).json({ error: 'Adresse introuvable.' });
    return res.json({ data: address, message: 'Adresse par défaut mise à jour.' });
  } catch (error) { next(error); }
});

app.delete('/api/account/addresses/:id', requireAuth, requirePurchaser, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: 'Adresse introuvable.' });
  try {
    const deleted = await prisma.$transaction(async (tx) => {
      const current = await tx.customerAddress.findFirst({ where: { id: id.data, userId: req.user!.sub } });
      if (!current) return null;
      await tx.customerAddress.delete({ where: { id: current.id } });
      if (current.isDefault) {
        const next = await tx.customerAddress.findFirst({ where: { userId: req.user!.sub }, orderBy: { createdAt: 'desc' } });
        if (next) await tx.customerAddress.update({ where: { id: next.id }, data: { isDefault: true } });
      }
      return current;
    });
    if (!deleted) return res.status(404).json({ error: 'Adresse introuvable.' });
    return res.json({ message: 'Adresse supprimée.' });
  } catch (error) { next(error); }
});

app.get('/api/orders', requireAuth, requirePurchaser, async (req: AuthenticatedRequest, res, next) => {
  try {
    const orders = await prisma.order.findMany({ where: { customerId: req.user!.sub }, orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, orderNumber: true, status: true, currency: true, paymentMethod: true, paymentStatus: true, transferReference: true, paymentConfirmedAt: true, deliveryName: true, deliveryPhone: true, deliveryAddress: true, deliveryCity: true, subtotalExclTax: true, vatTotal: true, totalInclTax: true, createdAt: true, paymentProofs: { select: { id: true, fileName: true, mimeType: true, fileSize: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5 },
        lines: { select: { id: true, quantity: true, status: true, productNameSnapshot: true, productSkuSnapshot: true, carrierName: true, trackingReference: true, trackingUrl: true, unitPriceExclTax: true, vatRateSnapshot: true, discountPercent: true, unitPriceInclTax: true, lineSubtotalExclTax: true, lineVat: true, lineTotalInclTax: true }, orderBy: { createdAt: 'asc' } } },
    });
    return res.json({ data: orders });
  } catch (error) { next(error); }
});

const cancelOrder = async (orderId: string, actorId: string, customerId?: string) => prisma.$transaction(async (tx) => {
  const current = await tx.order.findFirst({
    where: { id: orderId, ...(customerId ? { customerId } : {}) },
    select: { id: true, customerId: true, guestEmail: true, orderNumber: true, status: true, paymentStatus: true, customer: { select: { email: true } }, lines: { select: { id: true, quantity: true, status: true, stockItemId: true, warehouseId: true, supplierOfferId: true } } },
  });
  if (!current) throw Object.assign(new Error('Commande introuvable.'), { httpStatus: 404 });
  if (current.status === 'CANCELLED') throw Object.assign(new Error('Cette commande est déjà annulée.'), { httpStatus: 409 });
  if (current.paymentStatus !== 'UNPAID') throw Object.assign(new Error('Le paiement est confirmé ou un virement est en cours de vérification. Contactez l’administration avant toute annulation.'), { httpStatus: 409 });
  if (!current.lines.length || current.lines.some((line) => !['RESERVED', 'ACCEPTED', 'PREPARING'].includes(line.status))) {
    throw Object.assign(new Error('Une commande ne peut plus être annulée dès qu’une ligne a été expédiée.'), { httpStatus: 409 });
  }
  for (const line of current.lines) {
    if (line.stockItemId && line.warehouseId && line.supplierOfferId) {
      const released = await tx.stockItem.updateMany({ where: { id: line.stockItemId, reserved: { gte: line.quantity } }, data: { reserved: { decrement: line.quantity } } });
      if (released.count !== 1) throw Object.assign(new Error('La réservation de stock ne correspond plus à la commande.'), { httpStatus: 409 });
      await tx.stockMovement.create({ data: { stockItemId: line.stockItemId, warehouseId: line.warehouseId, offerId: line.supplierOfferId, type: 'RELEASE', quantity: line.quantity, reason: `Annulation commande ${current.orderNumber}`, actorId } });
    }
  }
  await tx.orderLine.updateMany({ where: { orderId: current.id }, data: { status: 'CANCELLED' } });
  const cancelled = await tx.order.update({ where: { id: current.id }, data: { status: 'CANCELLED' }, select: { id: true, orderNumber: true, status: true, paymentStatus: true } });
  await recordAudit(tx, { actorId, action: customerId ? 'CUSTOMER_ORDER_CANCELLED' : 'ADMIN_ORDER_CANCELLED', entityType: 'ORDER', entityId: current.id, details: { orderNumber: current.orderNumber, from: current.status, to: 'CANCELLED' } });
  const customerEmail = current.customer?.email ?? current.guestEmail;
  if (customerEmail) await enqueueNotification(tx, { userId: current.customerId, emailTo: customerEmail, eventKey: `order.cancelled:${current.id}`, title: 'Commande annulée', message: `La commande ${current.orderNumber} a été annulée et les quantités réservées ont été libérées.`, link: '/' });
  return cancelled;
}, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 20000 });

app.post('/api/orders/:id/cancel', requireAuth, requirePurchaser, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Identifiant de commande invalide.' });
  try {
    const data = await cancelOrder(id.data, req.user!.sub, req.user!.sub);
    return res.json({ data, message: 'Commande annulée et stock libéré.' });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2034') return res.status(409).json({ error: 'La commande a changé simultanément. Actualisez puis réessayez.' });
    next(error);
  }
});

app.post('/api/admin/orders/:id/cancel', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Identifiant de commande invalide.' });
  try {
    const data = await cancelOrder(id.data, req.user!.sub);
    return res.json({ data, message: 'Commande annulée et stock libéré.' });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2034') return res.status(409).json({ error: 'La commande a changé simultanément. Actualisez puis réessayez.' });
    next(error);
  }
});

app.post('/api/orders/:id/payment-reference', requireAuth, requirePurchaser, async (req: AuthenticatedRequest, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const payload = z.object({ reference: z.string().trim().min(4).max(100) }).strict().safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Référence de paiement invalide.' });
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id: id.data, customerId: req.user!.sub }, select: { id: true, status: true, paymentMethod: true, paymentStatus: true } });
      if (!order) throw Object.assign(new Error('Commande introuvable.'), { httpStatus: 404 });
      if (order.status === 'CANCELLED') throw Object.assign(new Error('Une commande annulée ne peut plus recevoir de référence de paiement.'), { httpStatus: 409 });
      if (order.paymentMethod !== 'BANK_TRANSFER') throw Object.assign(new Error('Cette commande n’est pas réglée par virement.'), { httpStatus: 409 });
      if (order.paymentStatus === 'PAID') throw Object.assign(new Error('Cette commande est déjà marquée payée.'), { httpStatus: 409 });
      const changed = await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'TRANSFER_SUBMITTED', transferReference: payload.data.reference }, select: { id: true, orderNumber: true, paymentMethod: true, paymentStatus: true, transferReference: true } });
      await tx.paymentEvent.create({ data: { orderId: order.id, actorId: req.user!.sub, fromStatus: order.paymentStatus, toStatus: 'TRANSFER_SUBMITTED', transferReference: payload.data.reference, note: 'Référence de virement transmise par le client.' } });
      return changed;
    }, { isolationLevel: 'Serializable' });
    return res.json({ data: updated, message: 'Référence reçue. Le paiement sera confirmé après vérification.' });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2034') return res.status(409).json({ error: 'La commande a été modifiée simultanément. Actualisez-la.' });
    next(error);
  }
});

const paymentProofPayload = z.object({ fileName: z.string().trim().min(1).max(160), mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']), contentBase64: z.string().min(1).max(7_000_000) }).strict();
const guestPaymentProofPayload = guestLookupSchema.extend({ fileName: z.string().trim().min(1).max(160), mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']), contentBase64: z.string().min(1).max(7_000_000) }).strict();
const readVerifiedPaymentProof = (payload: z.infer<typeof paymentProofPayload>) => {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.contentBase64)) throw Object.assign(new Error('Fichier de paiement invalide.'), { httpStatus: 400 });
  const fileContent = Buffer.from(payload.contentBase64, 'base64');
  if (!fileContent.length || fileContent.length > 5 * 1024 * 1024 || fileContent.toString('base64') !== payload.contentBase64) throw Object.assign(new Error('Le fichier est vide, invalide ou dépasse 5 Mo.'), { httpStatus: 400 });
  const isPdf = payload.mimeType === 'application/pdf' && fileContent.subarray(0, 5).toString('ascii') === '%PDF-';
  const isJpeg = payload.mimeType === 'image/jpeg' && fileContent[0] === 0xff && fileContent[1] === 0xd8 && fileContent[2] === 0xff;
  const isPng = payload.mimeType === 'image/png' && fileContent.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPdf && !isJpeg && !isPng) throw Object.assign(new Error('Le contenu ne correspond pas au type PDF, JPEG ou PNG annoncé.'), { httpStatus: 400 });
  const fileName = payload.fileName.normalize('NFKC').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 140) || 'justificatif';
  return { fileName, mimeType: payload.mimeType, fileSize: fileContent.byteLength, sha256: createHash('sha256').update(fileContent).digest('hex'), fileContent };
};
const savePaymentProof = async (tx: Prisma.TransactionClient, input: { orderId: string; uploadedById: string | null; proof: ReturnType<typeof readVerifiedPaymentProof> }) => {
  const order = await tx.order.findUnique({ where: { id: input.orderId }, select: { id: true, orderNumber: true, status: true, paymentMethod: true, paymentStatus: true } });
  if (!order) throw Object.assign(new Error('Commande introuvable.'), { httpStatus: 404 });
  if (order.status === 'CANCELLED' || order.paymentStatus === 'PAID') throw Object.assign(new Error('Cette commande ne peut plus recevoir de justificatif.'), { httpStatus: 409 });
  if (order.paymentMethod !== 'BANK_TRANSFER') throw Object.assign(new Error('Cette commande n’est pas réglée par virement.'), { httpStatus: 409 });
  const proofCount = await tx.paymentProof.count({ where: { orderId: order.id } });
  if (proofCount >= 5) throw Object.assign(new Error('La limite de 5 justificatifs pour cette commande est atteinte.'), { httpStatus: 409 });
  const proof = await tx.paymentProof.create({ data: { orderId: order.id, uploadedById: input.uploadedById, ...input.proof }, select: { id: true, fileName: true, mimeType: true, fileSize: true, sha256: true, createdAt: true } });
  await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'TRANSFER_SUBMITTED' } });
  if (input.uploadedById) {
    await tx.paymentEvent.create({ data: { orderId: order.id, actorId: input.uploadedById, fromStatus: order.paymentStatus, toStatus: 'TRANSFER_SUBMITTED', note: 'Justificatif de virement déposé; réception des fonds à vérifier.' } });
    await recordAudit(tx, { actorId: input.uploadedById, action: 'PAYMENT_PROOF_UPLOADED', entityType: 'ORDER', entityId: order.id, details: { orderNumber: order.orderNumber, proofId: proof.id, mimeType: proof.mimeType, fileSize: proof.fileSize } });
  }
  return proof;
};

app.post('/api/orders/:id/payment-proofs', requireAuth, requirePurchaser, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id); const payload = paymentProofPayload.safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Justificatif invalide.', ...(payload.success ? {} : { details: payload.error.flatten() }) });
  try {
    const proofData = readVerifiedPaymentProof(payload.data);
    const proof = await prisma.$transaction(async (tx) => {
      const ownedOrder = await tx.order.findFirst({ where: { id: id.data, customerId: req.user!.sub }, select: { id: true } });
      if (!ownedOrder) throw Object.assign(new Error('Commande introuvable.'), { httpStatus: 404 });
      return savePaymentProof(tx, { orderId: ownedOrder.id, uploadedById: req.user!.sub, proof: proofData });
    }, { isolationLevel: 'Serializable' });
    return res.status(201).json({ data: proof, message: 'Justificatif reçu. La réception des fonds doit encore être vérifiée.' });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2034') return res.status(409).json({ error: 'La commande a été modifiée simultanément. Actualisez puis réessayez.' });
    next(error);
  }
});

app.post('/api/orders/guest/payment-proofs', async (req, res, next) => {
  const payload = guestPaymentProofPayload.safeParse(req.body);
  if (!payload.success) return res.status(404).json({ error: 'Commande ou justificatif invalide.' });
  try {
    const { orderNumber, accessToken, ...uploadData } = payload.data; const proofData = readVerifiedPaymentProof(uploadData);
    const proof = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { orderNumber, customerId: null, guestAccessExpiresAt: { gt: new Date() } }, select: { id: true, guestAccessTokenHash: true } });
      const suppliedHash = createHash('sha256').update(accessToken).digest(); const savedHash = order?.guestAccessTokenHash ? Buffer.from(order.guestAccessTokenHash, 'hex') : Buffer.alloc(32);
      if (!order || savedHash.length !== suppliedHash.length || !timingSafeEqual(savedHash, suppliedHash)) throw Object.assign(new Error('Commande ou code de suivi invalide ou expiré.'), { httpStatus: 404 });
      return savePaymentProof(tx, { orderId: order.id, uploadedById: null, proof: proofData });
    }, { isolationLevel: 'Serializable' });
    return res.status(201).json({ data: proof, message: 'Justificatif reçu. La réception des fonds doit encore être vérifiée.' });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2034') return res.status(409).json({ error: 'La commande a été modifiée simultanément. Actualisez puis réessayez.' });
    next(error);
  }
});

app.post('/api/orders', optionalAuth, async (req: AuthenticatedRequest, res, next) => {
  const payload = placeOrderSchema.safeParse(req.body);
  if (!payload.success) return res.status(400).json({ error: 'Commande ou coordonnées de livraison invalides.', details: payload.error.flatten() });
  if (!req.user && !payload.data.guestEmail) return res.status(400).json({ error: 'Une adresse e-mail est requise pour une commande sans compte.' });
  try {
    const guestAccessToken = req.user ? null : randomBytes(32).toString('base64url');
    const guestAccessTokenHash = guestAccessToken ? createHash('sha256').update(guestAccessToken).digest('hex') : null;
    const guestAccessExpiresAt = guestAccessToken ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null;
    const order = await prisma.$transaction(async (tx) => {
      const user = req.user ? await tx.user.findUnique({ where: { id: req.user.sub }, select: { email: true, role: true, status: true, pricingProfile: { select: { id: true, active: true, discountPercent: true } } } }) : null;
      if (req.user && (!user || user.status !== 'ACTIVE' || (user.role !== 'CUSTOMER' && user.role !== 'RESELLER' && user.role !== 'SUPPLIER'))) throw Object.assign(new Error('Compte acheteur indisponible.'), { httpStatus: 401 });
      if (payload.data.paymentMethod === 'BANK_TRANSFER') {
        const paymentSettings = await tx.companySettings.findUnique({ where: { id: 'default' }, select: { bankTransferEnabled: true, bankAccountHolder: true, bankName: true, bankRib: true } });
        if (!paymentSettings?.bankTransferEnabled || !paymentSettings.bankAccountHolder || !paymentSettings.bankName || !paymentSettings.bankRib) throw Object.assign(new Error('Le paiement par virement n’est pas disponible actuellement.'), { httpStatus: 409 });
      }
      const productIds = payload.data.items.map((item) => item.productId);
      const products = await tx.product.findMany({ where: { id: { in: productIds }, archivedAt: null, listPrice: { not: null }, OR: [{ status: 'VERIFIED', supplierOffers: { none: {} } }, { supplierOffers: { some: { status: 'APPROVED', archivedAt: null, supplier: { status: 'ACTIVE' } } } }] }, select: { id: true, sku: true, name: true, category: true, listPrice: true, vatRate: true } });
      if (products.length !== productIds.length) throw Object.assign(new Error('Une pièce n’est plus disponible à la vente ou son prix doit être confirmé.'), { httpStatus: 409 });
      const profileId = user?.role === 'RESELLER' && user.pricingProfile?.active ? user.pricingProfile.id : null;
      const profileDiscount = profileId && user?.pricingProfile ? Number(user.pricingProfile.discountPercent) : 0;
      const productDiscounts = profileId ? await tx.profileProductPrice.findMany({ where: { profileId, productId: { in: productIds } }, select: { productId: true, discountPercent: true } }) : [];
      const productDiscountMap = new Map(productDiscounts.map((rule) => [rule.productId, Number(rule.discountPercent)]));
      const categoryDiscounts = profileId ? await tx.profileCategoryPrice.findMany({ where: { profileId }, select: { category: true, discountPercent: true } }) : [];
      const categoryDiscountMap = new Map(categoryDiscounts.map((rule) => [rule.category, Number(rule.discountPercent)]));
      const allocations: { product: typeof products[number]; stockItemId: string; offerId: string; warehouseId: string; supplierId: string; supplierEmail: string; supplierSku: string; quantity: number; purchaseUnitPriceExclTax: string; purchaseVatRateSnapshot: string; discountPercent: number; unitNetMills: number; unitGrossMills: number }[] = [];
      for (const requested of payload.data.items) {
        const product = products.find((item) => item.id === requested.productId)!;
      const candidates = await tx.stockItem.findMany({ where: { offer: { productId: product.id, status: 'APPROVED', archivedAt: null, supplier: { status: 'ACTIVE' } } }, include: { offer: { select: { id: true, supplierSku: true, purchasePrice: true, purchaseVatRate: true, supplier: { select: { id: true, email: true } } } } }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }] });
        const available = candidates.map((item) => ({ item, quantity: Math.max(0, item.onHand - item.reserved - item.damaged) })).filter((entry) => entry.quantity > 0).sort((a, b) => b.quantity - a.quantity || a.item.id.localeCompare(b.item.id));
        const totalAvailable = available.reduce((sum, entry) => sum + entry.quantity, 0);
        if (totalAvailable < requested.quantity) throw Object.assign(new Error(`Stock insuffisant pour « ${product.name} » : ${totalAvailable} disponible(s).`), { httpStatus: 409 });
        const discountPercent = productDiscountMap.get(product.id) ?? (product.category ? categoryDiscountMap.get(product.category.trim().toLocaleLowerCase('fr-TN')) : undefined) ?? profileDiscount;
        const discountBasisPoints = Math.round(discountPercent * 100);
        const unitNetMills = Math.round(Math.round(Number(product.listPrice) * 1000) * (10000 - discountBasisPoints) / 10000);
        const unitGrossMills = Math.round(unitNetMills * (10000 + Math.round(Number(product.vatRate) * 100)) / 10000);
        let remaining = requested.quantity;
        for (const entry of available) {
          if (!remaining) break;
          const quantity = Math.min(remaining, entry.quantity);
          const reserved = await tx.stockItem.updateMany({ where: { id: entry.item.id, reserved: { lte: entry.item.onHand - entry.item.damaged - quantity } }, data: { reserved: { increment: quantity } } });
          if (reserved.count !== 1) throw Object.assign(new Error('Le stock vient de changer. Actualisez le catalogue et réessayez.'), { httpStatus: 409 });
          const supplier = entry.item.offer.supplier;
          if (!supplier) throw Object.assign(new Error('Un fournisseur est suspendu ou indisponible. Actualisez le panier.'), { httpStatus: 409 });
          allocations.push({ product, stockItemId: entry.item.id, offerId: entry.item.offer.id, warehouseId: entry.item.warehouseId, supplierId: supplier.id, supplierEmail: supplier.email, supplierSku: entry.item.offer.supplierSku, quantity, purchaseUnitPriceExclTax: Number(entry.item.offer.purchasePrice).toFixed(3), purchaseVatRateSnapshot: Number(entry.item.offer.purchaseVatRate).toFixed(2), discountPercent, unitNetMills, unitGrossMills });
          remaining -= quantity;
        }
      }
      const subtotalMills = allocations.reduce((sum, line) => sum + line.unitNetMills * line.quantity, 0);
      const totalMills = allocations.reduce((sum, line) => sum + line.unitGrossMills * line.quantity, 0);
      const auditActorId = req.user?.sub ?? (await tx.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } }))?.id;
      if (!auditActorId) throw Object.assign(new Error('Aucun administrateur actif n’est disponible pour journaliser la réservation.'), { httpStatus: 503 });
      const orderNumber = `AP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const invoiceNumber = `FACT-${orderNumber}`;
      const invoiceIssuedAt = new Date();
      const invoicePdf = await standardInvoiceDocument({ invoiceNumber, issuedAt: invoiceIssuedAt, issuer: 'Ghorbel Automative Supply Group', recipient: payload.data.deliveryName, recipientContact: `${payload.data.deliveryPhone} · ${payload.data.deliveryAddress}, ${payload.data.deliveryCity}`, orderNumber, paymentLabel: payload.data.paymentMethod === 'CASH_ON_DELIVERY' ? 'A la livraison' : 'Virement bancaire', lines: allocations.map((line) => { const lineSubtotal = line.unitNetMills * line.quantity; const lineTotal = line.unitGrossMills * line.quantity; return { name: line.product.name, reference: line.product.sku, quantity: line.quantity, unitPriceExclTax: line.unitNetMills / 1000, vatRate: Number(line.product.vatRate), lineSubtotalExclTax: lineSubtotal / 1000, lineVat: (lineTotal - lineSubtotal) / 1000 }; }) });
      const created = await tx.order.create({ data: {
        orderNumber, invoiceNumber, invoiceIssuedAt, invoicePdf, customerId: req.user?.sub ?? null, guestEmail: req.user ? null : payload.data.guestEmail!, guestAccessTokenHash, guestAccessExpiresAt, paymentMethod: payload.data.paymentMethod, deliveryName: payload.data.deliveryName, deliveryPhone: payload.data.deliveryPhone,
        deliveryAddress: payload.data.deliveryAddress, deliveryCity: payload.data.deliveryCity, customerNote: payload.data.customerNote,
        subtotalExclTax: (subtotalMills / 1000).toFixed(3), vatTotal: ((totalMills - subtotalMills) / 1000).toFixed(3), totalInclTax: (totalMills / 1000).toFixed(3),
        lines: { create: allocations.map((line) => {
          const subtotal = line.unitNetMills * line.quantity; const total = line.unitGrossMills * line.quantity;
          return { productId: line.product.id, supplierOfferId: line.offerId, warehouseId: line.warehouseId, stockItemId: line.stockItemId, quantity: line.quantity,
            productSkuSnapshot: line.product.sku, productNameSnapshot: line.product.name, supplierSkuSnapshot: line.supplierSku,
            unitPriceExclTax: (line.unitNetMills / 1000).toFixed(3), purchaseUnitPriceExclTaxSnapshot: line.purchaseUnitPriceExclTax, purchaseVatRateSnapshot: line.purchaseVatRateSnapshot, vatRateSnapshot: Number(line.product.vatRate).toFixed(2), discountPercent: line.discountPercent.toFixed(2),
            unitPriceInclTax: (line.unitGrossMills / 1000).toFixed(3), lineSubtotalExclTax: (subtotal / 1000).toFixed(3), lineVat: ((total - subtotal) / 1000).toFixed(3), lineTotalInclTax: (total / 1000).toFixed(3) };
        }) },
      }, select: { id: true, orderNumber: true, invoiceNumber: true, invoiceIssuedAt: true, status: true, paymentMethod: true, paymentStatus: true, subtotalExclTax: true, vatTotal: true, totalInclTax: true, currency: true, createdAt: true, lines: { select: { id: true, productNameSnapshot: true, quantity: true, status: true, lineTotalInclTax: true } } } });
      await tx.stockMovement.createMany({ data: allocations.map((line) => ({ stockItemId: line.stockItemId, warehouseId: line.warehouseId, offerId: line.offerId, type: 'RESERVATION' as const, quantity: line.quantity, reason: `Commande ${orderNumber}`, actorId: auditActorId })) });
      if (user) await enqueueNotification(tx, { userId: req.user!.sub, emailTo: user.email, eventKey: `order.created.customer:${created.id}`, title: 'Commande enregistrée', message: `Votre commande ${orderNumber} a été enregistrée. Son suivi est disponible dans votre espace client.`, link: '/' });
      else await enqueueNotification(tx, { userId: null, emailTo: payload.data.guestEmail!, eventKey: `order.created.guest:${created.id}`, title: 'Commande enregistrée · Ghorbel Automative Supply Group', message: `Votre commande ${orderNumber} est enregistrée. Le code privé de suivi (valable 30 jours) figure dans cet e-mail ; conservez-le pour consulter la commande sur notre site.`, emailSecretEncrypted: encryptEmailSecret(guestAccessToken!), link: '/' });
      const suppliers = new Map(allocations.map((line) => [line.supplierId, line.supplierEmail]));
      for (const [supplierId, supplierEmail] of suppliers) await enqueueNotification(tx, { userId: supplierId, emailTo: supplierEmail, eventKey: `order.created.supplier:${created.id}:${supplierId}`, title: 'Nouvelle commande à préparer', message: `Des articles vous ont été attribués sur la commande ${orderNumber}. Connectez-vous à votre espace fournisseur pour la traiter.`, link: '/partner' });
      return created;
    }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 20000 });
    return res.status(201).json({ data: { ...order, ...(guestAccessToken ? { guestAccessToken, guestAccessExpiresAt } : {}) }, message: 'Commande enregistrée. Les prix sont figés et le stock est réservé.' });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2034') return res.status(409).json({ error: 'Une réservation concurrente a changé le stock. Actualisez le catalogue et réessayez.' });
    next(error);
  }
});

app.get('/api/partner/orders', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  try {
    const lines = await prisma.orderLine.findMany({ where: supplierOrderScope(req.user!.sub), orderBy: [{ createdAt: 'asc' }], take: 250,
      select: { id: true, orderId: true, quantity: true, status: true, productNameSnapshot: true, productSkuSnapshot: true, supplierSkuSnapshot: true, purchaseUnitPriceExclTaxSnapshot: true, purchaseVatRateSnapshot: true, carrierName: true, trackingReference: true, trackingUrl: true, createdAt: true, warehouse: { select: { code: true, name: true } },
        order: { select: { orderNumber: true, status: true, createdAt: true } } } });
    return res.json({ data: lines.map((line) => ({ ...line, ...supplierPurchaseTotals(line) })) });
  } catch (error) { next(error); }
});

app.get('/api/partner/dashboard', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  const supplierId = req.user!.sub;
  try {
    const [offerCounts, archivedOffers, stockCounts, orderTotals, pendingInvoices, activityRows, notificationRows] = await Promise.all([
      prisma.supplierOffer.groupBy({ by: ['status'], where: { supplierId, archivedAt: null }, _count: { _all: true } }),
      prisma.supplierOffer.count({ where: { supplierId, archivedAt: { not: null } } }),
      prisma.$queryRaw<{ outOfStock: number; lowStock: number }[]>`
        SELECT
          COUNT(*) FILTER (WHERE GREATEST(s."onHand" - s."reserved" - s."damaged", 0) = 0)::int AS "outOfStock",
          COUNT(*) FILTER (WHERE s."minimumStock" > 0 AND GREATEST(s."onHand" - s."reserved" - s."damaged", 0) > 0 AND GREATEST(s."onHand" - s."reserved" - s."damaged", 0) <= s."minimumStock")::int AS "lowStock"
        FROM "StockItem" s
        JOIN "SupplierOffer" o ON o.id = s."offerId"
        WHERE o."supplierId" = ${supplierId}::uuid AND o.status = 'APPROVED' AND o."archivedAt" IS NULL
      `,
      prisma.$queryRaw<{ orderCount: number; confirmedPurchaseTotal: string }[]>`
        SELECT
          COUNT(DISTINCT l."orderId")::int AS "orderCount",
          COALESCE(SUM(l."purchaseUnitPriceExclTaxSnapshot" * l.quantity), 0)::numeric(14,3)::text AS "confirmedPurchaseTotal"
        FROM "OrderLine" l
        JOIN "SupplierOffer" o ON o.id = l."supplierOfferId"
        WHERE o."supplierId" = ${supplierId}::uuid
          AND l.status IN ('ACCEPTED', 'PREPARING', 'SHIPPED', 'DELIVERED')
      `,
      prisma.supplierInvoice.count({ where: { supplierId, status: 'PENDING' } }),
      prisma.auditLog.findMany({ where: { actorId: supplierId }, orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, action: true, entityType: true, createdAt: true } }),
      prisma.notification.findMany({ where: { userId: supplierId }, orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, title: true, createdAt: true } }),
    ]);
    const count = (status: 'PENDING' | 'APPROVED' | 'REJECTED') => offerCounts.find((item) => item.status === status)?._count._all ?? 0;
    const orderSummary = orderTotals[0];
    const activityLabels: Record<string, string> = {
      SUPPLIER_OFFER_CREATED: 'Nouvelle pièce proposée',
      SUPPLIER_OFFER_ARCHIVED: 'Offre archivée',
      SUPPLIER_OFFER_RESTORED: 'Offre rétablie',
      SUPPLIER_OFFER_DETAILS_UPDATED: 'Fiche pièce modifiée',
      SUPPLIER_PRICE_INCREASE_REQUESTED: 'Hausse de prix soumise à validation',
      SUPPLIER_ORDER_ACCEPTED: 'Commande acceptée',
      SUPPLIER_ORDER_PREPARED: 'Pièce prête pour retrait',
      SUPPLIER_STOCK_AVAILABILITY_CHANGED: 'Disponibilité du stock modifiée',
      SUPPLIER_STOCK_MINIMUM_CHANGED: 'Seuil de stock faible modifié',
      STOCK_MOVEMENT_RECORDED: 'Mouvement de stock enregistré',
      SUPPLIER_INVOICE_GENERATED: 'Facture transmise à GHORBEL',
      SUPPLIER_INVOICE_UPLOADED: 'Facture déposée',
      SUPPLIER_CATALOG_EXPORTED: 'Catalogue exporté en CSV',
      PARTNER_PROFILE_UPDATED: 'Coordonnées du compte modifiées',
      PARTNER_PASSWORD_CHANGED: 'Mot de passe modifié',
    };
    return res.json({ data: {
      offers: { total: offerCounts.reduce((sum, item) => sum + item._count._all, 0) + archivedOffers, pending: count('PENDING'), approved: count('APPROVED'), rejected: count('REJECTED'), archived: archivedOffers },
      stock: { outOfStock: stockCounts[0]?.outOfStock ?? 0, lowStock: stockCounts[0]?.lowStock ?? 0 },
      orders: { count: orderSummary?.orderCount ?? 0, confirmedPurchaseTotal: orderSummary?.confirmedPurchaseTotal ?? '0.000' },
      pendingInvoices,
      recentActivity: [
        ...activityRows.map((item) => ({ id: `audit-${item.id}`, label: activityLabels[item.action] ?? 'Activité du compte', createdAt: item.createdAt })),
        ...notificationRows.map((item) => ({ id: `notification-${item.id}`, label: item.title, createdAt: item.createdAt })),
      ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 8),
    } });
  } catch (error) { next(error); }
});

const supplierInvoiceUploadSchema = z.object({ invoiceNumber: z.string().trim().min(1).max(100), pdfBase64: z.string().min(16).max(7_000_000) }).strict();
app.post('/api/partner/orders/:orderId/invoices', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  const orderId = uuid.safeParse(req.params.orderId); const payload = supplierInvoiceUploadSchema.safeParse(req.body);
  if (!orderId.success || !payload.success) return res.status(400).json({ error: 'Numéro de facture ou fichier PDF invalide.' });
  try {
    const bytes = Buffer.from(payload.data.pdfBase64, 'base64');
    if (bytes.length < 8 || bytes.length > 5 * 1024 * 1024 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') return res.status(400).json({ error: 'Le fichier doit être un PDF valide de 5 Mo maximum.' });
    const assignment = await prisma.orderLine.findFirst({ where: { orderId: orderId.data, supplierOffer: { supplierId: req.user!.sub } }, select: { id: true } });
    if (!assignment) return res.status(404).json({ error: 'Commande fournisseur introuvable.' });
    const safeNumber = payload.data.invoiceNumber.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'document';
    const invoice = await prisma.$transaction(async (tx) => {
      const existing = await tx.supplierInvoice.findUnique({ where: { supplierId_orderId_invoiceNumber: { supplierId: req.user!.sub, orderId: orderId.data, invoiceNumber: payload.data.invoiceNumber } }, select: { id: true, status: true } });
      if (existing && existing.status !== 'REJECTED') throw Object.assign(new Error('Une facture avec ce numéro est déjà en cours de vérification ou a été acceptée.'), { httpStatus: 409 });
      const saved = existing
        ? await tx.supplierInvoice.update({ where: { id: existing.id }, data: { fileName: `facture-${safeNumber}.pdf`, fileContent: bytes, status: 'PENDING', reviewNote: null, reviewedById: null, reviewedAt: null, uploadedAt: new Date() }, select: { id: true, invoiceNumber: true, fileName: true, status: true, uploadedAt: true } })
        : await tx.supplierInvoice.create({ data: { supplierId: req.user!.sub, orderId: orderId.data, invoiceNumber: payload.data.invoiceNumber, fileName: `facture-${safeNumber}.pdf`, fileContent: bytes }, select: { id: true, invoiceNumber: true, fileName: true, status: true, uploadedAt: true } });
      await tx.supplierInvoiceEvent.create({ data: { invoiceId: saved.id, actorId: req.user!.sub, type: existing ? 'RESUBMITTED' : 'UPLOADED' } });
      return saved;
    });
    return res.status(201).json({ data: invoice, message: 'Facture fournisseur transmise à l’administration.' });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ error: 'Ce numéro de facture est déjà enregistré pour cette commande.' });
    next(error);
  }
});
const supplierInvoiceGenerateSchema = z.object({ invoiceNumber: z.string().trim().min(1).max(100) }).strict();
app.post('/api/partner/orders/:orderId/invoices/generate', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  const orderId = uuid.safeParse(req.params.orderId); const payload = supplierInvoiceGenerateSchema.safeParse(req.body);
  if (!orderId.success || !payload.success) return res.status(400).json({ error: 'Numéro de facture ou commande invalide.' });
  try {
    const lines = await prisma.orderLine.findMany({ where: { orderId: orderId.data, supplierOffer: { supplierId: req.user!.sub } }, select: {
      productNameSnapshot: true, supplierSkuSnapshot: true, quantity: true, purchaseUnitPriceExclTaxSnapshot: true, purchaseVatRateSnapshot: true,
      supplierOffer: { select: { supplier: { select: { companyName: true, firstName: true, lastName: true, email: true } } } },
      order: { select: { orderNumber: true, createdAt: true } },
    } });
    if (!lines.length) return res.status(404).json({ error: 'Aucune ligne de cette commande ne vous est attribuée.' });
    if (lines.some((line) => line.purchaseUnitPriceExclTaxSnapshot === null)) return res.status(409).json({ error: 'Le coût fournisseur historique est absent pour cette commande; contactez l’administration.' });
    const order = lines[0].order;
    const supplier = lines[0].supplierOffer?.supplier;
    if (!supplier) return res.status(404).json({ error: 'Le fournisseur de cette ligne n’est plus disponible.' });
    const supplierName = supplier.companyName || `${supplier.firstName} ${supplier.lastName}`.trim();
    const pdf = await standardInvoiceDocument({
      invoiceNumber: payload.data.invoiceNumber, issuedAt: new Date(), issuer: supplierName, issuerContact: supplier.email,
      recipient: 'Ghorbel Automative Supply Group', orderNumber: order.orderNumber,
      paymentLabel: 'Facturation fournisseur de la commande · règlement selon les conditions convenues avec GHORBEL',
      lines: supplierInvoiceLines(lines),
    });
    const safeNumber = payload.data.invoiceNumber.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'document';
    const invoice = await prisma.$transaction(async (tx) => {
      const existing = await tx.supplierInvoice.findUnique({ where: { supplierId_orderId_invoiceNumber: { supplierId: req.user!.sub, orderId: orderId.data, invoiceNumber: payload.data.invoiceNumber } }, select: { id: true, status: true } });
      if (existing && existing.status !== 'REJECTED') throw Object.assign(new Error('Une facture avec ce numéro est déjà en cours de vérification ou a été acceptée.'), { httpStatus: 409 });
      const data = { fileName: `facture-${safeNumber}-generee.pdf`, mimeType: 'application/pdf', fileContent: pdf, status: 'PENDING' as const, reviewNote: null, reviewedById: null, reviewedAt: null, uploadedAt: new Date() };
      const saved = existing
        ? await tx.supplierInvoice.update({ where: { id: existing.id }, data, select: { id: true, invoiceNumber: true, fileName: true, status: true, uploadedAt: true } })
        : await tx.supplierInvoice.create({ data: { supplierId: req.user!.sub, orderId: orderId.data, invoiceNumber: payload.data.invoiceNumber, ...data }, select: { id: true, invoiceNumber: true, fileName: true, status: true, uploadedAt: true } });
      await tx.supplierInvoiceEvent.create({ data: { invoiceId: saved.id, actorId: req.user!.sub, type: existing ? 'RESUBMITTED' : 'UPLOADED', note: 'Facture générée avec le modèle standard Ghorbel Automative Supply Group.' } });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'SUPPLIER_INVOICE_GENERATED', entityType: 'SUPPLIER_INVOICE', entityId: saved.id, details: { invoiceNumber: payload.data.invoiceNumber, orderNumber: order.orderNumber } });
      return saved;
    });
    return res.status(201).json({ data: invoice, message: 'Facture générée et transmise à l’administration pour vérification.' });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ error: 'Ce numéro de facture est déjà enregistré pour cette commande.' });
    next(error);
  }
});
app.get('/api/partner/supplier-invoices', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  try {
    const invoices = await prisma.supplierInvoice.findMany({ where: { supplierId: req.user!.sub }, orderBy: { uploadedAt: 'desc' }, take: 100, select: { id: true, invoiceNumber: true, fileName: true, status: true, reviewNote: true, uploadedAt: true, reviewedAt: true, order: { select: { orderNumber: true } }, events: { orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, type: true, note: true, createdAt: true } } } });
    return res.json({ data: invoices });
  } catch (error) { next(error); }
});
app.get('/api/partner/supplier-invoices/:id/file', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id); if (!id.success) return res.status(404).json({ error: 'Document introuvable.' });
  try {
    const invoice = await prisma.supplierInvoice.findFirst({ where: { id: id.data, supplierId: req.user!.sub }, select: { fileName: true, mimeType: true, fileContent: true } });
    if (!invoice) return res.status(404).json({ error: 'Document introuvable.' });
    res.setHeader('Content-Type', invoice.mimeType); res.setHeader('Content-Disposition', `attachment; filename="${invoice.fileName}"`); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(Buffer.from(invoice.fileContent));
  } catch (error) { next(error); }
});
app.get('/api/admin/supplier-invoices', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const invoices = await prisma.supplierInvoice.findMany({ orderBy: { uploadedAt: 'desc' }, take: 250, select: { id: true, invoiceNumber: true, fileName: true, status: true, reviewNote: true, uploadedAt: true, reviewedAt: true, order: { select: { orderNumber: true } }, supplier: { select: { id: true, email: true, companyName: true } }, reviewedBy: { select: { email: true } }, events: { orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, type: true, note: true, createdAt: true, actor: { select: { email: true } } } } } });
    return res.json({ data: invoices });
  } catch (error) { next(error); }
});
app.get('/api/admin/supplier-invoices/:id/file', requireAuth, requireAdmin, async (req, res, next) => {
  const id = uuid.safeParse(req.params.id); if (!id.success) return res.status(404).json({ error: 'Document introuvable.' });
  try {
    const invoice = await prisma.supplierInvoice.findUnique({ where: { id: id.data }, select: { fileName: true, mimeType: true, fileContent: true } });
    if (!invoice) return res.status(404).json({ error: 'Document introuvable.' });
    res.setHeader('Content-Type', invoice.mimeType); res.setHeader('Content-Disposition', `attachment; filename="${invoice.fileName}"`); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(Buffer.from(invoice.fileContent));
  } catch (error) { next(error); }
});
app.patch('/api/admin/supplier-invoices/:id/review', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id); const payload = z.object({ status: z.enum(['ACCEPTED', 'REJECTED']), note: z.string().trim().max(1000).optional() }).strict().safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Décision ou note invalide.' });
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.supplierInvoice.findUnique({ where: { id: id.data }, select: { id: true, supplierId: true, invoiceNumber: true, status: true, supplier: { select: { email: true } } } });
      if (!current) throw Object.assign(new Error('Facture fournisseur introuvable.'), { httpStatus: 404 });
      if (current.status !== 'PENDING') throw Object.assign(new Error('Cette facture a déjà été examinée.'), { httpStatus: 409 });
      const reviewedAt = new Date();
      const changed = await tx.supplierInvoice.updateMany({ where: { id: current.id, status: 'PENDING' }, data: { status: payload.data.status, reviewNote: payload.data.note || null, reviewedById: req.user!.sub, reviewedAt } });
      if (changed.count !== 1) throw Object.assign(new Error('Cette facture a déjà été examinée.'), { httpStatus: 409 });
      const invoice = await tx.supplierInvoice.findUniqueOrThrow({ where: { id: current.id }, select: { id: true, status: true, reviewNote: true, reviewedAt: true } });
      await tx.supplierInvoiceEvent.create({ data: { invoiceId: current.id, actorId: req.user!.sub, type: payload.data.status, note: payload.data.note || null } });
      await recordAudit(tx, { actorId: req.user!.sub, action: payload.data.status === 'ACCEPTED' ? 'SUPPLIER_INVOICE_ACCEPTED' : 'SUPPLIER_INVOICE_REJECTED', entityType: 'SUPPLIER_INVOICE', entityId: current.id, details: { invoiceNumber: current.invoiceNumber, from: current.status, to: payload.data.status, hasReviewNote: Boolean(payload.data.note) } });
      await enqueueNotification(tx, { userId: current.supplierId, emailTo: current.supplier.email, eventKey: `supplierInvoice.review:${current.id}:${invoice.reviewedAt?.getTime()}`, title: payload.data.status === 'ACCEPTED' ? 'Facture fournisseur acceptée' : 'Facture fournisseur à corriger', message: `Votre facture ${current.invoiceNumber} a été ${payload.data.status === 'ACCEPTED' ? 'acceptée' : 'refusée'} par l’administration.${payload.data.note ? ` Motif : ${payload.data.note}` : ''}`, link: '/partner' });
      return invoice;
    });
    return res.json({ data: updated });
  } catch (error) { const status = (error as { httpStatus?: number }).httpStatus; if (status) return res.status(status).json({ error: (error as Error).message }); next(error); }
});

app.patch('/api/partner/orders/lines/:id/status', requireAuth, requirePartner, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id); const payload = z.object({ status: z.enum(['ACCEPTED', 'PREPARING']) }).strict().safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Statut de commande invalide.' });
  try {
    const updatedLine = await prisma.$transaction(async (tx) => {
      const current = await tx.orderLine.findFirst({ where: { id: id.data, supplierOffer: { supplierId: req.user!.sub } }, select: { id: true, orderId: true, quantity: true, status: true, productNameSnapshot: true, order: { select: { orderNumber: true } } } });
      if (!current) throw Object.assign(new Error('Ligne de commande introuvable.'), { httpStatus: 404 });
      const nextByStatus: Record<string, string> = { RESERVED: 'ACCEPTED', ACCEPTED: 'PREPARING' };
      if (nextByStatus[current.status] !== payload.data.status) throw Object.assign(new Error('Cette transition n’est pas autorisée. Suivez les étapes dans l’ordre.'), { httpStatus: 409 });
      const changed = await tx.orderLine.updateMany({ where: { id: current.id, status: current.status }, data: { status: payload.data.status } });
      if (changed.count !== 1) throw Object.assign(new Error('La ligne de commande a été modifiée simultanément.'), { httpStatus: 409 });
      const statuses = (await tx.orderLine.findMany({ where: { orderId: current.orderId }, select: { status: true } })).map((line) => line.status);
      const nextOrderStatus = statuses.every((status) => status === 'DELIVERED') ? 'DELIVERED' : statuses.every((status) => status === 'SHIPPED' || status === 'DELIVERED') ? 'SHIPPED' : statuses.some((status) => status === 'SHIPPED' || status === 'DELIVERED') ? 'PARTIALLY_SHIPPED' : statuses.some((status) => status === 'ACCEPTED' || status === 'PREPARING') ? 'PROCESSING' : 'PLACED';
      await tx.order.update({ where: { id: current.orderId }, data: { status: nextOrderStatus } });
      await recordAudit(tx, { actorId: req.user!.sub, action: payload.data.status === 'ACCEPTED' ? 'SUPPLIER_ORDER_ACCEPTED' : 'SUPPLIER_ORDER_PREPARED', entityType: 'ORDER_LINE', entityId: current.id, details: { orderNumber: current.order.orderNumber, product: current.productNameSnapshot, quantity: current.quantity, status: payload.data.status } });
      return tx.orderLine.findUnique({ where: { id: current.id }, select: { id: true, quantity: true, status: true, productNameSnapshot: true, supplierSkuSnapshot: true, carrierName: true, trackingReference: true, trackingUrl: true, order: { select: { orderNumber: true, status: true } } } });
    }, { isolationLevel: 'Serializable' });
    return res.json({ data: updatedLine });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2034') return res.status(409).json({ error: 'La ligne a été modifiée simultanément. Actualisez la commande.' });
    next(error);
  }
});

app.patch('/api/admin/orders/lines/:id/status', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id); const payload = z.object({ status: z.enum(['SHIPPED', 'DELIVERED']) }).strict().safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Étape de retrait ou de livraison invalide.' });
  try {
    const line = await prisma.$transaction(async (tx) => {
      const current = await tx.orderLine.findUnique({ where: { id: id.data }, select: { id: true, orderId: true, quantity: true, status: true, productNameSnapshot: true, stockItemId: true, warehouseId: true, supplierOfferId: true, order: { select: { orderNumber: true, customerId: true, guestEmail: true, customer: { select: { email: true } } } } } });
      if (!current) throw Object.assign(new Error('Ligne de commande introuvable.'), { httpStatus: 404 });
      const nextStatus = current.status === 'PREPARING' ? 'SHIPPED' : current.status === 'SHIPPED' ? 'DELIVERED' : null;
      if (nextStatus !== payload.data.status) throw Object.assign(new Error('Le fournisseur doit d’abord préparer la pièce. Suivez les étapes de retrait et de livraison dans l’ordre.'), { httpStatus: 409 });
      if (payload.data.status === 'SHIPPED') {
        if (!current.stockItemId || !current.warehouseId || !current.supplierOfferId) throw Object.assign(new Error('La réservation de stock de cette pièce est introuvable.'), { httpStatus: 409 });
        const consumed = await tx.stockItem.updateMany({ where: { id: current.stockItemId, reserved: { gte: current.quantity }, onHand: { gte: current.quantity } }, data: { reserved: { decrement: current.quantity }, onHand: { decrement: current.quantity } } });
        if (consumed.count !== 1) throw Object.assign(new Error('Le stock réservé ne correspond plus à la commande.'), { httpStatus: 409 });
        await tx.stockMovement.create({ data: { stockItemId: current.stockItemId, warehouseId: current.warehouseId, offerId: current.supplierOfferId, type: 'SHIPMENT', quantity: -current.quantity, reason: `Retrait par Ghorbel Automative Supply Group · commande ${current.order.orderNumber}`, actorId: req.user!.sub } });
      }
      const changed = await tx.orderLine.updateMany({ where: { id: current.id, status: current.status }, data: { status: payload.data.status } });
      if (!changed.count) throw Object.assign(new Error('La ligne de commande a été modifiée simultanément.'), { httpStatus: 409 });
      const statuses = (await tx.orderLine.findMany({ where: { orderId: current.orderId }, select: { status: true } })).map((item) => item.status);
      const orderStatus = statuses.every((status) => status === 'DELIVERED') ? 'DELIVERED' : statuses.every((status) => status === 'SHIPPED' || status === 'DELIVERED') ? 'SHIPPED' : statuses.some((status) => status === 'SHIPPED' || status === 'DELIVERED') ? 'PARTIALLY_SHIPPED' : statuses.some((status) => status === 'ACCEPTED' || status === 'PREPARING') ? 'PROCESSING' : 'PLACED';
      await tx.order.update({ where: { id: current.orderId }, data: { status: orderStatus } });
      const title = payload.data.status === 'SHIPPED' ? 'Pièce récupérée et en livraison' : 'Votre commande a été livrée';
      const message = payload.data.status === 'SHIPPED' ? `La pièce « ${current.productNameSnapshot} » de la commande ${current.order.orderNumber} a été récupérée chez le fournisseur et est en cours de livraison.` : `La pièce « ${current.productNameSnapshot} » de la commande ${current.order.orderNumber} a été livrée.`;
      const email = current.order.customer?.email ?? current.order.guestEmail;
      if (email) await enqueueNotification(tx, { userId: current.order.customerId, emailTo: email, eventKey: `admin.orderLine:${current.id}:${payload.data.status}`, title, message, link: '/' });
      await recordAudit(tx, { actorId: req.user!.sub, action: payload.data.status === 'SHIPPED' ? 'ADMIN_PICKED_UP_ORDER_LINE' : 'ADMIN_DELIVERED_ORDER_LINE', entityType: 'ORDER_LINE', entityId: current.id, details: { orderNumber: current.order.orderNumber, product: current.productNameSnapshot, quantity: current.quantity } });
      return tx.orderLine.findUnique({ where: { id: current.id }, select: { id: true, quantity: true, status: true, productNameSnapshot: true, order: { select: { orderNumber: true, status: true } } } });
    }, { isolationLevel: 'Serializable' });
    return res.json({ data: line });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2034') return res.status(409).json({ error: 'La réservation ou la commande a changé simultanément. Actualisez puis réessayez.' });
    next(error);
  }
});

const orderDateFilter = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
});
const adminOrderFilters = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['PLACED', 'PROCESSING', 'PARTIALLY_SHIPPED', 'SHIPPED', 'DELIVERED', 'CANCELLED']).optional(),
  paymentStatus: z.enum(['UNPAID', 'TRANSFER_SUBMITTED', 'PAID']).optional(),
  paymentMethod: z.enum(['CASH_ON_DELIVERY', 'BANK_TRANSFER']).optional(),
  customerType: z.enum(['CUSTOMER', 'RESELLER', 'GUEST']).optional(),
  from: orderDateFilter.optional(), to: orderDateFilter.optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});
const buildAdminOrderWhere = ({ search, status, paymentStatus, paymentMethod, customerType, from, to }: z.infer<typeof adminOrderFilters>): Prisma.OrderWhereInput => ({
  ...(status ? { status } : {}), ...(paymentStatus ? { paymentStatus } : {}), ...(paymentMethod ? { paymentMethod } : {}),
  ...(customerType === 'GUEST' ? { customerId: null } : customerType ? { customer: { role: customerType } } : {}),
  ...(from || to ? { createdAt: { ...(from ? { gte: new Date(`${from}T00:00:00+01:00`) } : {}), ...(to ? { lt: new Date(new Date(`${to}T00:00:00+01:00`).getTime() + 24 * 60 * 60 * 1000) } : {}) } } : {}),
  ...(search ? { OR: [
    { orderNumber: { contains: search, mode: 'insensitive' } }, { deliveryName: { contains: search, mode: 'insensitive' } },
    { deliveryPhone: { contains: search } }, { guestEmail: { contains: search, mode: 'insensitive' } },
    { customer: { is: { OR: [{ email: { contains: search, mode: 'insensitive' } }, { companyName: { contains: search, mode: 'insensitive' } }] } } },
    { lines: { some: { OR: [{ productNameSnapshot: { contains: search, mode: 'insensitive' } }, { productSkuSnapshot: { contains: search, mode: 'insensitive' } }, { supplierSkuSnapshot: { contains: search, mode: 'insensitive' } }] } } },
  ] } : {}),
});
const csvCell = (value: string | number | null | undefined) => {
  let text = value == null ? '' : String(value);
  if (/^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
app.get('/api/admin/orders', requireAuth, requireAdmin, async (req, res, next) => {
  const parsed = adminOrderFilters.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Filtres de commandes invalides.', details: parsed.error.flatten() });
  if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) return res.status(400).json({ error: 'La date de début doit précéder la date de fin.' });
  const { search, status, paymentStatus, paymentMethod, customerType, from, to, page, pageSize } = parsed.data;
  const where = buildAdminOrderWhere(parsed.data);
  try {
    const [total, orders] = await Promise.all([prisma.order.count({ where }), prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, orderNumber: true, status: true, paymentMethod: true, paymentStatus: true, transferReference: true, paymentConfirmedAt: true, subtotalExclTax: true, vatTotal: true, totalInclTax: true, createdAt: true, deliveryName: true, deliveryPhone: true, deliveryAddress: true, deliveryCity: true, guestEmail: true, paymentProofs: { select: { id: true, fileName: true, mimeType: true, fileSize: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5 },
        customer: { select: { email: true, companyName: true, role: true } }, paymentEvents: { select: { id: true, fromStatus: true, toStatus: true, transferReference: true, note: true, createdAt: true, actor: { select: { email: true } } }, orderBy: { createdAt: 'desc' }, take: 10 }, lines: { select: { id: true, quantity: true, status: true, productNameSnapshot: true, productSkuSnapshot: true, supplierSkuSnapshot: true, carrierName: true, trackingReference: true, trackingUrl: true, lineTotalInclTax: true, warehouse: { select: { code: true, name: true, city: true } }, supplierOffer: { select: { supplier: { select: { companyName: true, email: true } } } } } } } })]);
    return res.json({ data: orders, pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } });
  } catch (error) { next(error); }
});
app.get('/api/admin/orders/export.csv', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const parsed = adminOrderFilters.omit({ page: true, pageSize: true }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Filtres d’export invalides.', details: parsed.error.flatten() });
  if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) return res.status(400).json({ error: 'La date de début doit précéder la date de fin.' });
  const where = buildAdminOrderWhere({ ...parsed.data, page: 1, pageSize: 25 });
  try {
    const count = await prisma.order.count({ where });
    if (count > 10000) return res.status(413).json({ error: 'L’export est limité à 10 000 commandes. Ajoutez une période ou des filtres.' });
    const orders = await prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, take: 10000,
      select: { orderNumber: true, createdAt: true, status: true, paymentMethod: true, paymentStatus: true, deliveryName: true, deliveryPhone: true, deliveryAddress: true, deliveryCity: true, guestEmail: true, subtotalExclTax: true, vatTotal: true, totalInclTax: true,
        customer: { select: { email: true, companyName: true, role: true } }, lines: { select: { quantity: true, status: true, productNameSnapshot: true, productSkuSnapshot: true, supplierSkuSnapshot: true, unitPriceExclTax: true, vatRateSnapshot: true, lineTotalInclTax: true, supplierOffer: { select: { supplier: { select: { companyName: true, email: true } } } } } } } });
    const rows = [[
      'Commande', 'Date', 'Type client', 'Client', 'Téléphone livraison', 'Adresse', 'Ville', 'Statut commande', 'Moyen paiement', 'Statut paiement',
      'Référence pièce', 'SKU fournisseur', 'Désignation', 'Fournisseur', 'Quantité', 'Statut ligne', 'Prix unitaire HT (TND)', 'TVA (%)', 'Total ligne TTC (TND)', 'Sous-total commande HT (TND)', 'TVA commande (TND)', 'Total commande TTC (TND)',
    ].map(csvCell).join(';')];
    for (const order of orders) for (const line of order.lines) rows.push([
      order.orderNumber, order.createdAt.toISOString(), order.customer?.role ?? 'GUEST', order.customer?.companyName || order.customer?.email || order.guestEmail || order.deliveryName,
      order.deliveryPhone, order.deliveryAddress, order.deliveryCity, order.status, order.paymentMethod, order.paymentStatus,
      line.productSkuSnapshot, line.supplierSkuSnapshot, line.productNameSnapshot, line.supplierOffer?.supplier?.companyName || 'Fournisseur supprimé',
      line.quantity, line.status, Number(line.unitPriceExclTax).toFixed(3), Number(line.vatRateSnapshot).toFixed(2), Number(line.lineTotalInclTax).toFixed(3),
      Number(order.subtotalExclTax).toFixed(3), Number(order.vatTotal).toFixed(3), Number(order.totalInclTax).toFixed(3),
    ].map(csvCell).join(';'));
    const csv = `\uFEFF${rows.join('\r\n')}`;
    await prisma.$transaction((tx) => recordAudit(tx, { actorId: req.user!.sub, action: 'ORDERS_CSV_EXPORTED', entityType: 'ORDER_EXPORT', entityId: randomUUID(), details: { orderCount: count, rowCount: rows.length - 1, filters: parsed.data } }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="commandes-ghorbel-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(csv);
  } catch (error) { next(error); }
});
app.get('/api/admin/orders/:id/document', requireAuth, requireAdmin, async (req, res, next) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: 'Commande introuvable.' });
  try {
    const order = await prisma.order.findUnique({ where: { id: id.data }, select: { orderNumber: true, invoiceNumber: true, invoiceIssuedAt: true, invoicePdf: true, createdAt: true, deliveryName: true, deliveryPhone: true, deliveryAddress: true, deliveryCity: true, paymentMethod: true, paymentStatus: true, subtotalExclTax: true, vatTotal: true, totalInclTax: true, lines: { select: { productNameSnapshot: true, productSkuSnapshot: true, quantity: true, unitPriceExclTax: true, vatRateSnapshot: true, lineSubtotalExclTax: true, lineVat: true, lineTotalInclTax: true }, orderBy: { createdAt: 'asc' } } } });
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    return sendOrderDocument(res, order);
  } catch (error) { next(error); }
});

app.get('/api/admin/orders/:id/payment-proofs/:proofId', requireAuth, requireAdmin, async (req, res, next) => {
  const orderId = uuid.safeParse(req.params.id); const proofId = uuid.safeParse(req.params.proofId);
  if (!orderId.success || !proofId.success) return res.status(404).json({ error: 'Justificatif introuvable.' });
  try {
    const proof = await prisma.paymentProof.findFirst({ where: { id: proofId.data, orderId: orderId.data }, select: { fileName: true, mimeType: true, fileContent: true } });
    if (!proof) return res.status(404).json({ error: 'Justificatif introuvable.' });
    res.setHeader('Content-Type', proof.mimeType); res.setHeader('Content-Disposition', `attachment; filename="${proof.fileName.replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(proof.fileName)}`); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(Buffer.from(proof.fileContent));
  } catch (error) { next(error); }
});

app.patch('/api/admin/orders/:id/payment', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const payload = z.object({ status: z.enum(['PAID', 'UNPAID']), note: z.string().trim().max(500).optional() }).strict().safeParse(req.body);
  if (!id.success || !payload.success) return res.status(400).json({ error: 'Mise à jour de paiement invalide.' });
  try {
    const order = await prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({ where: { id: id.data }, select: { id: true, customerId: true, guestEmail: true, orderNumber: true, status: true, paymentMethod: true, paymentStatus: true, transferReference: true, paymentProofs: { select: { id: true }, take: 1 }, customer: { select: { email: true } } } });
      if (!current) throw Object.assign(new Error('Commande introuvable.'), { httpStatus: 404 });
      if (current.paymentStatus === payload.data.status) throw Object.assign(new Error('Le paiement possède déjà ce statut.'), { httpStatus: 409 });
      if (payload.data.status === 'PAID' && current.paymentMethod === 'BANK_TRANSFER' && (current.paymentStatus !== 'TRANSFER_SUBMITTED' || (!current.transferReference && !current.paymentProofs.length))) throw Object.assign(new Error('Aucune référence ou preuve de virement n’est en attente de validation.'), { httpStatus: 409 });
      if (payload.data.status === 'PAID' && current.paymentMethod === 'CASH_ON_DELIVERY' && current.status !== 'DELIVERED') throw Object.assign(new Error('Un paiement à la livraison ne peut être confirmé qu’après la livraison.'), { httpStatus: 409 });
      const next = await tx.order.update({ where: { id: current.id }, data: { paymentStatus: payload.data.status, ...(payload.data.status === 'PAID' ? { paymentConfirmedAt: new Date() } : { paymentConfirmedAt: null, transferReference: null }) }, select: { id: true, orderNumber: true, paymentMethod: true, paymentStatus: true, transferReference: true, paymentConfirmedAt: true, totalInclTax: true } });
      await tx.paymentEvent.create({ data: { orderId: current.id, actorId: req.user!.sub, fromStatus: current.paymentStatus, toStatus: payload.data.status, transferReference: current.transferReference, note: payload.data.note || (payload.data.status === 'PAID' ? 'Paiement confirmé par l’administration.' : 'Référence de virement rejetée par l’administration.') } });
      await recordAudit(tx, { actorId: req.user!.sub, action: payload.data.status === 'PAID' ? 'PAYMENT_CONFIRMED' : 'PAYMENT_REJECTED', entityType: 'ORDER', entityId: current.id, details: { orderNumber: current.orderNumber, from: current.paymentStatus, to: payload.data.status, method: current.paymentMethod } });
      const customerEmail = current.customer?.email ?? current.guestEmail;
      if (payload.data.status === 'PAID' && customerEmail) await enqueueNotification(tx, { userId: current.customerId, emailTo: customerEmail, eventKey: `order.payment-confirmed:${current.id}`, title: 'Paiement confirmé', message: `Le paiement de la commande ${current.orderNumber} a été confirmé par notre équipe.`, link: '/' });
      return next;
    }, { isolationLevel: 'Serializable' });
    return res.json({ data: order });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus;
    if (status) return res.status(status).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2034') return res.status(409).json({ error: 'Le paiement a été modifié simultanément. Actualisez la commande.' });
    next(error);
  }
});

type CatalogCsvRow = {
  line: number; sku: string; name: string; description?: string; category?: string; pieceBrand?: string; reference?: string;
  referenceType: 'OEM' | 'ALTERNATIVE'; make?: string; model?: string; generation?: string; yearFrom?: number; yearTo?: number;
  engine?: string; engineCode?: string; fuel?: string; displacementCc?: number; powerKw?: number;
  variant?: string; bodyStyle?: string; transmission?: string; drivetrain?: string;
  source?: string; sourceReference?: string; verified: boolean; errors: string[];
};
const detectCsvDelimiter = (input: string): string => {
  const candidates = [',', ';', '\t'];
  const counts = new Map(candidates.map((delimiter) => [delimiter, 0]));
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"' && quoted && input[i + 1] === '"') { i += 1; continue; }
    if (char === '"') quoted = !quoted;
    else if (char === '\n' || char === '\r') break;
    else if (!quoted && counts.has(char)) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  return candidates.reduce((best, candidate) => (counts.get(candidate)! > counts.get(best)! ? candidate : best), ',');
};
const parseCsv = (input: string, delimiter: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"' && quoted && input[i + 1] === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new Error('Le fichier contient un guillemet CSV non fermé.');
  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
};
const MAX_CATALOG_IMPORT_BYTES = 2_000_000;
const MAX_CATALOG_IMPORT_ROWS = 2_000;
const headerName = (value: string) => value.trim().replace(/^\uFEFF/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const slugify = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const normalizeReference = (value: string) => value.normalize('NFKC').toLocaleUpperCase('en-US').replace(/\s+/g, '');
const parseCatalogCsv = (input: string): CatalogCsvRow[] => {
  const records = parseCsv(input, detectCsvDelimiter(input));
  if (records.length < 2) throw new Error('Le CSV doit contenir une ligne d’en-tête et au moins une pièce.');
  if (records.length - 1 > MAX_CATALOG_IMPORT_ROWS) throw new Error(`Un import est limité à ${MAX_CATALOG_IMPORT_ROWS} lignes de données. Répartissez le catalogue en plusieurs fichiers.`);
  const headers = records[0].map(headerName);
  if (new Set(headers).size !== headers.length) throw new Error('Le fichier contient des colonnes en double.');
  if (!headers.includes('sku') || !headers.includes('name')) throw new Error('Les colonnes sku et name sont obligatoires.');
  const firstProductRow = new Map<string, { name: string; description?: string; category?: string; pieceBrand?: string }>();
  const parsed = records.slice(1).map((cells, index) => {
    const values: Record<string, string> = {};
    headers.forEach((header, column) => { values[header] = (cells[column] ?? '').trim(); });
    const value = (key: string) => values[key] || undefined;
    const number = (key: string) => { const raw = value(key); return raw === undefined ? undefined : Number(raw); };
    const verifiedRaw = value('verified')?.toLowerCase();
    const errors: string[] = [];
    const sku = value('sku') ?? ''; const name = value('name') ?? '';
    if (!sku) errors.push('SKU obligatoire.');
    if (!name) errors.push('Nom de la pièce obligatoire.');
    if (verifiedRaw && !['true','1','yes','oui','verified','verifie','vérifié'].includes(verifiedRaw) && !['false','0','no','non',''].includes(verifiedRaw)) errors.push('verified doit être true ou false.');
    const make = value('make'); const model = value('model'); const generation = value('generation');
    const yearFrom = number('yearfrom'); const yearTo = number('yearto');
    const displacementCc = number('displacementcc'); const powerKw = number('powerkw');
    const anyFitment = Boolean(make || model || generation || value('yearfrom') || value('yearto') || value('engine') || value('enginecode') || value('fuel') || value('displacementcc') || value('powerkw') || value('variant') || value('bodystyle') || value('transmission') || value('drivetrain'));
    if (anyFitment && (!make || !model || !generation || !Number.isInteger(yearFrom) || yearFrom! < 1900 || yearFrom! > 2100)) errors.push('Compatibilité : marque, modèle, génération et année de début valides sont requis ensemble.');
    if (yearTo !== undefined && (!Number.isInteger(yearTo) || yearTo < 1900 || yearTo > 2100 || (yearFrom !== undefined && yearTo < yearFrom))) errors.push('Année de fin invalide.');
    if ((value('fuel') || displacementCc !== undefined || powerKw !== undefined) && !value('engine') && !value('enginecode')) errors.push('Les caractéristiques de motorisation exigent engine ou engineCode.');
    if (displacementCc !== undefined && (!Number.isInteger(displacementCc) || displacementCc < 50 || displacementCc > 30000)) errors.push('displacementCc doit être un entier entre 50 et 30000.');
    if (powerKw !== undefined && (!Number.isInteger(powerKw) || powerKw < 1 || powerKw > 5000)) errors.push('powerKw doit être un entier entre 1 et 5000.');
    for (const [key, max] of [['make', 100], ['model', 100], ['category', 50], ['generation', 120], ['engine', 120], ['enginecode', 80], ['fuel', 40], ['variant', 120], ['bodystyle', 80], ['transmission', 80], ['drivetrain', 80], ['source', 240], ['sourcereference', 500]] as const) if ((value(key)?.length ?? 0) > max) errors.push(`${key} dépasse ${max} caractères.`);
    if ((value('bodystyle') || value('transmission') || value('drivetrain')) && !value('variant')) errors.push('bodyStyle, transmission et drivetrain exigent une version dans variant.');
    const referenceType = value('referencetype')?.toUpperCase() === 'ALTERNATIVE' ? 'ALTERNATIVE' : 'OEM';
    if (value('referencetype') && !['OEM','ALTERNATIVE'].includes(value('referencetype')!.toUpperCase())) errors.push('referenceType doit être OEM ou ALTERNATIVE.');
    const verified = ['true','1','yes','oui','verified','verifie','vérifié'].includes(verifiedRaw ?? '');
    if (verified && !value('source')) errors.push('Une source est obligatoire pour toute donnée vérifiée.');
    const description = value('description'); const category = value('category'); const pieceBrand = value('piecebrand');
    if (sku) {
      const key = sku.toUpperCase(); const previous = firstProductRow.get(key);
      if (!previous) firstProductRow.set(key, { name, description, category, pieceBrand });
      else {
        if (previous.name.trim().toLocaleLowerCase() !== name.trim().toLocaleLowerCase()) errors.push('Un même SKU doit conserver le même nom de pièce sur toutes ses lignes.');
        for (const [label, prior, current] of [['description', previous.description, description], ['category', previous.category, category], ['pieceBrand', previous.pieceBrand, pieceBrand]] as const) {
          if (prior && current && prior.toLocaleLowerCase() !== current.toLocaleLowerCase()) errors.push(`Un même SKU doit conserver la même valeur ${label} sur toutes ses lignes.`);
        }
      }
    }
    return { line: index + 2, sku, name, description, category, pieceBrand, reference: value('reference'), referenceType, make, model, generation, yearFrom, yearTo, engine: value('engine'), engineCode: value('enginecode'), fuel: value('fuel'), displacementCc, powerKw, variant: value('variant'), bodyStyle: value('bodystyle'), transmission: value('transmission'), drivetrain: value('drivetrain'), source: value('source'), sourceReference: value('sourcereference'), verified, errors } satisfies CatalogCsvRow;
  });
  return parsed;
};
type VehicleCsvRow = {
  line: number; make: string; model: string; category?: string; generation: string; yearFrom: number; yearTo?: number;
  engine?: string; engineCode?: string; fuel?: string; displacementCc?: number; powerKw?: number;
  variant?: string; bodyStyle?: string; transmission?: string; drivetrain?: string; source?: string; sourceReference?: string;
  verified: boolean; errors: string[];
};
const parseVehicleCatalogCsv = (input: string): VehicleCsvRow[] => {
  const records = parseCsv(input, detectCsvDelimiter(input));
  if (records.length < 2) throw new Error('Le CSV doit contenir un en-tête et au moins un véhicule.');
  if (records.length - 1 > MAX_CATALOG_IMPORT_ROWS) throw new Error(`Un import est limité à ${MAX_CATALOG_IMPORT_ROWS} véhicules.`);
  const headers = records[0].map(headerName);
  if (new Set(headers).size !== headers.length) throw new Error('Le fichier contient des colonnes en double.');
  for (const required of ['make', 'model', 'generation', 'yearfrom']) if (!headers.includes(required)) throw new Error(`La colonne ${required} est obligatoire.`);
  const seen = new Set<string>();
  return records.slice(1).map((cells, index) => {
    const values: Record<string, string> = {};
    headers.forEach((header, column) => { values[header] = (cells[column] ?? '').trim(); });
    const value = (key: string) => values[key] || undefined;
    const number = (key: string) => { const raw = value(key); return raw === undefined ? undefined : Number(raw); };
    const make = value('make') ?? ''; const model = value('model') ?? ''; const generation = value('generation') ?? '';
    const yearFrom = number('yearfrom'); const yearTo = number('yearto');
    const displacementCc = number('displacementcc'); const powerKw = number('powerkw');
    const verifiedRaw = value('verified')?.toLowerCase(); const errors: string[] = [];
    if (!make) errors.push('Marque obligatoire.');
    if (!model) errors.push('Modèle obligatoire.');
    if (!generation) errors.push('Génération obligatoire.');
    if (!Number.isInteger(yearFrom) || yearFrom! < 1900 || yearFrom! > 2100) errors.push('yearFrom doit être un entier entre 1900 et 2100.');
    if (yearTo !== undefined && (!Number.isInteger(yearTo) || yearTo < (yearFrom ?? 1900) || yearTo > 2100)) errors.push('yearTo doit être supérieur ou égal à yearFrom et inférieur ou égal à 2100.');
    if (displacementCc !== undefined && (!Number.isInteger(displacementCc) || displacementCc < 50 || displacementCc > 30000)) errors.push('displacementCc doit être un entier entre 50 et 30000.');
    if (powerKw !== undefined && (!Number.isInteger(powerKw) || powerKw < 1 || powerKw > 5000)) errors.push('powerKw doit être un entier entre 1 et 5000.');
    if ((value('fuel') || displacementCc !== undefined || powerKw !== undefined) && !value('engine') && !value('enginecode')) errors.push('Les caractéristiques de motorisation exigent engine ou engineCode.');
    if ((value('bodystyle') || value('transmission') || value('drivetrain')) && !value('variant')) errors.push('Les détails de carrosserie/version exigent variant.');
    if (verifiedRaw && !['true','1','yes','oui','verified','verifie','vérifié','false','0','no','non',''].includes(verifiedRaw)) errors.push('verified doit être true ou false.');
    const verified = ['true','1','yes','oui','verified','verifie','vérifié'].includes(verifiedRaw ?? '');
    if (verified && !value('source')) errors.push('Une source vérifiable est obligatoire pour marquer une entrée vérifiée.');
    const key = `${slugify(make)}:${slugify(model)}:${slugify(generation)}:${yearFrom ?? ''}:${value('enginecode')?.toUpperCase() || slugify(value('engine') || '')}:${slugify(value('variant') || '')}`;
    if (seen.has(key)) errors.push('Cette variante de véhicule est répétée dans le fichier.'); else seen.add(key);
    return { line: index + 2, make, model, category: value('category'), generation, yearFrom: yearFrom ?? 0, yearTo, engine: value('engine'), engineCode: value('enginecode'), fuel: value('fuel'), displacementCc, powerKw, variant: value('variant'), bodyStyle: value('bodystyle'), transmission: value('transmission'), drivetrain: value('drivetrain'), source: value('source'), sourceReference: value('sourcereference'), verified, errors } satisfies VehicleCsvRow;
  });
};
const previewImportSchema = z.object({ fileName: z.string().trim().min(1).max(200).default('catalogue.csv'), csv: z.string().min(1).max(MAX_CATALOG_IMPORT_BYTES).refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_CATALOG_IMPORT_BYTES, 'Le fichier dépasse la limite de 2 Mo.') });
app.post('/api/admin/catalog/imports/preview', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const input = previewImportSchema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'Fichier d’import invalide ou trop volumineux.', details: input.error.flatten() });
  try {
    const rows = parseCatalogCsv(input.data.csv);
    const acceptedRows = rows.filter((row) => row.errors.length === 0).length;
    const rejectedRows = rows.length - acceptedRows;
    const report = rows.filter((row) => row.errors.length).map(({ line, sku, errors }) => ({ line, sku, errors }));
    const job = await prisma.importJob.create({ data: { uploadedById: req.user!.sub, fileName: input.data.fileName, rawCsv: input.data.csv, rowCount: rows.length, acceptedRows, rejectedRows, report } });
    return res.status(201).json({ data: { jobId: job.id, fileName: job.fileName, rowCount: job.rowCount, acceptedRows, rejectedRows, previewTruncated: rows.length > 50, rows: rows.slice(0, 50).map(({ line, sku, name, make, model, generation, yearFrom, yearTo, engine, engineCode, fuel, displacementCc, powerKw, variant, bodyStyle, transmission, drivetrain, source, sourceReference, verified, errors }) => ({ line, sku, name, make, model, generation, yearFrom, yearTo, engine, engineCode, fuel, displacementCc, powerKw, variant, bodyStyle, transmission, drivetrain, source, sourceReference, verified, errors })) } });
  } catch (error) {
    if (error instanceof Error && !(error instanceof z.ZodError)) return res.status(400).json({ error: error.message });
    next(error);
  }
});

app.post('/api/admin/catalog/vehicles/imports/preview', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const input = previewImportSchema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'Fichier véhicule invalide ou trop volumineux.', details: input.error.flatten() });
  try {
    const rows = parseVehicleCatalogCsv(input.data.csv);
    const acceptedRows = rows.filter((row) => row.errors.length === 0).length;
    const rejectedRows = rows.length - acceptedRows;
    const report = rows.filter((row) => row.errors.length).map(({ line, make, model, generation, errors }) => ({ line, make, model, generation, errors }));
    const displayName = `VEHICLE_CATALOG:${input.data.fileName}`;
    const job = await prisma.importJob.create({ data: { uploadedById: req.user!.sub, fileName: displayName, rawCsv: input.data.csv, rowCount: rows.length, acceptedRows, rejectedRows, report } });
    return res.status(201).json({ data: { jobId: job.id, fileName: input.data.fileName, rowCount: job.rowCount, acceptedRows, rejectedRows, previewTruncated: rows.length > 50, rows: rows.slice(0, 50) } });
  } catch (error) {
    if (error instanceof Error && !(error instanceof z.ZodError)) return res.status(400).json({ error: error.message });
    next(error);
  }
});

app.get('/api/admin/catalog/imports', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const jobs = await prisma.importJob.findMany({ select: { id: true, fileName: true, status: true, rowCount: true, acceptedRows: true, rejectedRows: true, report: true, createdAt: true, completedAt: true }, orderBy: { createdAt: 'desc' }, take: 50 });
    return res.json({ data: jobs.map((job) => ({ ...job, importType: job.fileName.startsWith('VEHICLE_CATALOG:') ? 'VEHICLE_CATALOG' : 'PRODUCT_CATALOG', fileName: job.fileName.replace(/^VEHICLE_CATALOG:/, '') })) });
  } catch (error) { next(error); }
});

app.post('/api/admin/catalog/imports/:id/commit', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Identifiant d’import invalide.' });
  try {
    const job = await prisma.importJob.findUnique({ where: { id: id.data } });
    if (!job) return res.status(404).json({ error: 'Import introuvable.' });
    if (job.fileName.startsWith('VEHICLE_CATALOG:')) return res.status(409).json({ error: 'Cet import contient des véhicules. Utilisez la route dédiée aux imports de véhicules.' });
    if (job.status !== 'PREVIEWED') return res.status(409).json({ error: 'Cet import a déjà été exécuté.' });
    const rows = parseCatalogCsv(job.rawCsv);
    const errors = rows.filter((row) => row.errors.length).map(({ line, sku, errors: rowErrors }) => ({ line, sku, errors: rowErrors }));
    let acceptedRows = 0;
    for (const row of rows.filter((item) => item.errors.length === 0)) {
      try {
        await prisma.$transaction(async (tx) => {
          let generationId: string | undefined; let engineId: string | undefined; let variantId: string | undefined;
          if (row.make && row.model && row.generation && row.yearFrom) {
            const dataStatus = row.verified ? DataStatus.VERIFIED : DataStatus.DEMONSTRATION;
            const makeSlug = slugify(row.make); const modelSlug = slugify(row.model);
            const make = await tx.vehicleMake.upsert({ where: { slug: makeSlug }, update: { name: row.make, status: row.verified ? DataStatus.VERIFIED : undefined }, create: { name: row.make, slug: makeSlug, status: dataStatus } });
            const model = await tx.vehicleModel.upsert({ where: { makeId_slug: { makeId: make.id, slug: modelSlug } }, update: { name: row.model, status: row.verified ? DataStatus.VERIFIED : undefined }, create: { makeId: make.id, name: row.model, slug: modelSlug, status: dataStatus } });
            let generation = await tx.vehicleGeneration.findFirst({ where: { modelId: model.id, name: row.generation, yearFrom: row.yearFrom, yearTo: row.yearTo ?? null } });
            if (!generation) generation = await tx.vehicleGeneration.create({ data: { modelId: model.id, name: row.generation, yearFrom: row.yearFrom, yearTo: row.yearTo, status: dataStatus } });
            else if (row.verified && generation.status !== DataStatus.VERIFIED) generation = await tx.vehicleGeneration.update({ where: { id: generation.id }, data: { status: DataStatus.VERIFIED } });
            generationId = generation.id;
            if (row.engine || row.engineCode) {
              let engine = await tx.engine.findFirst({ where: { generationId, name: row.engine ?? row.engineCode!, engineCode: row.engineCode ?? null } });
              if (!engine) engine = await tx.engine.create({ data: { generationId, name: row.engine ?? row.engineCode!, engineCode: row.engineCode, fuel: row.fuel, displacementCc: row.displacementCc, powerKw: row.powerKw, status: dataStatus } });
              else if (row.verified || row.fuel || row.displacementCc || row.powerKw) engine = await tx.engine.update({ where: { id: engine.id }, data: { fuel: row.fuel, displacementCc: row.displacementCc, powerKw: row.powerKw, ...(row.verified ? { status: DataStatus.VERIFIED } : {}) } });
              engineId = engine.id;
            }
            if (row.variant) {
              let variant = await tx.vehicleVariant.findFirst({ where: { generationId, name: row.variant, engineId: engineId ?? null } });
              if (!variant) variant = await tx.vehicleVariant.create({ data: { generationId, name: row.variant, engineId, bodyStyle: row.bodyStyle, transmission: row.transmission, drivetrain: row.drivetrain, status: dataStatus } });
              else if (row.verified || row.bodyStyle || row.transmission || row.drivetrain) variant = await tx.vehicleVariant.update({ where: { id: variant.id }, data: { bodyStyle: row.bodyStyle, transmission: row.transmission, drivetrain: row.drivetrain, ...(row.verified ? { status: DataStatus.VERIFIED } : {}) } });
              variantId = variant.id;
            }
          }
          const pricingMode = await pricingModeForNewProduct(tx, row.category);
          const existingProduct = await tx.product.findUnique({ where: { sku: row.sku }, select: { id: true, _count: { select: { supplierOffers: true } } } });
          const product = await tx.product.upsert({ where: { sku: row.sku }, update: { name: row.name, description: row.description, category: row.category, pieceBrand: row.pieceBrand, ...(existingProduct && existingProduct._count.supplierOffers > 0 ? {} : { status: DataStatus.VERIFIED }) }, create: { sku: row.sku, name: row.name, description: row.description, category: row.category, pieceBrand: row.pieceBrand, status: DataStatus.VERIFIED, pricingMode } });
          const now = row.verified ? new Date() : null;
          const normalizedReference = row.reference ? normalizeReference(row.reference) : undefined;
          if (row.reference && normalizedReference) await tx.productReference.upsert({ where: { normalized_productId: { normalized: normalizedReference, productId: product.id } }, update: { value: row.reference, type: row.referenceType, source: row.source, verifiedAt: row.verified ? now : undefined }, create: { productId: product.id, value: row.reference, normalized: normalizedReference, type: row.referenceType, source: row.source, verifiedAt: now } });
          if (row.verified && generationId && row.yearFrom && row.source) {
            const existing = await tx.vehicleCompatibility.findFirst({ where: { productId: product.id, generationId, engineId: engineId ?? null, variantId: variantId ?? null, yearFrom: row.yearFrom, yearTo: row.yearTo ?? null } });
            if (existing) await tx.vehicleCompatibility.update({ where: { id: existing.id }, data: { source: row.source, sourceReference: row.sourceReference, verifiedAt: new Date() } });
            else await tx.vehicleCompatibility.create({ data: { productId: product.id, generationId, engineId, variantId, yearFrom: row.yearFrom, yearTo: row.yearTo, source: row.source, sourceReference: row.sourceReference, verifiedAt: new Date() } });
          }
        });
        acceptedRows += 1;
      } catch (error) { errors.push({ line: row.line, sku: row.sku, errors: [error instanceof Error ? error.message : 'Erreur base de données.'] }); }
    }
    const rejectedRows = rows.length - acceptedRows;
    const completed = await prisma.$transaction(async (tx) => {
      const updated = await tx.importJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', acceptedRows, rejectedRows, report: errors, completedAt: new Date() }, select: { id: true, fileName: true, status: true, rowCount: true, acceptedRows: true, rejectedRows: true, report: true, completedAt: true } });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'CATALOG_IMPORT_COMPLETED', entityType: 'IMPORT_JOB', entityId: job.id, details: { fileName: job.fileName, rowCount: job.rowCount, acceptedRows, rejectedRows } });
      return updated;
    });
    return res.json({ data: completed });
  } catch (error) {
    if (error instanceof Error && !(error instanceof z.ZodError)) return res.status(400).json({ error: error.message });
    next(error);
  }
});

app.post('/api/admin/catalog/vehicles/imports/:id/commit', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Identifiant d’import invalide.' });
  try {
    const job = await prisma.importJob.findUnique({ where: { id: id.data } });
    if (!job || !job.fileName.startsWith('VEHICLE_CATALOG:')) return res.status(404).json({ error: 'Import de véhicules introuvable.' });
    if (job.status !== 'PREVIEWED') return res.status(409).json({ error: 'Cet import a déjà été exécuté.' });
    const rows = parseVehicleCatalogCsv(job.rawCsv);
    const report = rows.filter((row) => row.errors.length).map(({ line, make, model, generation, errors }) => ({ line, make, model, generation, errors }));
    let acceptedRows = 0;
    for (const row of rows.filter((item) => item.errors.length === 0)) {
      try {
        await prisma.$transaction(async (tx) => {
          const status = row.verified ? DataStatus.VERIFIED : DataStatus.CONTRIBUTED;
          const source = row.source || `Import CSV à vérifier · ${job.fileName.slice('VEHICLE_CATALOG:'.length)}`;
          await upsertVehicleTaxonomy(tx, {
            mode: 'manual', makeName: row.make, modelName: row.model, vehicleCategory: row.category,
            generationName: row.generation, yearFrom: row.yearFrom, yearTo: row.yearTo,
            engineName: row.engine, engineCode: row.engineCode, fuel: row.fuel, displacementCc: row.displacementCc, powerKw: row.powerKw,
            variantName: row.variant, bodyStyle: row.bodyStyle, transmission: row.transmission, drivetrain: row.drivetrain,
          }, status, source, row.sourceReference);
        });
        acceptedRows += 1;
      } catch (error) {
        report.push({ line: row.line, make: row.make, model: row.model, generation: row.generation, errors: [(error as Error).message] });
      }
    }
    const rejectedRows = rows.length - acceptedRows;
    await prisma.$transaction(async (tx) => {
      await tx.importJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', acceptedRows, rejectedRows, report: report as Prisma.InputJsonValue, completedAt: new Date() } });
      await recordAudit(tx, { actorId: req.user!.sub, action: 'VEHICLE_CATALOG_IMPORT_COMPLETED', entityType: 'IMPORT_JOB', entityId: job.id, details: { fileName: job.fileName.slice('VEHICLE_CATALOG:'.length), rowCount: rows.length, acceptedRows, rejectedRows, verifiedRows: rows.filter((row) => row.errors.length === 0 && row.verified).length } });
    });
    return res.json({ data: { jobId: job.id, acceptedRows, rejectedRows, report }, message: `${acceptedRows} véhicule(s) importé(s). Les entrées vérifiées sont accessibles à la recherche; les autres restent contributives.` });
  } catch (error) {
    if (error instanceof Error && !(error instanceof z.ZodError)) return res.status(400).json({ error: error.message });
    next(error);
  }
});

const vehicleContributionReviewSchema = z.object({
  status: z.enum(['VERIFIED', 'REJECTED']),
  source: z.string().trim().min(3).max(240).optional(),
  sourceReference: z.string().trim().max(500).optional(),
}).strict().refine((value) => value.status !== 'VERIFIED' || Boolean(value.source), {
  message: 'Une source est requise pour publier ces données véhicule.', path: ['source'],
});

app.get('/api/admin/catalog/vehicles/contributions', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const generations = await prisma.vehicleGeneration.findMany({
      where: {
        OR: [
          { status: DataStatus.CONTRIBUTED },
          { engines: { some: { status: DataStatus.CONTRIBUTED } } },
          { variants: { some: { status: DataStatus.CONTRIBUTED } } },
        ],
        model: { status: { in: vehicleStatuses }, make: { status: { in: vehicleStatuses } } },
      },
      select: {
        id: true, name: true, yearFrom: true, yearTo: true, status: true, source: true, sourceReference: true,
        model: { select: { id: true, name: true, status: true, source: true, sourceReference: true, make: { select: { id: true, name: true, status: true, source: true, sourceReference: true } } } },
        engines: { where: { status: DataStatus.CONTRIBUTED }, select: { id: true, name: true, engineCode: true, fuel: true, displacementCc: true, powerKw: true, source: true, sourceReference: true } },
        variants: { where: { status: DataStatus.CONTRIBUTED }, select: { id: true, name: true, bodyStyle: true, transmission: true, drivetrain: true, source: true, sourceReference: true, engine: { select: { name: true, engineCode: true } } } },
      },
      orderBy: [{ model: { make: { name: 'asc' } } }, { model: { name: 'asc' } }, { yearFrom: 'desc' }],
      take: 500,
    });
    return res.json({ data: generations, limit: 500 });
  } catch (error) { next(error); }
});

app.patch('/api/admin/catalog/vehicles/contributions/:generationId/review', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const generationId = uuid.safeParse(req.params.generationId);
  const parsed = vehicleContributionReviewSchema.safeParse(req.body);
  if (!generationId.success) return res.status(400).json({ error: 'Identifiant de génération invalide.' });
  if (!parsed.success) return res.status(400).json({ error: 'Décision de validation invalide.', details: parsed.error.flatten() });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const generation = await tx.vehicleGeneration.findUnique({
        where: { id: generationId.data },
        select: { id: true, name: true, status: true, source: true, sourceReference: true, model: { select: { id: true, name: true, status: true, makeId: true, make: { select: { id: true, name: true, status: true } } } } },
      });
      if (!generation) throw Object.assign(new Error('Génération introuvable.'), { httpStatus: 404 });
      const engines = await tx.engine.findMany({ where: { generationId: generation.id, status: DataStatus.CONTRIBUTED }, select: { id: true } });
      const variants = await tx.vehicleVariant.findMany({ where: { generationId: generation.id, status: DataStatus.CONTRIBUTED }, select: { id: true } });
      const hasContributions = generation.status === DataStatus.CONTRIBUTED || engines.length > 0 || variants.length > 0;
      if (!hasContributions) throw Object.assign(new Error('Cette génération ne contient plus de données à examiner.'), { httpStatus: 409 });

      if (parsed.data.status === 'VERIFIED') {
        const source = parsed.data.source!;
        const provenance = { source, sourceReference: parsed.data.sourceReference };
        if (generation.model.make.status === DataStatus.CONTRIBUTED) await tx.vehicleMake.update({ where: { id: generation.model.makeId }, data: { ...provenance, status: DataStatus.VERIFIED } });
        if (generation.model.status === DataStatus.CONTRIBUTED) await tx.vehicleModel.update({ where: { id: generation.model.id }, data: { ...provenance, status: DataStatus.VERIFIED } });
        if (generation.status === DataStatus.CONTRIBUTED) await tx.vehicleGeneration.update({ where: { id: generation.id }, data: { ...provenance, status: DataStatus.VERIFIED } });
        if (engines.length) await tx.engine.updateMany({ where: { generationId: generation.id, status: DataStatus.CONTRIBUTED }, data: { ...provenance, status: DataStatus.VERIFIED } });
        if (variants.length) await tx.vehicleVariant.updateMany({ where: { generationId: generation.id, status: DataStatus.CONTRIBUTED }, data: { ...provenance, status: DataStatus.VERIFIED } });
      } else {
        if (generation.status === DataStatus.CONTRIBUTED) await tx.vehicleGeneration.update({ where: { id: generation.id }, data: { status: DataStatus.DEMONSTRATION } });
        if (engines.length) await tx.engine.updateMany({ where: { generationId: generation.id, status: DataStatus.CONTRIBUTED }, data: { status: DataStatus.DEMONSTRATION } });
        if (variants.length) await tx.vehicleVariant.updateMany({ where: { generationId: generation.id, status: DataStatus.CONTRIBUTED }, data: { status: DataStatus.DEMONSTRATION } });
        const remainingModelGenerations = await tx.vehicleGeneration.count({ where: { modelId: generation.model.id, status: { in: vehicleStatuses } } });
        if (remainingModelGenerations === 0 && generation.model.status === DataStatus.CONTRIBUTED) await tx.vehicleModel.update({ where: { id: generation.model.id }, data: { status: DataStatus.DEMONSTRATION } });
        const remainingMakeModels = await tx.vehicleModel.count({ where: { makeId: generation.model.makeId, status: { in: vehicleStatuses } } });
        if (remainingMakeModels === 0 && generation.model.make.status === DataStatus.CONTRIBUTED) await tx.vehicleMake.update({ where: { id: generation.model.makeId }, data: { status: DataStatus.DEMONSTRATION } });
      }

      await recordAudit(tx, {
        actorId: req.user!.sub,
        action: parsed.data.status === 'VERIFIED' ? 'VEHICLE_CATALOG_CONTRIBUTION_VERIFIED' : 'VEHICLE_CATALOG_CONTRIBUTION_REJECTED',
        entityType: 'VEHICLE_GENERATION', entityId: generation.id,
        details: { make: generation.model.make.name, model: generation.model.name, generation: generation.name, status: parsed.data.status, ...(parsed.data.status === 'VERIFIED' ? { source: parsed.data.source, sourceReference: parsed.data.sourceReference ?? null } : {}) },
      });
      return { make: generation.model.make.name, model: generation.model.name, generation: generation.name, status: parsed.data.status };
    });
    return res.json({ data: result, message: result.status === 'VERIFIED' ? 'Les données contributives ont été vérifiées et publiées.' : 'Les données contributives ont été écartées de la recherche.' });
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'httpStatus' in error ? Number(error.httpStatus) : 500;
    if (status !== 500) return res.status(status).json({ error: (error as Error).message });
    next(error);
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'unavailable', database: 'disconnected' });
  }
});

const uuid = z.string().uuid();
const adminVehicleEntrySchema = z.object({
  makeName: z.string().trim().min(1).max(100), modelName: z.string().trim().min(1).max(100), generationName: z.string().trim().min(1).max(120),
  vehicleCategory: z.string().trim().max(50).optional(), yearFrom: z.coerce.number().int().min(1900).max(2100), yearTo: z.coerce.number().int().min(1900).max(2100).optional(),
  engineName: z.string().trim().max(120).optional(), engineCode: z.string().trim().max(80).optional(), fuel: z.string().trim().max(40).optional(), displacementCc: z.coerce.number().int().min(50).max(30000).optional(), powerKw: z.coerce.number().int().min(1).max(5000).optional(),
  variantName: z.string().trim().max(120).optional(), bodyStyle: z.string().trim().max(80).optional(), transmission: z.string().trim().max(80).optional(), drivetrain: z.string().trim().max(80).optional(),
  source: z.string().trim().min(3).max(240).optional(), sourceReference: z.string().trim().max(500).optional(),
}).strict().refine((item) => item.yearTo === undefined || item.yearTo >= item.yearFrom, { message: 'L’année de fin doit être égale ou postérieure à l’année de début.', path: ['yearTo'] });
app.post('/api/admin/catalog/vehicles', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  const parsed = adminVehicleEntrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Données véhicule invalides.', details: parsed.error.flatten() });
  try {
    const { source, sourceReference, ...vehicle } = parsed.data;
    const result = await prisma.$transaction(async (tx) => {
      const taxonomy = await upsertVehicleTaxonomy(tx, { mode: 'manual', ...vehicle }, DataStatus.VERIFIED, source || 'Saisie administration', sourceReference);
      await recordAudit(tx, { actorId: req.user!.sub, action: 'VEHICLE_CATALOG_ENTRY_ADDED', entityType: 'VEHICLE_GENERATION', entityId: taxonomy.generationId, details: { make: vehicle.makeName, model: vehicle.modelName, generation: vehicle.generationName, yearFrom: vehicle.yearFrom, yearTo: vehicle.yearTo ?? vehicle.yearFrom, engineCode: vehicle.engineCode ?? null, variant: vehicle.variantName ?? null, source: source || 'Saisie administration' } });
      return taxonomy;
    });
    return res.status(201).json({ data: result, message: 'Véhicule ajouté au référentiel et disponible dans la recherche.' });
  } catch (error) { next(error); }
});
app.get('/api/catalog/vehicles/makes', async (_req, res, next) => {
  try {
    const makes = await prisma.vehicleMake.findMany({
      where: { status: { in: vehicleStatuses }, models: { some: { status: { in: vehicleStatuses } } } },
      select: { id: true, name: true }, orderBy: { name: 'asc' },
    });
    res.json({ data: makes });
  } catch (error) { next(error); }
});

app.get('/api/catalog/vehicles/models', async (req, res, next) => {
  const makeId = uuid.safeParse(req.query.makeId);
  if (!makeId.success) return res.status(400).json({ error: 'makeId UUID requis.' });
  try {
    const models = await prisma.vehicleModel.findMany({
      where: { makeId: makeId.data, status: { in: vehicleStatuses }, make: { status: { in: vehicleStatuses } } },
      select: { id: true, name: true, category: true }, orderBy: { name: 'asc' },
    });
    res.json({ data: models });
  } catch (error) { next(error); }
});

app.get('/api/catalog/vehicles/generations', async (req, res, next) => {
  const modelId = uuid.safeParse(req.query.modelId);
  if (!modelId.success) return res.status(400).json({ error: 'modelId UUID requis.' });
  try {
    const generations = await prisma.vehicleGeneration.findMany({
      where: { modelId: modelId.data, status: { in: vehicleStatuses }, model: { status: { in: vehicleStatuses }, make: { status: { in: vehicleStatuses } } } },
      select: { id: true, name: true, yearFrom: true, yearTo: true }, orderBy: { yearFrom: 'desc' },
    });
    res.json({ data: generations });
  } catch (error) { next(error); }
});

app.get('/api/catalog/vehicles/engines', async (req, res, next) => {
  const generationId = uuid.safeParse(req.query.generationId);
  if (!generationId.success) return res.status(400).json({ error: 'generationId UUID requis.' });
  try {
    const engines = await prisma.engine.findMany({
      where: { generationId: generationId.data, status: { in: vehicleStatuses }, generation: { status: { in: vehicleStatuses }, model: { status: { in: vehicleStatuses }, make: { status: { in: vehicleStatuses } } } } },
      select: { id: true, name: true, fuel: true, displacementCc: true, powerKw: true, engineCode: true },
      orderBy: { name: 'asc' },
    });
    res.json({ data: engines });
  } catch (error) { next(error); }
});

app.get('/api/catalog/vehicles/variants', async (req, res, next) => {
  const generationId = uuid.safeParse(req.query.generationId);
  if (!generationId.success) return res.status(400).json({ error: 'generationId UUID requis.' });
  const engineId = req.query.engineId === undefined ? undefined : uuid.safeParse(req.query.engineId);
  if (engineId && !engineId.success) return res.status(400).json({ error: 'engineId UUID invalide.' });
  try {
    const variants = await prisma.vehicleVariant.findMany({
      where: {
        generationId: generationId.data, status: { in: vehicleStatuses },
        generation: { status: { in: vehicleStatuses }, model: { status: { in: vehicleStatuses }, make: { status: { in: vehicleStatuses } } } },
        ...(engineId?.success ? { OR: [{ engineId: engineId.data }, { engineId: null }] } : {}),
      },
      select: { id: true, name: true, bodyStyle: true, transmission: true, drivetrain: true, engineId: true },
      orderBy: { name: 'asc' },
    });
    res.json({ data: variants });
  } catch (error) { next(error); }
});

app.get('/api/catalog/vehicles/open-data', async (_req, res, next) => {
  try {
    const data = await prisma.vehicleGeneration.findMany({
      where: { source: 'vehicle-makes-models · ODbL 1.0 · source communautaire non validée localement' },
      select: {
        id: true, name: true, yearFrom: true, yearTo: true, status: true, source: true, sourceReference: true,
        model: { select: { id: true, name: true, category: true, make: { select: { id: true, name: true } } } },
        engines: { select: { id: true, name: true, fuel: true, displacementCc: true, powerKw: true, engineCode: true, status: true, source: true } },
        variants: { select: { id: true, engineId: true, name: true, bodyStyle: true, transmission: true, drivetrain: true, status: true, source: true } },
      },
      orderBy: [{ model: { make: { name: 'asc' } } }, { model: { name: 'asc' } }, { yearFrom: 'asc' }],
    });
    res.setHeader('X-Database-License', 'ODbL-1.0');
    return res.json({ license: 'Open Database License v1.0', attribution: 'vehicle-makes-models and Autoevolution', source: 'https://github.com/gor3a/vehicle-makes-models', data });
  } catch (error) { next(error); }
});

const searchQuery = z.object({
  makeId: uuid.optional(), modelId: uuid.optional(), generationId: uuid.optional(), engineId: uuid.optional(), variantId: uuid.optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  reference: z.string().trim().max(80).optional(), q: z.string().trim().max(100).optional(), category: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(48).default(24),
});
const romanGenerationByNumber: Record<string, string> = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI', '7': 'VII', '8': 'VIII', '9': 'IX', '10': 'X' };
app.get('/api/catalog/products/:id', optionalAuth, async (req: AuthenticatedRequest, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const productId = String(req.params.id);
  if (!z.string().uuid().safeParse(productId).success) return res.status(404).json({ error: 'Pièce introuvable.' });
  try {
    const product = await prisma.product.findFirst({
      where: { id: productId, archivedAt: null, OR: [{ status: DataStatus.VERIFIED, supplierOffers: { none: {} } }, { supplierOffers: { some: { status: 'APPROVED', archivedAt: null, supplier: { status: 'ACTIVE' } } } }] },
      include: {
        references: { where: { OR: [{ verifiedAt: { not: null } }, { source: 'soumis par le partenaire', product: { supplierOffers: { some: { status: 'APPROVED', archivedAt: null, supplier: { status: 'ACTIVE' } } } } }] } },
        compatibilities: { where: { generation: { status: { in: vehicleStatuses }, model: { status: { in: vehicleStatuses }, make: { status: { in: vehicleStatuses } } } } }, select: {
          yearFrom: true, yearTo: true,
          source: true,
          generation: { select: { name: true, model: { select: { name: true, make: { select: { name: true } } } } } },
          engine: { select: { name: true, engineCode: true, fuel: true, displacementCc: true, powerKw: true } },
          variant: { select: { name: true, bodyStyle: true, transmission: true, drivetrain: true } },
        }, orderBy: { yearFrom: 'desc' } },
        supplierOffers: { where: { status: 'APPROVED', archivedAt: null, supplier: { status: 'ACTIVE' } }, select: { stockItems: { select: { onHand: true, reserved: true, damaged: true } } } },
      },
    });
    if (!product) return res.status(404).json({ error: 'Pièce introuvable.' });
    let discountPercent = 0; let profileId: string | null = null;
    if (req.user) {
      const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { role: true, pricingProfile: { select: { id: true, discountPercent: true, active: true } } } });
      if (user?.role === 'RESELLER' && user.pricingProfile?.active) { discountPercent = Number(user.pricingProfile.discountPercent); profileId = user.pricingProfile.id; }
    }
    if (profileId) {
      const [productRule, categoryRule] = await Promise.all([
        prisma.profileProductPrice.findUnique({ where: { profileId_productId: { profileId, productId: product.id } }, select: { discountPercent: true } }),
        product.category ? prisma.profileCategoryPrice.findUnique({ where: { profileId_category: { profileId, category: product.category.trim().toLocaleLowerCase('fr-TN') } }, select: { discountPercent: true } }) : null,
      ]);
      if (productRule) discountPercent = Number(productRule.discountPercent); else if (categoryRule) discountPercent = Number(categoryRule.discountPercent);
    }
    const { supplierOffers, ...publicProduct } = product;
    const availableQuantity = supplierOffers.flatMap((offer) => offer.stockItems).reduce((sum, stock) => sum + Math.max(0, stock.onHand - stock.reserved - stock.damaged), 0);
    if (product.listPrice === null) return res.json({ data: { ...publicProduct, availableQuantity, pricing: null } });
    const baseMills = Math.round(Number(product.listPrice) * 1000);
    const netMills = Math.round(baseMills * (10000 - Math.round(discountPercent * 100)) / 10000);
    const vatBasisPoints = Math.round(Number(product.vatRate) * 100);
    const grossMills = Math.round(netMills * (10000 + vatBasisPoints) / 10000);
    res.json({ data: { ...publicProduct, availableQuantity, pricing: { currency: 'TND', listPriceExclTax: (baseMills / 1000).toFixed(3), discountPercent: discountPercent.toFixed(2), unitPriceExclTax: (netMills / 1000).toFixed(3), vatRate: Number(product.vatRate).toFixed(2), unitPriceInclTax: (grossMills / 1000).toFixed(3) } } });
  } catch (error) { next(error); }
});
app.get('/api/catalog/search', optionalAuth, async (req: AuthenticatedRequest, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const parsed = searchQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Filtres invalides.', details: parsed.error.flatten() });
  const { makeId, modelId, generationId, engineId, variantId, year, reference, q, category, page, limit } = parsed.data;
  try {
    const normalizedRef = reference ? normalizeReference(reference) : undefined;
    const normalizedQueryRef = q ? normalizeReference(q) : undefined;
    const compatibilityWhere = {
      ...(generationId ? { generationId } : {}), ...(engineId ? { engineId } : {}), ...(variantId ? { variantId } : {}),
      ...(year ? { yearFrom: { lte: year } } : {}),
      generation: {
        status: { in: vehicleStatuses },
        model: {
          status: { in: vehicleStatuses },
          ...(modelId ? { id: modelId } : {}),
          make: { status: { in: vehicleStatuses }, ...(makeId ? { id: makeId } : {}) },
        },
      },
      ...(engineId ? { engine: { status: { in: vehicleStatuses } } } : {}),
      ...(variantId ? { variant: { status: { in: vehicleStatuses } } } : {}),
      AND: [
        ...(year ? [{ OR: [{ yearTo: null }, { yearTo: { gte: year } }] }] : []),
        { OR: [{ engineId: null }, { engine: { status: { in: vehicleStatuses } } }] },
        { OR: [{ variantId: null }, { variant: { status: { in: vehicleStatuses } } }] },
      ],
    };
    const hasVehicleFilter = Boolean(makeId || modelId || generationId || engineId || variantId || year);
    const productWhere = {
      AND: [
        { archivedAt: null },
        { OR: [{ status: DataStatus.VERIFIED, supplierOffers: { none: {} } }, { supplierOffers: { some: { status: 'APPROVED' as const, archivedAt: null, supplier: { status: 'ACTIVE' as const } } } }] },
        ...(hasVehicleFilter ? [{ compatibilities: { some: compatibilityWhere } }] : []),
        ...(normalizedRef ? [{ OR: [
          { references: { some: { normalized: normalizedRef } } },
          { sku: { equals: reference, mode: 'insensitive' as const } },
          { supplierOffers: { some: { status: 'APPROVED' as const, archivedAt: null, supplier: { status: 'ACTIVE' as const }, supplierSku: { equals: reference, mode: 'insensitive' as const } } } },
        ] }] : []),
      ],
      ...(category ? { category: { equals: category, mode: 'insensitive' as const } } : {}),
      ...(q ? { AND: q.split(/[\s,;]+/).filter(Boolean).map((term) => ({ OR: [
        { name: { contains: term, mode: 'insensitive' as const } },
        { description: { contains: term, mode: 'insensitive' as const } },
        { category: { contains: term, mode: 'insensitive' as const } },
        { pieceBrand: { contains: term, mode: 'insensitive' as const } },
        { sku: { contains: term, mode: 'insensitive' as const } },
        ...(normalizedQueryRef ? [{ references: { some: { normalized: { contains: normalizedQueryRef } } } }] : []),
        { supplierOffers: { some: { status: 'APPROVED' as const, archivedAt: null, supplier: { status: 'ACTIVE' as const }, supplierSku: { contains: term, mode: 'insensitive' as const } } } },
        { compatibilities: { some: { generation: { status: { in: vehicleStatuses }, model: { status: { in: vehicleStatuses }, make: { status: { in: vehicleStatuses } } } }, OR: [
          { generation: { model: { name: { contains: term, mode: 'insensitive' as const } } } },
          { generation: { model: { make: { name: { contains: term, mode: 'insensitive' as const } } } } },
          { generation: { name: { contains: term, mode: 'insensitive' as const } } },
          ...(romanGenerationByNumber[term] ? [{ generation: { name: { contains: romanGenerationByNumber[term], mode: 'insensitive' as const } } }] : []),
          { engine: { name: { contains: term, mode: 'insensitive' as const } } },
          { engine: { engineCode: { contains: term, mode: 'insensitive' as const } } },
          { variant: { name: { contains: term, mode: 'insensitive' as const } } },
          { variant: { bodyStyle: { contains: term, mode: 'insensitive' as const } } },
          ...(/^\d{4}$/.test(term) ? [{ AND: [{ yearFrom: { lte: Number(term) } }, { OR: [{ yearTo: null }, { yearTo: { gte: Number(term) } }] }] }] : []),
        ] } } },
      ] })) } : {}),
    };
    const { category: _categoryFilter, ...categoryBaseWhere } = productWhere;
    const [items, total, categoryGroups, categoryTotal] = await prisma.$transaction([
      prisma.product.findMany({ where: productWhere, include: {
        references: { where: { OR: [
          { verifiedAt: { not: null } },
          { source: 'soumis par le partenaire', product: { supplierOffers: { some: { status: 'APPROVED', archivedAt: null, supplier: { status: 'ACTIVE' } } } } },
        ] } },
        compatibilities: { where: compatibilityWhere, select: {
          yearFrom: true, yearTo: true, source: true,
          generation: { select: { name: true, model: { select: { name: true, make: { select: { name: true } } } } } },
          engine: { select: { name: true, engineCode: true, fuel: true, displacementCc: true, powerKw: true } },
          variant: { select: { name: true, bodyStyle: true, transmission: true, drivetrain: true } },
        }, orderBy: { yearFrom: 'desc' }, take: 3 },
        supplierOffers: { where: { status: 'APPROVED', archivedAt: null, supplier: { status: 'ACTIVE' } }, select: { stockItems: { select: { onHand: true, reserved: true, damaged: true } } } },
      }, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
      prisma.product.count({ where: productWhere }),
      prisma.product.groupBy({ by: ['category'], where: { ...categoryBaseWhere, category: { not: null } }, orderBy: { category: 'asc' }, _count: { _all: true } }),
      prisma.product.count({ where: categoryBaseWhere }),
    ]);
    let discountPercent = 0; let profileId: string | null = null;
    if (req.user) {
      const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { role: true, pricingProfile: { select: { id: true, discountPercent: true, active: true } } } });
      if (user?.role === 'RESELLER' && user.pricingProfile?.active) { discountPercent = Number(user.pricingProfile.discountPercent); profileId = user.pricingProfile.id; }
    }
    const productDiscounts = profileId && items.length ? await prisma.profileProductPrice.findMany({ where: { profileId, productId: { in: items.map((product) => product.id) } }, select: { productId: true, discountPercent: true } }) : [];
    const productDiscountMap = new Map(productDiscounts.map((rule) => [rule.productId, Number(rule.discountPercent)]));
    const categoryDiscounts = profileId ? await prisma.profileCategoryPrice.findMany({ where: { profileId }, select: { category: true, discountPercent: true } }) : [];
    const categoryDiscountMap = new Map(categoryDiscounts.map((rule) => [rule.category, Number(rule.discountPercent)]));
    const data = items.map((product) => {
      const effectiveDiscountPercent = productDiscountMap.get(product.id) ?? (product.category ? categoryDiscountMap.get(product.category.trim().toLocaleLowerCase('fr-TN')) : undefined) ?? discountPercent;
      const { supplierOffers, ...publicProduct } = product;
      const availableQuantity = supplierOffers.flatMap((offer) => offer.stockItems).reduce((sum, stock) => sum + Math.max(0, stock.onHand - stock.reserved - stock.damaged), 0);
      if (product.listPrice === null) return { ...publicProduct, availableQuantity, pricing: null };
      const baseMills = Math.round(Number(product.listPrice) * 1000);
      const discountBasisPoints = Math.round(effectiveDiscountPercent * 100);
      const netMills = Math.round(baseMills * (10000 - discountBasisPoints) / 10000);
      const vatBasisPoints = Math.round(Number(product.vatRate) * 100);
      const grossMills = Math.round(netMills * (10000 + vatBasisPoints) / 10000);
      return { ...publicProduct, availableQuantity, pricing: { currency: 'TND', listPriceExclTax: (baseMills / 1000).toFixed(3), discountPercent: effectiveDiscountPercent.toFixed(2), unitPriceExclTax: (netMills / 1000).toFixed(3), vatRate: Number(product.vatRate).toFixed(2), unitPriceInclTax: (grossMills / 1000).toFixed(3) } };
    });
    const categories = categoryGroups.filter((group) => Boolean(group.category)).map((group) => ({ name: group.category!, count: Number(group._count && typeof group._count === 'object' && '_all' in group._count ? group._count._all ?? 0 : 0) })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr'));
    res.json({ data, categories, categoryTotal, pagination: { page, limit, total, pages: Math.ceil(total / limit) }, compatibilityPolicy: 'supplier-managed-fitments' });
  } catch (error) { next(error); }
});

const openapi = {
  openapi: '3.0.3', info: { title: 'Ghorbel Automative Supply Group API', version: '0.1.0' },
  servers: [{ url: '/' }], paths: {
    '/api/health': { get: { summary: 'API et connexion PostgreSQL', responses: { '200': { description: 'État disponible' }, '503': { description: 'Base inaccessible' } } } },
    '/api/auth/register': { post: { summary: 'Créer un compte particulier; les comptes partenaires sont créés par un administrateur', responses: { '201': { description: 'Compte client créé' }, '409': { description: 'Adresse déjà utilisée' }, '429': { description: 'Limite de tentatives atteinte' } } } },
    '/api/auth/login': { post: { summary: 'Connexion et émission d’un jeton valable 12 heures', responses: { '200': { description: 'Jeton de session' }, '401': { description: 'Identifiants incorrects' }, '403': { description: 'Compte non actif' } } } },
    '/api/auth/bootstrap-admin': { post: { summary: 'Créer le premier administrateur avec X-Bootstrap-Key (une seule fois)', responses: { '201': { description: 'Administrateur initial créé' }, '409': { description: 'Un administrateur existe déjà' } } } },
    '/api/auth/me': { get: { summary: 'Profil du compte connecté', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Profil' }, '401': { description: 'Session invalide' } } } },
    '/api/account/addresses': { get: { summary: 'Lister les adresses de livraison du client connecté', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Adresses propres au compte' }, '403': { description: 'Acheteur requis' } } }, post: { summary: 'Enregistrer une adresse de livraison', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Adresse enregistrée' }, '400': { description: 'Coordonnées invalides' }, '409': { description: 'Limite de 20 adresses atteinte' } } } },
    '/api/account/addresses/{id}': { delete: { summary: 'Supprimer une adresse de livraison personnelle', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Adresse supprimée' }, '404': { description: 'Adresse introuvable' } } } },
    '/api/account/addresses/{id}/default': { patch: { summary: 'Définir une adresse de livraison par défaut', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Adresse par défaut mise à jour' }, '404': { description: 'Adresse introuvable' } } } },
    '/api/notifications': { get: { summary: 'Notifications du compte connecté et nombre de non lues', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Centre de notifications privé' } } } },
    '/api/notifications/read-all': { patch: { summary: 'Marquer ses notifications comme lues', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Notifications mises à jour' } } } },
    '/api/notifications/{id}/read': { patch: { summary: 'Marquer une de ses notifications comme lue', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Notification mise à jour' }, '404': { description: 'Notification introuvable' } } } },
    '/api/admin/dashboard/summary': { get: { summary: 'Indicateurs commerciaux agrégés réservés à l’administrateur', security: [{ bearerAuth: [] }], parameters: [{ name: 'days', in: 'query', required: false, schema: { type: 'integer', enum: [7, 30, 90], default: 30 } }], responses: { '200': { description: 'Ventes TTC, encaissements, tâches en attente, stock et tendances' }, '403': { description: 'Administrateur requis' } } } },
    '/api/admin/audit-logs': { get: { summary: 'Consulter le journal paginé des actions sensibles', security: [{ bearerAuth: [] }], parameters: [{ name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } }, { name: 'cursor', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } }, { name: 'action', in: 'query', required: false, schema: { type: 'string' } }, { name: 'actorId', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Événements d’audit et curseur suivant' }, '403': { description: 'Administrateur requis' } } } },
    '/api/payments/bank-transfer-details': { get: { summary: 'Coordonnées publiques de virement si le mode est activé', responses: { '200': { description: 'Coordonnées configurées ou null' } } } },
    '/api/admin/company-settings/payment': { get: { summary: 'Lire les paramètres de paiement par virement', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Paramètres de paiement' }, '403': { description: 'Administrateur requis' } } }, patch: { summary: 'Configurer les coordonnées bancaires et instructions de virement', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Paramètres enregistrés' }, '400': { description: 'Coordonnées invalides' }, '403': { description: 'Administrateur requis' } } } },
    '/api/admin/reports/sales.csv': { get: { summary: 'Exporter les lignes de vente filtrées par période, sans données de livraison client', security: [{ bearerAuth: [] }], parameters: [{ name: 'days', in: 'query', required: false, schema: { type: 'integer', enum: [7, 30, 90], default: 30 } }], responses: { '200': { description: 'CSV des commandes et lignes avec prix TTC figés' }, '403': { description: 'Administrateur requis' }, '413': { description: 'Période trop volumineuse pour une seule exportation' } } } },
    '/api/admin/accounts': { get: { summary: 'Lister les comptes clients et professionnels (administrateur)', security: [{ bearerAuth: [] }], parameters: [{ name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['PENDING', 'ACTIVE', 'SUSPENDED'] } }], responses: { '200': { description: 'Comptes' }, '403': { description: 'Administrateur requis' } } }, post: { summary: 'Créer un accès fournisseur ou revendeur partenaire (administrateur)', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Compte partenaire actif créé' }, '409': { description: 'Adresse déjà utilisée' } } } },
    '/api/admin/accounts/{id}/status': { patch: { summary: 'Activer ou suspendre un compte (administrateur)', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Compte mis à jour' }, '403': { description: 'Administrateur requis' } } } },
    '/api/admin/users/{id}': { delete: { summary: 'Supprimer définitivement un fournisseur et ses données de catalogue', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Fournisseur supprimé; les commandes conservent leurs montants figés' }, '404': { description: 'Compte introuvable' }, '409': { description: 'La suppression est réservée aux fournisseurs' } } } },
    '/api/admin/accounts/{id}/pricing-profile': { patch: { summary: 'Attribuer ou retirer le profil tarifaire d’un revendeur', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Profil tarifaire mis à jour' }, '403': { description: 'Administrateur requis' } } } },
    '/api/admin/pricing-profiles': { get: { summary: 'Lister les profils de remise revendeur', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Profils tarifaires' } } }, post: { summary: 'Créer un profil tarifaire revendeur', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Profil créé' }, '409': { description: 'Nom déjà utilisé' } } } },
    '/api/admin/products': { get: { summary: 'Lister les pièces pour la gestion de leurs prix', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Pièces et prix catalogue' } } } },
    '/api/admin/products/{id}/pricing': { patch: { summary: 'Définir le prix catalogue HT et la TVA d’une pièce', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Prix mis à jour' }, '404': { description: 'Pièce introuvable' } } } },
    '/api/orders': { get: { summary: 'Consulter les commandes du compte client ou partenaire acheteur connecté', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Historique et montants figés' }, '403': { description: 'Acheteur requis' } } }, post: { summary: 'Créer une commande pour un acheteur connecté (client, revendeur ou fournisseur) ou invité, recalculer les prix et réserver le stock en transaction', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Commande enregistrée ; les invités reçoivent un code privé de suivi' }, '409': { description: 'Stock insuffisant ou réservation concurrente' } } } },
    '/api/orders/guest/lookup': { post: { summary: 'Consulter une commande invitée avec son numéro et son code privé, sans exposer les coordonnées personnelles', responses: { '200': { description: 'Statut, lignes et suivi transport' }, '404': { description: 'Commande ou code invalide ou expiré' } } } },
    '/api/orders/{id}/payment-proofs': { post: { summary: 'Déposer un justificatif PDF/JPEG/PNG vérifié sur une commande appartenant au client', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '201': { description: 'Justificatif reçu, paiement toujours à vérifier' }, '400': { description: 'Fichier invalide ou trop volumineux' }, '409': { description: 'Commande non réglée par virement ou limite atteinte' } } } },
    '/api/orders/guest/payment-proofs': { post: { summary: 'Déposer un justificatif de virement avec numéro de commande et code privé', responses: { '201': { description: 'Justificatif reçu, paiement toujours à vérifier' }, '404': { description: 'Commande ou code invalide ou expiré' } } } },
    '/api/orders/guest/document': { post: { summary: 'Télécharger le récapitulatif PDF d’une commande invitée via son code privé', responses: { '200': { description: 'Document PDF' }, '404': { description: 'Commande ou code invalide ou expiré' } } } },
    '/api/orders/{id}/document': { get: { summary: 'Télécharger le récapitulatif PDF de sa commande', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Document PDF' }, '404': { description: 'Commande introuvable' } } } },
    '/api/orders/{id}/cancel': { post: { summary: 'Annuler sa commande non payée avant expédition et libérer le stock', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Commande annulée, stock libéré et mouvement journalisé' }, '409': { description: 'Paiement en vérification, expédition commencée ou conflit concurrent' } } } },
    '/api/orders/{id}/payment-reference': { post: { summary: 'Transmettre la référence d’un virement bancaire pour validation manuelle', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Référence reçue, paiement en vérification' }, '409': { description: 'Commande incompatible, annulée ou déjà payée' } } } },
    '/api/partner/orders': { get: { summary: 'Voir uniquement les lignes attribuées au partenaire connecté, avec son prix d’achat figé et sans données personnelles du client', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Lignes attribuées et prix convenus du partenaire' }, '403': { description: 'Compte partenaire requis' } } } },
    '/api/partner/dashboard': { get: { summary: 'Indicateurs, stocks, approvisionnements et activités du partenaire authentifié uniquement', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Résumé privé du partenaire connecté' }, '403': { description: 'Compte partenaire requis' } } } },
    '/api/partner/profile': { patch: { summary: 'Modifier les coordonnées du partenaire connecté sans fournir son identifiant', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Profil mis à jour' }, '400': { description: 'Informations invalides' }, '403': { description: 'Compte partenaire requis' } } } },
    '/api/partner/password': { patch: { summary: 'Changer le mot de passe du partenaire après vérification du mot de passe actuel', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Mot de passe modifié' }, '400': { description: 'Mot de passe actuel incorrect ou saisie invalide' }, '403': { description: 'Compte partenaire requis' } } } },
    '/api/partner/orders/{orderId}/invoices': { post: { summary: 'Déposer un PDF de facture pour une commande attribuée au partenaire connecté', security: [{ bearerAuth: [] }], parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '201': { description: 'Facture déposée en attente de vérification' }, '403': { description: 'Compte partenaire requis' }, '404': { description: 'Commande non attribuée à ce partenaire' } } } },
    '/api/partner/orders/{orderId}/invoices/generate': { post: { summary: 'Générer une facture partenaire depuis les lignes et prix convenus figés de la commande', security: [{ bearerAuth: [] }], parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '201': { description: 'Facture générée et transmise en vérification à l’administration' }, '403': { description: 'Compte partenaire requis' }, '404': { description: 'Commande non attribuée à ce partenaire' } } } },
    '/api/partner/supplier-invoices': { get: { summary: 'Lister les factures déposées par le partenaire connecté', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Métadonnées de ses propres factures' } } } },
    '/api/partner/supplier-invoices/{id}/file': { get: { summary: 'Télécharger une facture uniquement si elle appartient au partenaire connecté', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'PDF privé' }, '404': { description: 'Document introuvable' } } } },
    '/api/partner/orders/lines/{id}/status': { patch: { summary: 'Faire avancer une ligne de commande attribuée au partenaire', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Statut avancé' }, '409': { description: 'Transition de statut invalide' } } } },
    '/api/admin/orders': { get: { summary: 'Rechercher, filtrer et paginer les commandes avec fournisseur exécutant', security: [{ bearerAuth: [] }], parameters: ['search','status','paymentStatus','paymentMethod','customerType','from','to','page','pageSize'].map((name) => ({ name, in: 'query', required: false, schema: { type: 'string' } })), responses: { '200': { description: 'Page de commandes filtrée, total et nombre de pages' }, '400': { description: 'Filtres invalides' } } } },
    '/api/admin/supplier-invoices': { get: { summary: 'Lister et contrôler les factures fournisseurs', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Factures, fournisseur, commande et statut de contrôle' } } } },
    '/api/admin/supplier-invoices/{id}/file': { get: { summary: 'Télécharger une facture fournisseur privée', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'PDF privé' }, '404': { description: 'Document introuvable' } } } },
    '/api/admin/supplier-invoices/{id}/review': { patch: { summary: 'Accepter ou refuser une facture fournisseur et notifier son propriétaire', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Décision enregistrée' }, '409': { description: 'Facture déjà examinée' } } } },
    '/api/admin/orders/{id}/document': { get: { summary: 'Télécharger le récapitulatif PDF d’une commande', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Document PDF' }, '404': { description: 'Commande introuvable' } } } },
    '/api/admin/orders/{id}/payment-proofs/{proofId}': { get: { summary: 'Télécharger un justificatif bancaire privé pour examen par l’administration', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'proofId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Justificatif binaire privé' }, '404': { description: 'Justificatif introuvable' } } } },
    '/api/admin/orders/{id}/cancel': { post: { summary: 'Annuler une commande impayée avant expédition et libérer le stock', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Commande annulée et stock libéré' }, '409': { description: 'Paiement en vérification, expédition commencée ou conflit concurrent' } } } },
    '/api/admin/orders/{id}/payment': { patch: { summary: 'Confirmer un règlement après contrôle, avec un journal d’audit', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Statut du paiement modifié' }, '409': { description: 'Paiement non vérifiable ou commande non livrée' } } } },
    '/api/partner/offers': { get: { summary: 'Offres privées du partenaire connecté', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Offres et coûts appartenant au compte connecté' }, '403': { description: 'Partenaire requis' } } }, post: { summary: 'Soumettre une offre privée pour validation', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Offre en attente, non publiée au catalogue public' }, '409': { description: 'Référence fournisseur déjà utilisée' } } } },
    '/api/partner/offers/{id}/price-history': { get: { summary: 'Historique des changements de coût fournisseur de ses propres offres', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Historique privé des prix fournisseur' }, '404': { description: 'Offre non détenue par le partenaire' } } } },
    '/api/partner/offers/export.csv': { get: { summary: 'Exporter en CSV le catalogue privé du fournisseur connecté, avec ses prix proposés et ses stocks uniquement', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Fichier CSV privé sans prix final client ni marge GHORBEL' }, '403': { description: 'Partenaire requis' } } } },
    '/api/partner/offers/import/preview': { post: { summary: 'Prévisualiser les créations et mises à jour d’un CSV fournisseur, sans modifier les données', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Lignes valides, action à appliquer et erreurs par numéro de ligne' }, '400': { description: 'Fichier ou colonnes invalides' } } } },
    '/api/partner/offers/import/commit': { post: { summary: 'Créer ou mettre à jour les offres du CSV dans une transaction; les hausses attendent l’approbation GHORBEL', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Offres créées ou mises à jour, avec les erreurs par ligne' }, '409': { description: 'Conflit de mise à jour ou référence concurrente' } } } },
    '/api/partner/inventory': { get: { summary: 'Stock et entrepôts accessibles au fournisseur connecté, filtrés sur ses propres offres', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Inventaire privé du fournisseur' }, '403': { description: 'Compte fournisseur requis' } } } },
    '/api/partner/inventory/movements': { post: { summary: 'Enregistrer une réception, un ajustement ou un dommage sur une offre approuvée appartenant au fournisseur', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Mouvement enregistré' }, '403': { description: 'Compte fournisseur requis' }, '409': { description: 'Stock insuffisant ou conflit concurrent' } } } },
    '/api/admin/supplier-offers': { get: { summary: 'Toutes les offres et coûts fournisseurs (administrateur uniquement)', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Offres et fournisseur associé' }, '403': { description: 'Administrateur requis' } } } },
    '/api/admin/supplier-offers/{id}/status': { patch: { summary: 'Approuver ou refuser une offre fournisseur', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Offre mise à jour' }, '404': { description: 'Offre introuvable' } } } },
    '/api/admin/fitment-suggestions/{id}/review': { patch: { summary: 'Vérifier ou refuser une compatibilité proposée par un partenaire', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Compatibilité examinée' }, '409': { description: 'Offre ou données véhicule non vérifiées' } } } },
    '/api/admin/warehouses': { get: { summary: 'Lister les entrepôts (administrateur)', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Entrepôts et propriétaires' } } }, post: { summary: 'Créer un entrepôt (administrateur)', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Entrepôt créé' }, '409': { description: 'Code déjà utilisé' } } } },
    '/api/admin/stock': { get: { summary: 'Stocks par entrepôt et offre fournisseur, avec quantité disponible', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Stocks privés administrateur' } } } },
    '/api/admin/stock/movements': { get: { summary: 'Historique paginé des mouvements de stock', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Journal de mouvements' } } }, post: { summary: 'Enregistrer un mouvement stock dans une transaction sérialisable', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Mouvement enregistré' }, '409': { description: 'Stock insuffisant ou conflit concurrent' } } } },
    '/api/admin/catalog/imports/preview': { post: { summary: 'Prévisualiser un CSV catalogue sans créer de produits', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Prévisualisation et erreurs par ligne' }, '400': { description: 'Fichier invalide' }, '403': { description: 'Administrateur requis' } } } },
    '/api/admin/catalog/vehicles/imports/preview': { post: { summary: 'Prévisualiser un CSV de véhicules sans créer de pièces', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Prévisualisation des marques, modèles, générations et moteurs' }, '400': { description: 'Fichier invalide' }, '403': { description: 'Administrateur requis' } } } },
    '/api/admin/catalog/vehicles/imports/{id}/commit': { post: { summary: 'Importer les lignes véhicule valides dans le référentiel PostgreSQL', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Entrées importées avec rapport des rejets' }, '409': { description: 'Import déjà exécuté' } } } },
    '/api/admin/catalog/vehicles/contributions': { get: { summary: 'Lister les générations, moteurs et versions contributifs en attente de contrôle', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Entrées de véhicule et provenance déclarée' }, '403': { description: 'Administrateur requis' } } } },
    '/api/admin/catalog/vehicles/contributions/{generationId}/review': { patch: { summary: 'Vérifier ou écarter les données véhicule contributives', security: [{ bearerAuth: [] }], parameters: [{ name: 'generationId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Décision appliquée et journalisée' }, '400': { description: 'Source de vérification manquante ou invalide' }, '404': { description: 'Génération introuvable' }, '409': { description: 'Aucune contribution en attente' } } } },
    '/api/admin/catalog/imports': { get: { summary: 'Historique des imports catalogue', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Imports récents' } } } },
    '/api/admin/catalog/imports/{id}/commit': { post: { summary: 'Confirmer un import prévisualisé, une transaction par ligne valide', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Résultat et erreurs par ligne' }, '409': { description: 'Import déjà exécuté' } } } },
    '/api/catalog/vehicles/makes': { get: { summary: 'Marques vérifiées disponibles', responses: { '200': { description: 'Liste des marques' } } } },
    '/api/catalog/vehicles/models': { get: { summary: 'Modèles vérifiés pour makeId', parameters: [{ name: 'makeId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Liste des modèles' } } } },
    '/api/catalog/vehicles/generations': { get: { summary: 'Générations et intervalles d’années pour modelId', parameters: [{ name: 'modelId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Liste des générations' } } } },
    '/api/catalog/vehicles/engines': { get: { summary: 'Motorisations vérifiées pour generationId', parameters: [{ name: 'generationId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Liste des motorisations' } } } },
    '/api/catalog/vehicles/variants': { get: { summary: 'Versions, carrosseries et transmissions vérifiées pour generationId', parameters: [{ name: 'generationId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Liste des variantes' } } } },
    '/api/catalog/search': { get: { summary: 'Recherche par véhicule, nom, catégorie ou référence exacte. Les résultats véhicule exigent une compatibilité vérifiée.', parameters: ['makeId','modelId','generationId','engineId','variantId','year','reference','q','category','page','limit'].map((name) => ({ name, in: 'query', required: false, schema: { type: 'string' } })), responses: { '200': { description: 'Résultats paginés' }, '400': { description: 'Filtres invalides' } } } },
  },
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
};
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(JSON.stringify({ level: 'error', message: error instanceof Error ? error.message : 'Unknown error' }));
  res.status(500).json({ error: 'Erreur interne.' });
});

const server = app.listen(port, () => console.log(JSON.stringify({ level: 'info', message: 'API listening', port })));
if (!emailDelivery.enabled) console.log(JSON.stringify({ level: 'info', message: 'Service e-mail absent ou incomplet; les notifications restent disponibles dans l’application et les emails demeurent en attente.', emailDelivery: 'disabled', provider: emailDelivery.provider }));
const emailWorkerTimer = setInterval(() => { void deliverEmailOutbox(); }, 15_000);
emailWorkerTimer.unref();
if (emailDelivery.enabled) void deliverEmailOutbox();
const shutdown = async () => { clearInterval(emailWorkerTimer); server.close(); emailDelivery.close(); await prisma.$disconnect(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

