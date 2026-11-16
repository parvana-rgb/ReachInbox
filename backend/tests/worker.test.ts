import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Worker } from 'bullmq';
import { prisma } from '../src/config/prisma';
import { redis } from '../src/config/redis';
import { emailQueue, jobIdFor, enqueueEmails } from '../src/queues/email.queue';
import { createEmailWorker, claimEmail } from '../src/workers/email.worker';
import { scheduleEmails } from '../src/services/email.service';
import { recoverPendingEmails } from '../src/schedulers/recovery';
import { setSlackPoster } from '../src/integrations/slack';
import { setTransportFactory } from '../src/integrations/mailer';
import { encrypt } from '../src/utils/crypto';
import { makeUser, resetAll, useFakeEthereal, useFakeSmtp, waitFor } from './helpers';
import { windowStartOf, WINDOW_MS } from '../src/services/rateLimiter';

let worker: Worker | null = null;
const rcpts = (n: number, p = 'r') => Array.from({ length: n }, (_, i) => `${p}${i}@example.com`);
const base = { subject: 'Hello', body: 'Body text', delaySeconds: 0, hourlyLimit: 1000 };
const count = (status: string) => prisma.email.count({ where: { status: status as never } });

beforeEach(async () => { await resetAll(); useFakeEthereal(); });
afterEach(async () => { await worker?.close(); worker = null; setSlackPoster(null); setTransportFactory(null); });
afterAll(async () => { await emailQueue.close(); await prisma.$disconnect(); redis.disconnect(); });

describe('delivery', () => {
  it('sends every scheduled email exactly once and records status + SMTP metadata', async () => {
    const smtp = useFakeSmtp();
    const { user } = await makeUser();
    worker = createEmailWorker();
    await scheduleEmails(user.id, { ...base, recipients: rcpts(12), startAt: new Date() });
    await waitFor(async () => (await count('sent')) === 12);
    expect(smtp.sent).toHaveLength(12);
    expect(new Set(smtp.sent.map((s) => s.to)).size).toBe(12);
    const e = await prisma.email.findFirstOrThrow();
    expect(e.status).toBe('sent');
    expect(e.sentAt).toBeTruthy();
    expect(e.messageId).toContain('@reachinbox.local');
    expect(e.smtpResponse).toContain('250');
    expect(e.attempts).toBe(1);
  });

  it('spreads emails over both sender accounts (round-robin)', async () => {
    const smtp = useFakeSmtp();
    const { user } = await makeUser();
    worker = createEmailWorker();
    await scheduleEmails(user.id, { ...base, recipients: rcpts(6), startAt: new Date() });
    await waitFor(async () => (await count('sent')) === 6);
    expect(new Set(smtp.sent.map((s) => s.from)).size).toBe(2);
  });

  it('waits for the scheduled time (delayed job, no polling loop)', async () => {
    const smtp = useFakeSmtp();
    const { user } = await makeUser();
    worker = createEmailWorker();
    await scheduleEmails(user.id, { ...base, recipients: rcpts(2), delaySeconds: 2, startAt: new Date(Date.now() + 1500) });
    await new Promise((r) => setTimeout(r, 600));
    expect(smtp.sent).toHaveLength(0); // not yet
    expect(await emailQueue.getDelayedCount()).toBe(2);
    await waitFor(async () => (await count('sent')) === 2, 10000);
    expect(smtp.sent).toHaveLength(2);
  });

  it('SMTP failure: retries with backoff, then marks failed with the error; never fakes success', async () => {
    const smtp = useFakeSmtp({ failFor: (to) => to === 'bad@example.com' });
    const { user } = await makeUser();
    worker = createEmailWorker();
    await scheduleEmails(user.id, { ...base, recipients: ['bad@example.com', 'good@example.com'], startAt: new Date() });
    await waitFor(async () => (await count('failed')) === 1 && (await count('sent')) === 1);
    const bad = await prisma.email.findFirstOrThrow({ where: { toEmail: 'bad@example.com' } });
    expect(bad.status).toBe('failed');
    expect(bad.attempts).toBe(3);
    expect(bad.lastError).toContain('550');
    expect(smtp.attempts.filter((t) => t === 'bad@example.com')).toHaveLength(3);
    expect(smtp.sent.map((s) => s.to)).toEqual(['good@example.com']);
    // failed attempts gave their rate-limit slot back
    const keys = await redis.keys('rl:*');
    const used = (await Promise.all(keys.map((k) => redis.get(k)))).reduce((a, v) => a + Number(v), 0);
    expect(used).toBe(1);
  });

  it('a transient SMTP error is retried and then succeeds', async () => {
    let calls = 0;
    const smtp = useFakeSmtp({ failFor: () => ++calls === 1 });
    const { user } = await makeUser();
    worker = createEmailWorker();
    await scheduleEmails(user.id, { ...base, recipients: ['flaky@example.com'], startAt: new Date() });
    await waitFor(async () => (await count('sent')) === 1);
    expect(smtp.attempts).toHaveLength(2);
    expect((await prisma.email.findFirstOrThrow()).attempts).toBe(2);
  });
});

