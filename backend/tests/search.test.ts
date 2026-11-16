import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// A fake Elasticsearch client records calls. This verifies OUR indexing/search logic;
// it does not prove a real cluster accepts the mapping (see README "Known limitations").
const state = vi.hoisted(() => ({ bulkCalls: [] as any[], searchCalls: [] as any[], failBulk: false, failSearch: false, hits: [] as string[] }));
vi.mock('../src/integrations/elasticsearch', () => ({
  ES_INDEX: 'test-emails',
  esEnabled: () => true,
  ensureIndex: async () => undefined,
  resetIndexReady: () => undefined,
  setEsClient: () => undefined,
  getEs: () => ({
    bulk: async (req: any) => {
      if (state.failBulk) throw new Error('connect ECONNREFUSED');
      state.bulkCalls.push(req);
      return { errors: false, items: req.operations.filter((_: any, i: number) => i % 2 === 0).map(() => ({ index: { status: 201 } })) };
    },
    search: async (req: any) => {
      if (state.failSearch) throw new Error('cluster down');
      state.searchCalls.push(req);
      return { hits: { total: { value: state.hits.length }, hits: state.hits.map((id) => ({ _id: id })) } };
    },
  }),
}));

import { prisma } from '../src/config/prisma';
import { redis } from '../src/config/redis';
import { emailQueue } from '../src/queues/email.queue';
import { indexEmails, reindexDirty, searchEmails } from '../src/services/search.service';
import { scheduleEmails } from '../src/services/email.service';
import { makeUser, resetAll, useFakeEthereal } from './helpers';

beforeEach(async () => { await resetAll(); useFakeEthereal(); Object.assign(state, { bulkCalls: [], searchCalls: [], failBulk: false, failSearch: false, hits: [] }); });
afterAll(async () => { await emailQueue.close(); await prisma.$disconnect(); redis.disconnect(); });

const sched = (userId: string, n = 3) => scheduleEmails(userId, { subject: 'Pricing', body: 'Long body text', recipients: Array.from({ length: n }, (_, i) => `u${i}@x.com`), startAt: new Date(Date.now() + 3600_000), delaySeconds: 1, hourlyLimit: 10 });

describe('Elasticsearch indexing', () => {
  it('indexes scheduled emails with the owner id and clears the dirty flag', async () => {
    const { user } = await makeUser();
    await sched(user.id);
    await vi.waitFor(async () => expect(await prisma.email.count({ where: { indexDirty: true } })).toBe(0));
    const docs = state.bulkCalls.flatMap((c) => c.operations.filter((_: any, i: number) => i % 2 === 1));
    expect(docs).toHaveLength(3);
    expect(docs.every((d: any) => d.userId === user.id && d.status === 'scheduled' && d.body === 'Long body text')).toBe(true);
  });

  it('re-indexes a document when its status changes (same _id => update in place)', async () => {
    const { user } = await makeUser();
    await sched(user.id, 1);
    await vi.waitFor(async () => expect(state.bulkCalls.length).toBe(1));
    const e = await prisma.email.findFirstOrThrow();
    await prisma.email.update({ where: { id: e.id }, data: { status: 'sent', sentAt: new Date(), indexDirty: true } });
    await indexEmails([e.id]);
    const last = state.bulkCalls.at(-1);
    expect(last.operations[0].index._id).toBe(e.id);
    expect(last.operations[1].status).toBe('sent');
  });

  it('an indexing failure never loses the DB record; rows stay dirty and a later sweep fixes them', async () => {
    state.failBulk = true;
    const { user } = await makeUser();
    await sched(user.id);
    await new Promise((r) => setTimeout(r, 300));
    expect(await prisma.email.count()).toBe(3);
    expect(await prisma.email.count({ where: { indexDirty: true } })).toBe(3);
    state.failBulk = false;
    await reindexDirty();
    expect(await prisma.email.count({ where: { indexDirty: true } })).toBe(0);
  });
});

describe('Elasticsearch search', () => {
  it('queries with the owner filter and hydrates results from PostgreSQL', async () => {
    const A = await makeUser('a'); const B = await makeUser('b');
    await sched(A.user.id, 2); await sched(B.user.id, 2);
    const mine = await prisma.email.findMany({ where: { userId: A.user.id }, orderBy: { toEmail: 'asc' } });
    // even if ES (wrongly) returned someone else's id, hydration re-checks ownership
    const theirs = await prisma.email.findFirstOrThrow({ where: { userId: B.user.id } });
    state.hits = [mine[1].id, theirs.id, mine[0].id];
    const r = await searchEmails({ userId: A.user.id, q: 'pricing', page: 1, pageSize: 10 });
    expect(r.source).toBe('elasticsearch');
    expect(r.items.map((i) => i.id)).toEqual([mine[1].id, mine[0].id]);
    expect(JSON.stringify(state.searchCalls[0].query.bool.filter)).toContain(A.user.id);
  });

  it('falls back to PostgreSQL when Elasticsearch is down', async () => {
    state.failSearch = true;
    const { user } = await makeUser();
    await sched(user.id, 2);
    const r = await searchEmails({ userId: user.id, q: 'u1@', page: 1, pageSize: 10 });
    expect(r.source).toBe('database');
    expect(r.items.map((i) => i.toEmail)).toEqual(['u1@x.com']);
  });
});
