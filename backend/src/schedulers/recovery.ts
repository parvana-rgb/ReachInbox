import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { emailQueue, jobIdFor, toBulkJobs } from '../queues/email.queue';
import { STALE_LOCK_MS } from '../workers/email.worker';

export interface RecoveryReport { scanned: number; restored: number; alreadyQueued: number; staleReset: number }

/**
 * Startup recovery. PostgreSQL says what SHOULD be pending; Redis says what IS queued.
 * Because job ids are deterministic (email-<uuid>), re-adding is idempotent:
 *  - job still in Redis (delayed/waiting/active)  -> left alone (no duplicate, keeps original time)
 *  - job missing (Redis lost data, enqueue failed) -> re-created with the remaining delay
 *  - job exists but finished/failed while DB still says scheduled -> removed and re-created
 */
export async function recoverPendingEmails(): Promise<RecoveryReport> {
  const report: RecoveryReport = { scanned: 0, restored: 0, alreadyQueued: 0, staleReset: 0 };

  const stale = await prisma.email.updateMany({
    where: { status: 'processing', lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
    data: { status: 'scheduled', lockedAt: null, indexDirty: true },
  });
  report.staleReset = stale.count;

  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.email.findMany({
      where: { status: { in: ['scheduled', 'processing'] } },
      select: { id: true, sendAt: true, status: true },
      orderBy: { id: 'asc' }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;
    report.scanned += rows.length;

    const missing: typeof rows = [];
    await Promise.all(rows.map(async (r) => {
      const job = await emailQueue.getJob(jobIdFor(r.id));
      if (!job) { missing.push(r); return; }
      const state = await job.getState();
      if (r.status === 'scheduled' && (state === 'completed' || state === 'failed')) {
        await job.remove().catch(() => undefined);
        missing.push(r);
      } else report.alreadyQueued++;
    }));
    if (missing.length) {
      await emailQueue.addBulk(toBulkJobs(missing));
      report.restored += missing.length;
    }
  }
  logger.info(report, 'Startup recovery finished');
  return report;
}