describe('hourly rate limit', () => {
  async function connectSlack(userId: string) {
    await prisma.slackIntegration.create({ data: { userId, teamId: 'T1', teamName: 'Acme', channelId: 'U123', botTokenEnc: encrypt('xoxb-test-token') } });
  }

  it('never exceeds the limit, defers the rest to the next hour (not dropped), alerts Slack once per sender', async () => {
    const smtp = useFakeSmtp();
    const posts: { token: string; channel: string; text: string }[] = [];
    setSlackPoster(async (token, channel, text) => { posts.push({ token, channel, text }); });
    const { user } = await makeUser();
    await connectSlack(user.id);
    worker = createEmailWorker();

    const res = await scheduleEmails(user.id, { ...base, recipients: rcpts(40), hourlyLimit: 5, startAt: new Date() });
    expect(res.senders).toHaveLength(2);
    // 2 senders x 5 per hour = 10 sent now; 30 deferred
    await waitFor(async () => (await count('sent')) === 10 && (await emailQueue.getDelayedCount()) === 30, 20000);
    await new Promise((r) => setTimeout(r, 500)); // let any (wrong) extra sends show up
    expect(await count('sent')).toBe(10);
    expect(smtp.sent).toHaveLength(10);

    const perSender = new Map<string, number>();
    smtp.sent.forEach((s) => perSender.set(s.from, (perSender.get(s.from) ?? 0) + 1));
    expect([...perSender.values()].every((v) => v === 5)).toBe(true);

    const nextHour = new Date(windowStartOf(Date.now()) + WINDOW_MS);
    const deferred = await prisma.email.findMany({ where: { status: 'scheduled' } });
    expect(deferred).toHaveLength(30); // nothing was discarded
    expect(deferred.every((e) => e.sendAt.getTime() === nextHour.getTime() && e.rescheduleCount >= 1)).toBe(true);

    // Slack: exactly one real message per (sender, window), with useful content
    const events = await prisma.rateLimitEvent.findMany();
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.notificationStatus === 'sent' && e.limit === 5)).toBe(true);
    expect(posts).toHaveLength(2);
    expect(posts[0].token).toBe('xoxb-test-token'); // decrypted before use
    expect(posts[0].channel).toBe('U123');
    expect(posts[0].text).toContain('hourly limit of 5');
    expect(posts[0].text).toContain(nextHour.toISOString());
  });

  it('keeps scheduling normally when Slack is not connected', async () => {
    useFakeSmtp();
    const { user } = await makeUser();
    worker = createEmailWorker();
    await scheduleEmails(user.id, { ...base, recipients: rcpts(6), hourlyLimit: 1, startAt: new Date() });
    await waitFor(async () => (await count('sent')) === 2 && (await emailQueue.getDelayedCount()) === 4);
    const events = await prisma.rateLimitEvent.findMany();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.notificationStatus === 'skipped_not_connected')).toBe(true);
  });

  it('a Slack outage does not break email delivery and is recorded', async () => {
    useFakeSmtp();
    setSlackPoster(async () => { throw new Error('channel_not_found'); });
    const { user } = await makeUser();
    await connectSlack(user.id);
    worker = createEmailWorker();
    await scheduleEmails(user.id, { ...base, recipients: rcpts(4), hourlyLimit: 1, startAt: new Date() });
    await waitFor(async () => (await count('sent')) === 2 && (await emailQueue.getDelayedCount()) === 2);
    const ev = await prisma.rateLimitEvent.findFirstOrThrow();
    expect(ev.notificationStatus).toBe('failed');
    expect(ev.notificationError).toContain('channel_not_found');
  });
});

describe('duplicate prevention', () => {
  it('only one of many concurrent claims wins', async () => {
    const { user } = await makeUser();
    await scheduleEmails(user.id, { ...base, recipients: ['one@example.com'], startAt: new Date(Date.now() + 3600_000) });
    const e = await prisma.email.findFirstOrThrow();
    const wins = await Promise.all(Array.from({ length: 25 }, () => claimEmail(e.id)));
    expect(wins.filter(Boolean)).toHaveLength(1);
  });

  it('adding the same email twice creates one job (deterministic id)', async () => {
    const { user } = await makeUser();
    await scheduleEmails(user.id, { ...base, recipients: ['one@example.com'], startAt: new Date(Date.now() + 3600_000) });
    const e = await prisma.email.findFirstOrThrow();
    await enqueueEmails([e, e, e]);
    expect(await emailQueue.getDelayedCount()).toBe(1);
    expect(await emailQueue.getJob(jobIdFor(e.id))).toBeTruthy();
  });

  it('two different jobs for the same email still send only once (DB claim)', async () => {
    const smtp = useFakeSmtp({ delayMs: 200 });
    const { user } = await makeUser();
    await scheduleEmails(user.id, { ...base, recipients: ['one@example.com'], startAt: new Date(Date.now() + 3600_000) });
    const e = await prisma.email.findFirstOrThrow();
    await emailQueue.add('send-email', { emailId: e.id }, { jobId: 'rogue-1' });
    await emailQueue.add('send-email', { emailId: e.id }, { jobId: 'rogue-2' });
    await emailQueue.add('send-email', { emailId: e.id }, { jobId: 'rogue-3' });
    worker = createEmailWorker();
    await waitFor(async () => (await count('sent')) === 1);
    await new Promise((r) => setTimeout(r, 600));
    expect(smtp.sent).toHaveLength(1);
  });

  it('duplicate recipients in one request are collapsed', async () => {
    const { user } = await makeUser();
    const r = await scheduleEmails(user.id, { ...base, recipients: ['a@x.com', 'A@x.com', 'b@x.com'], startAt: new Date(Date.now() + 3600_000) });
    expect(r.total).toBe(2);
    expect(r.duplicatesRemoved).toBe(1);
  });
});

