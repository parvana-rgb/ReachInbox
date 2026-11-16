import { randomUUID } from 'crypto';
import { prisma } from '../src/config/prisma';
import { redis } from '../src/config/redis';
import { emailQueue } from '../src/queues/email.queue';
import { createSession } from '../src/services/session.service';
import { setAccountFactory } from '../src/services/sender.service';
import { setTransportFactory } from '../src/integrations/mailer';

export async function resetAll() {
  await prisma.rateLimitEvent.deleteMany();
  await prisma.email.deleteMany();
  await prisma.emailBatch.deleteMany();
  await prisma.slackIntegration.deleteMany();
  await prisma.sender.deleteMany();
  await prisma.user.deleteMany();
  await emailQueue.obliterate({ force: true }).catch(() => undefined);
  await redis.flushdb();
}

export async function makeUser(label = 'a') {
  const u = await prisma.user.create({ data: { googleId: `g-${randomUUID()}`, email: `${label}-${randomUUID().slice(0, 6)}@example.com`, name: `User ${label}` } });
  const sid = await createSession(u.id);
  return { user: u, cookie: `rib_session=${sid}` };
}

let n = 0;
export function useFakeEthereal() {
  setAccountFactory(async () => { n++; return { user: `sender${n}@ethereal.test`, pass: 'pw', host: 'smtp.test', port: 587, secure: false, name: `Sender ${n}` }; });
}

export interface Sent { to: string; from: string; messageId: string }
/** Fake SMTP server. failFor: recipients that should be rejected. */
export function useFakeSmtp(opts: { failFor?: (to: string) => boolean; delayMs?: number } = {}) {
  const sent: Sent[] = [];
  const attempts: string[] = [];
  setTransportFactory(() => ({
    sendMail: (async (m: { to: string; from: string; messageId: string }) => {
      attempts.push(m.to);
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.failFor?.(m.to)) throw new Error('550 Mailbox unavailable');
      sent.push({ to: m.to, from: m.from, messageId: m.messageId });
      return { messageId: m.messageId, accepted: [m.to], rejected: [], response: '250 OK: queued as TEST' };
    }) as never,
  }));
  return { sent, attempts };
}

export async function waitFor<T>(fn: () => Promise<T | false | null | undefined>, timeoutMs = 15000, everyMs = 100): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
