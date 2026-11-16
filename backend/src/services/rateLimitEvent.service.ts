import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { decrypt } from '../utils/crypto';
import { postMessage } from '../integrations/slack';

export interface RateLimitInfo {
  userId: string; senderId: string; senderEmail: string; limit: number; windowStart: number; nextWindowStart: number;
}

/**
 * Records "sender X hit its hourly limit in window W" and notifies Slack - exactly once per (sender, window).
 * The UNIQUE(senderId, windowStart) constraint is the dedupe: only the worker whose INSERT succeeds sends the alert.
 * Never throws (a Slack problem must not affect email delivery).
 */
export async function recordRateLimit(info: RateLimitInfo): Promise<{ created: boolean }> {
  let eventId: string;
  try {
    const ev = await prisma.rateLimitEvent.create({
      data: { userId: info.userId, senderId: info.senderId, windowStart: new Date(info.windowStart), limit: info.limit, nextAvailableAt: new Date(info.nextWindowStart) },
    });
    eventId = ev.id;
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return { created: false }; // already recorded + notified by another worker
    logger.error({ err: (err as Error).message }, 'Failed to record rate limit event');
    return { created: false };
  }

  try {
    const integ = await prisma.slackIntegration.findUnique({ where: { userId: info.userId } });
    if (!integ) {
      await prisma.rateLimitEvent.update({ where: { id: eventId }, data: { notificationStatus: 'skipped_not_connected' } });
      return { created: true };
    }
    const nextTs = Math.floor(info.nextWindowStart / 1000);
    const nextTxt = `<!date^${nextTs}^{date_short_pretty} at {time}|${new Date(info.nextWindowStart).toISOString()}>`;
    const text = `ReachInbox: sender ${info.senderEmail} reached its hourly limit of ${info.limit} emails. Remaining emails continue at ${new Date(info.nextWindowStart).toISOString()}.`;
    const blocks = [
      { type: 'header', text: { type: 'plain_text', text: 'Hourly sending limit reached' } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*Sender*\n${info.senderEmail}` },
        { type: 'mrkdwn', text: `*Limit*\n${info.limit} emails / hour` },
        { type: 'mrkdwn', text: `*Sending resumes*\n${nextTxt}` },
      ] },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'Queued emails are not lost. They are automatically rescheduled into the next hour.' }] },
    ];
    await postMessage(decrypt(integ.botTokenEnc), integ.channelId, text, blocks);
    await prisma.rateLimitEvent.update({ where: { id: eventId }, data: { notificationStatus: 'sent', notifiedAt: new Date() } });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Slack notification failed');
    await prisma.rateLimitEvent.update({ where: { id: eventId }, data: { notificationStatus: 'failed', notificationError: String((err as Error).message).slice(0, 500) } }).catch(() => undefined);
  }
  return { created: true };
}
