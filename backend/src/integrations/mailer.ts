import nodemailer, { type Transporter } from 'nodemailer';

export interface SmtpConfig { host: string; port: number; secure: boolean; user: string; pass: string }
export interface OutgoingMail { from: string; to: string; subject: string; text: string; messageId: string }
export interface SendResult { messageId: string; previewUrl: string | null; response: string }

type TransportFactory = (cfg: SmtpConfig) => Pick<Transporter, 'sendMail'>;

const defaultFactory: TransportFactory = (cfg) =>
  nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });

let factory: TransportFactory = defaultFactory;
const cache = new Map<string, Pick<Transporter, 'sendMail'>>();

/** Tests inject a fake transport here. Pass null to restore the real SMTP transport. */
export function setTransportFactory(f: TransportFactory | null) {
  factory = f ?? defaultFactory;
  cache.clear();
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Sends one message. Throws if the SMTP server rejects it - we never report success unless SMTP accepted it.
 */
export async function sendMail(cfg: SmtpConfig, mail: OutgoingMail): Promise<SendResult> {
  const key = `${cfg.host}:${cfg.port}:${cfg.user}`;
  let transport = cache.get(key);
  if (!transport) { transport = factory(cfg); cache.set(key, transport); }

  const info = await transport.sendMail({
    from: mail.from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(mail.text)}</div>`,
    messageId: mail.messageId,
  });

  const rejected = (info.rejected ?? []) as unknown[];
  const accepted = info.accepted as unknown[] | undefined;
  if (rejected.length > 0 || (accepted && accepted.length === 0)) {
    throw new Error(`SMTP rejected recipient: ${info.response ?? 'no response'}`);
  }
  const preview = nodemailer.getTestMessageUrl(info);
  return {
    messageId: String(info.messageId ?? mail.messageId),
    previewUrl: preview ? String(preview) : null,
    response: String(info.response ?? ''),
  };
}
