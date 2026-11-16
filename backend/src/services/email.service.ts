import { randomUUID } from 'crypto';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { enqueueEmails } from '../queues/email.queue';
import { ensureSenders } from './sender.service';
import { indexEmails } from './search.service';
import type { ScheduleInput } from '../validators/email.validators';
import type { EmailRow } from '../repositories/email.repository';

export function serializeEmail(e: EmailRow) {
  return {
    id: e.id, toEmail: e.toEmail, subject: e.subject, status: e.status, senderEmail: e.sender.email,
    scheduledAt: e.scheduledAt, sendAt: e.sendAt, sentAt: e.sentAt, attempts: e.attempts,
    rescheduleCount: e.rescheduleCount, lastError: e.lastError, messageId: e.messageId, previewUrl: e.previewUrl,
    createdAt: e.createdAt,
  };
}

/**
 * 1) Persist batch + emails in ONE transaction (PostgreSQL = source of truth).
 * 2) Then create one delayed BullMQ job per email (deterministic job ids).
 * If step 2 fails the rows still exist as 'scheduled' and startup recovery will enqueue them.
 */
export async function scheduleEmails(userId: string, input: ScheduleInput) {
  const recipients = [...new Set(input.recipients.map((r) => r.toLowerCase()))];
  const senders = await ensureSenders(userId);
  const batchId = randomUUID();
  const startMs = Math.max(input.startAt.getTime(), Date.now());
  const delayMs = input.delaySeconds * 1000;

  const rows = recipients.map((toEmail, i) => {
    const when = new Date(startMs + i * delayMs);
    return {
      id: randomUUID(), userId, batchId, senderId: senders[i % senders.length].id, toEmail,
      subject: input.subject, status: 'scheduled' as const, scheduledAt: when, sendAt: when,
    };
  });

  await prisma.$transaction([
    prisma.emailBatch.create({
      data: { id: batchId, userId, subject: input.subject, body: input.body, startAt: new Date(startMs), delaySeconds: input.delaySeconds, hourlyLimit: input.hourlyLimit, totalCount: rows.length },
    }),
    prisma.email.createMany({ data: rows }),
  ]);

  let queued = true;
  try { await enqueueEmails(rows); } catch (err) {
    queued = false;
    logger.error({ err: (err as Error).message, batchId }, 'Failed to enqueue jobs; startup recovery will restore them');
  }
  void indexEmails(rows.map((r) => r.id));

  return {
    batchId, total: rows.length, duplicatesRemoved: input.recipients.length - rows.length,
    firstSendAt: rows[0].sendAt, lastSendAt: rows[rows.length - 1].sendAt, senders: senders.map((s) => s.email),
    hourlyLimit: input.hourlyLimit, queued,
  };
}
