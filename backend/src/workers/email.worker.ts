import { Worker, DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { prisma } from '../config/prisma';
import { redis, bullConnection } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { EMAIL_QUEUE, type EmailJobData } from '../queues/email.queue';
import { takeSlot, refundSlot } from '../services/rateLimiter';
import { sendMail } from '../integrations/mailer';
import { smtpConfigOf } from '../services/sender.service';
import { indexEmails } from '../services/search.service';
import { recordRateLimit } from '../services/rateLimitEvent.service';

/** A 'processing' row older than this is considered abandoned by a crashed worker. */
export const STALE_LOCK_MS = 5 * 60 * 1000;

/**
 * Idempotency gate #2 (gate #1 is the deterministic BullMQ job id).
 * One atomic UPDATE decides which worker owns the email. If count === 0 somebody else has it
 * (or it is already sent/failed) and we skip. Two workers can never both pass this.
 */
export async function claimEmail(emailId: string): Promise<boolean> {
  const r = await prisma.email.updateMany({
    where: {
      id: emailId,
      OR: [{ status: 'scheduled' }, { status: 'processing', lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } }],
    },
    data: { status: 'processing', lockedAt: new Date(), indexDirty: true },
  });
  return r.count === 1;
}

const trim = (s: string) => s.slice(0, 500);

export async function processEmailJob(job: Job<EmailJobData>, token?: string): Promise<{ result: string }> {
  const { emailId } = job.data;
  if (!(await claimEmail(emailId))) return { result: 'skipped' };

  const email = await prisma.email.findUnique({ where: { id: emailId }, include: { sender: true, batch: true } });
  if (!email) throw new UnrecoverableError('Email row no longer exists');
  if (!email.sender.isActive) {
    await prisma.email.update({ where: { id: emailId }, data: { status: 'failed', lockedAt: null, lastError: 'Sender account is disabled', indexDirty: true } });
    await indexEmails([emailId]);
    throw new UnrecoverableError('Sender disabled');
  }

  // ---- Hourly rate limit (atomic, Redis Lua) ----
  const decision = await takeSlot(redis, email.senderId, email.batch.hourlyLimit);
  if (!decision.allowed) {
    await prisma.email.update({
      where: { id: emailId },
      data: { status: 'scheduled', lockedAt: null, sendAt: new Date(decision.nextWindowStart), rescheduleCount: { increment: 1 }, indexDirty: true },
    });
    await recordRateLimit({
      userId: email.userId, senderId: email.senderId, senderEmail: email.sender.email, limit: decision.limit,
      windowStart: decision.windowStart, nextWindowStart: decision.nextWindowStart,
    });
    await indexEmails([emailId]);
    await job.moveToDelayed(decision.nextWindowStart, token);
    throw new DelayedError(); // tells BullMQ "I already moved this job"; it does NOT count as a failed attempt
  }

  // ---- SMTP ----
  try {
    const res = await sendMail(smtpConfigOf(email.sender), {
      from: `"${email.sender.name.replace(/"/g, '')}" <${email.sender.email}>`,
      to: email.toEmail,
      subject: email.subject,
      text: email.batch.body,
      messageId: `<${email.id}@reachinbox.local>`, // stable per email => receivers/SMTP can detect duplicates
    });
    for (let i = 0; ; i++) {
      try {
        await prisma.email.update({
          where: { id: emailId },
          data: { status: 'sent', sentAt: new Date(), lockedAt: null, attempts: { increment: 1 }, lastError: null, messageId: res.messageId, previewUrl: res.previewUrl, smtpResponse: trim(res.response), indexDirty: true },
        });
        break;
      } catch (dbErr) { if (i >= 2) throw dbErr; await new Promise((r) => setTimeout(r, 200 * (i + 1))); }
    }
    await indexEmails([emailId]);
    return { result: 'sent' };
  } catch (err) {
    await refundSlot(redis, email.senderId, decision.windowStart); // nothing was delivered, give the slot back
    const msg = trim((err as Error).message);
    const finalAttempt = email.attempts + 1 >= env.EMAIL_MAX_ATTEMPTS;
    await prisma.email.update({
      where: { id: emailId },
      data: { status: finalAttempt ? 'failed' : 'scheduled', lockedAt: null, attempts: { increment: 1 }, lastError: msg, indexDirty: true },
    });
    await indexEmails([emailId]);
    throw err; // BullMQ applies exponential backoff and retries (unless it was the last attempt)
  }
}

export function createEmailWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(EMAIL_QUEUE, processEmailJob, {
    connection: bullConnection,
    prefix: env.BULLMQ_PREFIX,
    concurrency: env.WORKER_CONCURRENCY,
    lockDuration: 60_000,
  });
  worker.on('failed', async (job, err) => {
    logger.warn({ jobId: job?.id, err: err.message }, 'email job failed');
    // Safety net: if BullMQ gave up on the job, make sure the DB doesn't keep it 'scheduled'.
    if (job && (job.attemptsMade >= (job.opts.attempts ?? 1) || err instanceof UnrecoverableError)) {
      await prisma.email.updateMany({
        where: { id: job.data.emailId, status: { in: ['scheduled', 'processing'] } },
        data: { status: 'failed', lockedAt: null, lastError: trim(err.message), indexDirty: true },
      }).catch(() => undefined);
      await indexEmails([job.data.emailId]);
    }
  });
  worker.on('error', (err) => logger.error({ err: err.message }, 'worker error'));
  return worker;
}
