import type { Request, Response } from 'express';
import { statusCounts } from '../repositories/email.repository';
import { prisma } from '../config/prisma';
import { emailQueue } from '../queues/email.queue';

export async function stats(req: Request, res: Response) {
  const c = await statusCounts(req.user!.id);
  res.json({ total: c.scheduled + c.processing + c.sent + c.failed, pending: c.scheduled + c.processing, scheduled: c.scheduled, processing: c.processing, sent: c.sent, failed: c.failed });
}

export async function queueStats(_req: Request, res: Response) {
  const counts = await emailQueue.getJobCounts('waiting', 'delayed', 'active', 'completed', 'failed');
  res.json({ queue: emailQueue.name, counts });
}

export async function rateLimitEvents(req: Request, res: Response) {
  const items = await prisma.rateLimitEvent.findMany({
    where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 20, include: { sender: { select: { email: true } } },
  });
  res.json({ items: items.map((e) => ({ id: e.id, senderEmail: e.sender.email, limit: e.limit, windowStart: e.windowStart, nextAvailableAt: e.nextAvailableAt, notificationStatus: e.notificationStatus, createdAt: e.createdAt })) });
}
