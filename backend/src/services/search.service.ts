import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { ensureIndex, esEnabled, getEs, ES_INDEX } from '../integrations/elasticsearch';
import { listEmails, type EmailRow } from '../repositories/email.repository';
import type { EmailStatus } from '@prisma/client';

const rowInclude = { sender: { select: { email: true } }, batch: { select: { body: true } } } as const;

function toDoc(e: EmailRow & { batch: { body: string } }) {
  return {
    id: e.id, userId: e.userId, batchId: e.batchId, status: e.status, toEmail: e.toEmail,
    senderEmail: e.sender.email, subject: e.subject, body: e.batch.body, lastError: e.lastError,
    scheduledAt: e.scheduledAt, sendAt: e.sendAt, sentAt: e.sentAt, createdAt: e.createdAt,
  };
}

/**
 * Pushes the current DB state of the given emails to Elasticsearch.
 * NEVER throws: failures leave indexDirty=true so the startup sweep / reindex endpoint retries them.
 */
export async function indexEmails(ids: string[]): Promise<void> {
  if (!esEnabled() || ids.length === 0) return;
  try {
    await ensureIndex();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const rows = await prisma.email.findMany({ where: { id: { in: chunk } }, include: rowInclude });
      if (!rows.length) continue;
      const res = await getEs().bulk({
        refresh: false,
        operations: rows.flatMap((r) => [{ index: { _index: ES_INDEX, _id: r.id } }, toDoc(r)]),
      });
      const okIds = new Set<string>();
      res.items.forEach((it, idx) => { if (!it.index?.error) okIds.add(rows[idx].id); });
      if (res.errors) logger.warn({ failed: rows.length - okIds.size }, 'Some documents failed to index');
      // Only clear the dirty flag if the row did not change while we were indexing.
      await Promise.all(rows.filter((r) => okIds.has(r.id)).map((r) =>
        prisma.email.updateMany({ where: { id: r.id, updatedAt: r.updatedAt }, data: { indexDirty: false } })));
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Elasticsearch indexing failed; will retry on next sweep');
  }
}

/** Startup sweep: index everything flagged dirty. Returns how many rows were attempted. */
export async function reindexDirty(userId?: string, batchSize = 500): Promise<number> {
  if (!esEnabled()) return 0;
  let total = 0;
  for (;;) {
    const rows = await prisma.email.findMany({ where: { indexDirty: true, ...(userId ? { userId } : {}) }, select: { id: true }, take: batchSize });
    if (!rows.length) break;
    await indexEmails(rows.map((r) => r.id));
    total += rows.length;
    const still = await prisma.email.count({ where: { id: { in: rows.map((r) => r.id) }, indexDirty: true } });
    if (still > 0) break; // ES is failing, don't loop forever
  }
  return total;
}

export interface SearchParams { userId: string; q?: string; status?: EmailStatus; page: number; pageSize: number }
export interface SearchResult { items: EmailRow[]; total: number; page: number; pageSize: number; source: 'elasticsearch' | 'database' }

const escapeWildcard = (s: string) => s.replace(/[\\*?]/g, '\\$&');

export function buildEsQuery(p: SearchParams) {
  const filter: object[] = [{ term: { userId: p.userId } }]; // tenant isolation: ALWAYS filtered by owner
  if (p.status) filter.push({ term: { status: p.status } });
  const q = p.q?.trim();
  const must = q
    ? [{
        bool: {
          minimum_should_match: 1,
          should: [
            { multi_match: { query: q, fields: ['toEmail^3', 'subject^2', 'body', 'senderEmail', 'lastError'], fuzziness: 'AUTO' } },
            { wildcard: { 'toEmail.keyword': { value: `*${escapeWildcard(q.toLowerCase())}*` } } },
          ],
        },
      }]
    : [];
  return { bool: { filter, must } };
}

export async function searchEmails(p: SearchParams): Promise<SearchResult> {
  if (esEnabled()) {
    try {
      await ensureIndex();
      const res = await getEs().search({
        index: ES_INDEX,
        from: (p.page - 1) * p.pageSize,
        size: p.pageSize,
        query: buildEsQuery(p),
        sort: p.q ? ['_score', { sendAt: 'desc' as const }] : [{ sendAt: 'desc' as const }],
        track_total_hits: true,
      });
      const ids = res.hits.hits.map((h) => String(h._id));
      // Hydrate from PostgreSQL (source of truth) and re-check ownership.
      const rows = await prisma.email.findMany({ where: { id: { in: ids }, userId: p.userId }, include: { sender: { select: { email: true } } } });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const total = typeof res.hits.total === 'number' ? res.hits.total : res.hits.total?.value ?? ids.length;
      return { items: ids.map((id) => byId.get(id)).filter((r): r is EmailRow => Boolean(r)), total, page: p.page, pageSize: p.pageSize, source: 'elasticsearch' };
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Elasticsearch search failed, falling back to database');
    }
  }
  const r = await listEmails({ userId: p.userId, statuses: p.status ? [p.status] : undefined, q: p.q, page: p.page, pageSize: p.pageSize, order: 'sendAtDesc' });
  return { ...r, source: 'database' };
}
