import nodemailer from 'nodemailer';
import { prisma } from '../config/prisma';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { encrypt, decrypt } from '../utils/crypto';
import { unavailable } from '../utils/errors';
import type { Sender } from '@prisma/client';
import type { SmtpConfig } from '../integrations/mailer';

export interface NewAccount { user: string; pass: string; host: string; port: number; secure: boolean; name?: string }
export type AccountFactory = () => Promise<NewAccount>;

const defaultFactory: AccountFactory = async () => {
  const a = await nodemailer.createTestAccount(); // calls Ethereal's API, returns a fresh SMTP mailbox
  return { user: a.user, pass: a.pass, host: a.smtp.host, port: a.smtp.port, secure: a.smtp.secure, name: 'Ethereal Sender' };
};
let factory: AccountFactory = defaultFactory;
/** Tests inject a fake account factory so no network call is made. */
export const setAccountFactory = (f: AccountFactory | null) => { factory = f ?? defaultFactory; };

const toRow = (userId: string, a: NewAccount) => ({
  userId, email: a.user, name: a.name ?? a.user, smtpHost: a.host, smtpPort: a.port,
  smtpSecure: a.secure, smtpUser: a.user, smtpPassEnc: encrypt(a.pass),
});

async function withLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const k = `lock:senders:${userId}`;
  for (let i = 0; i < 60; i++) {
    if (await redis.set(k, '1', 'PX', 30_000, 'NX')) {
      try { return await fn(); } finally { await redis.del(k); }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw unavailable('Sender setup is busy, please retry');
}

/** Makes sure the user has SENDER_COUNT active sender accounts (creating Ethereal accounts if needed). */
export async function ensureSenders(userId: string): Promise<Sender[]> {
  const load = () => prisma.sender.findMany({ where: { userId, isActive: true }, orderBy: { createdAt: 'asc' } });
  let senders = await load();
  if (senders.length >= env.SENDER_COUNT) return senders.slice(0, env.SENDER_COUNT);

  return withLock(userId, async () => {
    senders = await load();
    if (env.ETHEREAL_USER && env.ETHEREAL_PASS && !senders.some((s) => s.smtpUser === env.ETHEREAL_USER)) {
      await prisma.sender.create({
        data: toRow(userId, { user: env.ETHEREAL_USER, pass: env.ETHEREAL_PASS, host: env.ETHEREAL_HOST, port: env.ETHEREAL_PORT, secure: false, name: 'Configured Ethereal Sender' }),
      });
      senders = await load();
    }
    while (senders.length < env.SENDER_COUNT) {
      let acc: NewAccount;
      try { acc = await factory(); } catch (e) {
        if (senders.length > 0) break; // work with what we have
        throw unavailable(`Could not create an Ethereal sender account: ${(e as Error).message}`);
      }
      await prisma.sender.create({ data: toRow(userId, acc) });
      senders = await load();
    }
    return senders;
  });
}

export const smtpConfigOf = (s: Sender): SmtpConfig => ({
  host: s.smtpHost, port: s.smtpPort, secure: s.smtpSecure, user: s.smtpUser, pass: decrypt(s.smtpPassEnc),
});
