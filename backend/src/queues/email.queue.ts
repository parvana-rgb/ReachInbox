import { Queue } from 'bullmq';
import { bullConnection } from '../config/redis';
import { env } from '../config/env';

export const EMAIL_QUEUE = 'email-queue';
export interface EmailJobData { emailId: string }

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE, {
  connection: bullConnection,
  prefix: env.BULLMQ_PREFIX,
  defaultJobOptions: {
    attempts: env.EMAIL_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: env.EMAIL_BACKOFF_MS },
    removeOnComplete: { age: 24 * 3600, count: 5000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

/** Deterministic id => adding the same email twice is a no-op in BullMQ. (':' is not allowed in ids.) */
export const jobIdFor = (emailId: string) => `email-${emailId}`;

export interface Enqueueable { id: string; sendAt: Date }

export function toBulkJobs(emails: Enqueueable[], nowMs = Date.now()) {
  return emails.map((e) => ({
    name: 'send-email',
    data: { emailId: e.id },
    opts: { jobId: jobIdFor(e.id), delay: Math.max(0, e.sendAt.getTime() - nowMs) },
  }));
}

export async function enqueueEmails(emails: Enqueueable[]) {
  if (!emails.length) return;
  for (let i = 0; i < emails.length; i += 500) {
    await emailQueue.addBulk(toBulkJobs(emails.slice(i, i + 500)));
  }
}
