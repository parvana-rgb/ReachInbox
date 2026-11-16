import type { EmailStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

const include = { sender: { select: { email: true } } } satisfies Prisma.EmailInclude;
export type EmailRow = Prisma.EmailGetPayload<{ include: typeof include }>;

export interface ListParams {
  userId: string;
  statuses?: EmailStatus[];
  q?: string;
  page: number;
  pageSize: number;
  order: 'sendAtAsc' | 'sendAtDesc' | 'recentActivity';
}

export async function listEmails(p: ListParams): Promise<{ items: EmailRow[]; total: number; page: number; pageSize: number }> {
  const where: Prisma.EmailWhereInput = {
    userId: p.userId,
    ...(p.statuses ? { status: { in: p.statuses } } : {}),
    ...(p.q ? { OR: [{ toEmail: { contains: p.q, mode: 'insensitive' } }, { subject: { contains: p.q, mode: 'insensitive' } }] } : {}),
  };
  const orderBy: Prisma.EmailOrderByWithRelationInput[] =
    p.order === 'sendAtAsc' ? [{ sendAt: 'asc' }, { id: 'asc' }]
    : p.order === 'sendAtDesc' ? [{ sendAt: 'desc' }, { id: 'asc' }]
    : [{ updatedAt: 'desc' }, { id: 'asc' }];
  const [items, total] = await prisma.$transaction([
    prisma.email.findMany({ where, orderBy, skip: (p.page - 1) * p.pageSize, take: p.pageSize, include }),
    prisma.email.count({ where }),
  ]);
  return { items, total, page: p.page, pageSize: p.pageSize };
}

export const findEmailForUser = (userId: string, id: string) =>
  prisma.email.findFirst({ where: { id, userId }, include: { ...include, batch: { select: { body: true, hourlyLimit: true, delaySeconds: true } } } });

export async function statusCounts(userId: string): Promise<Record<EmailStatus, number>> {
  const rows = await prisma.email.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } });
  const out: Record<EmailStatus, number> = { scheduled: 0, processing: 0, sent: 0, failed: 0 };
  for (const r of rows) out[r.status] = r._count._all;
  return out;
}
