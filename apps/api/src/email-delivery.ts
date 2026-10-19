import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import type { SendMailOptions } from 'nodemailer';

export type EmailAttachment = { filename: string; content: Buffer; contentType: string };
export type EmailMessage = Pick<SendMailOptions, 'to' | 'subject' | 'text' | 'html' | 'messageId'> & { attachments: EmailAttachment[] };

const cleanHeader = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();
const base64Lines = (value: Buffer | string) => Buffer.from(value).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';

const gmailMimeMessage = (message: EmailMessage, from: string) => {
  const mixedBoundary = `ghorbel_mixed_${randomUUID().replaceAll('-', '')}`;
  const alternativeBoundary = `ghorbel_alt_${randomUUID().replaceAll('-', '')}`;
  const subject = `=?UTF-8?B?${Buffer.from(cleanHeader(String(message.subject ?? '')), 'utf8').toString('base64')}?=`;
  const lines = [
    `From: ${cleanHeader(from)}`,
    `To: ${cleanHeader(String(message.to ?? ''))}`,
    `Subject: ${subject}`,
    ...(message.messageId ? [`Message-ID: ${cleanHeader(message.messageId)}`] : []),
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    '',
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(String(message.text ?? '')),
    `--${alternativeBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(String(message.html ?? '')),
    `--${alternativeBoundary}--`,
  ];
  for (const attachment of message.attachments) {
    const filename = attachment.filename.replace(/[\r\n"\\]/g, '_');
    lines.push(
      `--${mixedBoundary}`,
      `Content-Type: ${cleanHeader(attachment.contentType)}; name="${filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${filename}"`,
      '',
      base64Lines(attachment.content),
    );
  }
  lines.push(`--${mixedBoundary}--`, '');
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
};

export function createEmailDelivery(env: NodeJS.ProcessEnv = process.env) {
  const smtpFrom = env.EMAIL_FROM?.trim() || env.SMTP_FROM?.trim() || '';
  const provider = (env.EMAIL_PROVIDER?.trim().toLowerCase() || (env.SMTP_HOST && env.SMTP_FROM ? 'smtp' : 'disabled'));
  const smtpTransport = provider === 'smtp' && env.SMTP_HOST && smtpFrom ? nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT ?? 587),
    secure: env.SMTP_SECURE === 'true',
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: (env.SMTP_PASSWORD ?? '').replace(/\s/g, '') } } : {}),
    connectionTimeout: 10_000,
    socketTimeout: 20_000,
  }) : null;
  const gmailConfigured = provider === 'gmail-api' && Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN && smtpFrom);
  let cachedAccessToken: { value: string; expiresAt: number } | null = null;

  const getGmailAccessToken = async () => {
    if (!gmailConfigured) throw new Error('Configuration Gmail API incomplète.');
    if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) return cachedAccessToken.value;
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GMAIL_CLIENT_ID!,
        client_secret: env.GMAIL_CLIENT_SECRET!,
        refresh_token: env.GMAIL_REFRESH_TOKEN!,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
    if (!response.ok || !payload.access_token) throw new Error(`Gmail OAuth token error (${response.status}): ${payload.error_description ?? payload.error ?? 'jeton absent'}`);
    cachedAccessToken = { value: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000 };
    return cachedAccessToken.value;
  };

  const sendViaGmailApi = async (message: EmailMessage) => {
    const accessToken = await getGmailAccessToken();
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: gmailMimeMessage(message, smtpFrom) }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      const details = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(`Gmail API send error (${response.status}): ${details.error?.message ?? 'envoi refusé'}`);
    }
  };

  return {
    provider,
    enabled: Boolean(smtpTransport || gmailConfigured),
    close() { smtpTransport?.close(); },
    async send(message: EmailMessage) {
      if (smtpTransport) {
        await smtpTransport.sendMail({ ...message, from: smtpFrom });
        return;
      }
      if (gmailConfigured) {
        await sendViaGmailApi(message);
        return;
      }
      throw new Error(`Service e-mail non configuré (provider=${provider}).`);
    },
  };
}