describe('restart persistence + recovery', () => {
  it('jobs survive in Redis; recovery does not duplicate them; the new worker sends each email once', async () => {
    const smtp = useFakeSmtp();
    const { user } = await makeUser();
    await scheduleEmails(user.id, { ...base, recipients: rcpts(10), startAt: new Date(Date.now() + 1500), delaySeconds: 0 });
    expect(await emailQueue.getDelayedCount()).toBe(10);

    // "server restarts": nothing running -> recovery on boot
    const report = await recoverPendingEmails();
    expect(report.scanned).toBe(10);
    expect(report.alreadyQueued).toBe(10);
    expect(report.restored).toBe(0);
    expect(await emailQueue.getDelayedCount()).toBe(10); // no duplicates

    worker = createEmailWorker(); // new process picks up the same delayed jobs
    await waitFor(async () => (await count('sent')) === 10);
    expect(smtp.sent).toHaveLength(10);
  });

  it('restores jobs that were lost from Redis, keeping their original send time', async () => {
    const smtp = useFakeSmtp();
    const { user } = await makeUser();
    const startAt = new Date(Date.now() + 2000);
    await scheduleEmails(user.id, { ...base, recipients: rcpts(8), startAt, delaySeconds: 0 });
    await emailQueue.obliterate({ force: true }); // simulate Redis data loss
    expect(await emailQueue.getDelayedCount()).toBe(0);

    const report = await recoverPendingEmails();
    expect(report.restored).toBe(8);
    expect(await emailQueue.getDelayedCount()).toBe(8);
    const job = (await emailQueue.getDelayed())[0];
    expect(Math.abs(job.timestamp + (job.delay ?? 0) - startAt.getTime())).toBeLessThan(1500);

    worker = createEmailWorker();
    await waitFor(async () => (await count('sent')) === 8);
    expect(smtp.sent).toHaveLength(8);
  });

  it('never re-sends emails that were already sent, even if recovery runs again', async () => {
    const smtp = useFakeSmtp();
    const { user } = await makeUser();
    worker = createEmailWorker();
    await scheduleEmails(user.id, { ...base, recipients: rcpts(5), startAt: new Date() });
    await waitFor(async () => (await count('sent')) === 5);
    await worker.close(); worker = null;

    await emailQueue.obliterate({ force: true });
    const report = await recoverPendingEmails();
    expect(report.scanned).toBe(0);
    worker = createEmailWorker();
    await new Promise((r) => setTimeout(r, 800));
    expect(smtp.sent).toHaveLength(5);
  });

  it('restarting the worker mid-batch still delivers everything exactly once', async () => {
    const smtp = useFakeSmtp({ delayMs: 40 });
    const { user } = await makeUser();
    worker = createEmailWorker();
    await scheduleEmails(user.id, { ...base, recipients: rcpts(30), startAt: new Date() });
    await waitFor(async () => (await count('sent')) >= 5);
    await worker.close(); // graceful stop waits for in-flight jobs
    worker = createEmailWorker();
    await recoverPendingEmails();
    await waitFor(async () => (await count('sent')) === 30, 20000);
    expect(smtp.sent).toHaveLength(30);
    expect(new Set(smtp.sent.map((s) => s.to)).size).toBe(30);
  });

  it('resets rows abandoned in "processing" by a crashed worker and re-queues them', async () => {
    const smtp = useFakeSmtp();
    const { user } = await makeUser();
    await scheduleEmails(user.id, { ...base, recipients: ['crash@example.com'], startAt: new Date() });
    await emailQueue.obliterate({ force: true });
    await prisma.email.updateMany({ data: { status: 'processing', lockedAt: new Date(Date.now() - 10 * 60 * 1000) } });
    const report = await recoverPendingEmails();
    expect(report.staleReset).toBe(1);
    worker = createEmailWorker();
    await waitFor(async () => (await count('sent')) === 1);
    expect(smtp.sent).toHaveLength(1);
  });
});
