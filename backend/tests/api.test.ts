import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/integrations/slack', async (orig) => ({
  ...(await orig<typeof import('../src/integrations/slack')>()),
  // Only the HTTP call to slack.com is stubbed (we have no real Slack app in CI). Everything else is real.
  exchangeCode: vi.fn(async () => ({ teamId: 'T42', teamName: 'Demo Workspace', botToken: 'xoxb-super-secret', botUserId: 'B1', installerUserId: 'U42' })),
}));

import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { redis } from '../src/config/redis';
import { emailQueue } from '../src/queues/email.queue';
import { makeUser, resetAll, useFakeEthereal } from './helpers';
import { decrypt } from '../src/utils/crypto';

const app = createApp();
const future = () => new Date(Date.now() + 3600_000).toISOString();
const payload = (over = {}) => ({ subject: 'Hi', body: 'Hello there', recipients: ['a@x.com', 'b@x.com', 'c@x.com'], startAt: future(), delaySeconds: 5, hourlyLimit: 50, ...over });

beforeEach(async () => { await resetAll(); useFakeEthereal(); });
afterAll(async () => { await emailQueue.close(); await prisma.$disconnect(); redis.disconnect(); });

describe('auth & sessions', () => {
  it('rejects unauthenticated access to every protected route', async () => {
    for (const [m, p] of [['get', '/auth/me'], ['get', '/api/emails/scheduled'], ['get', '/api/emails/sent'], ['get', '/api/emails/search'], ['post', '/api/emails/schedule'], ['get', '/api/dashboard/stats'], ['get', '/api/slack/status'], ['post', '/api/slack/disconnect'], ['get', '/api/queue/stats'], ['get', '/admin/queues']] as const) {
      const r = await request(app)[m](p);
      expect(r.status, `${m} ${p}`).toBe(401);
    }
  });
  it('rejects a forged / unknown session cookie', async () => {
    expect((await request(app).get('/auth/me').set('Cookie', 'rib_session=' + 'a'.repeat(64))).status).toBe(401);
    expect((await request(app).get('/auth/me').set('Cookie', 'rib_session=garbage')).status).toBe(401);
  });
  it('returns the signed-in user and logout destroys the session', async () => {
    const { user, cookie } = await makeUser();
    const me = await request(app).get('/auth/me').set('Cookie', cookie);
    expect(me.body.user.email).toBe(user.email);
    expect((await request(app).post('/auth/logout').set('Cookie', cookie)).status).toBe(200);
    expect((await request(app).get('/auth/me').set('Cookie', cookie)).status).toBe(401);
  });
  it('Google login redirects to Google with an anti-CSRF state cookie', async () => {
    const r = await request(app).get('/auth/google');
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.location);
    expect(loc.host).toBe('accounts.google.com');
    expect(loc.searchParams.get('client_id')).toBe('test-google-id');
    expect(loc.searchParams.get('state')).toBeTruthy();
    expect(String(r.headers['set-cookie'])).toContain(loc.searchParams.get('state')!);
    expect(String(r.headers['set-cookie'])).toContain('HttpOnly');
  });
  it('Google callback refuses a mismatched state', async () => {
    const r = await request(app).get('/auth/google/callback?code=abc&state=evil').set('Cookie', 'rib_oauth_state=expected');
    expect(r.status).toBe(302);
    expect(r.headers.location).toContain('/login?error=');
  });
  it('health endpoint reports database and redis', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok', database: true, redis: true });
  });
});

describe('POST /api/emails/schedule', () => {
  it('validates input and explains what is wrong', async () => {
    const { cookie } = await makeUser();
    const r = await request(app).post('/api/emails/schedule').set('Cookie', cookie).send(payload({ subject: '', recipients: ['bad'], hourlyLimit: 0 }));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('validation_error');
    expect(r.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['subject', 'recipients.0', 'hourlyLimit']));
  });

  it('stores emails with correct staggered times and creates one delayed job per email', async () => {
    const { cookie, user } = await makeUser();
    const start = future();
    const r = await request(app).post('/api/emails/schedule').set('Cookie', cookie).send(payload({ startAt: start, delaySeconds: 10 }));
    expect(r.status).toBe(201);
    expect(r.body.total).toBe(3);
    const rows = await prisma.email.findMany({ where: { userId: user.id }, orderBy: { sendAt: 'asc' } });
    expect(rows.map((x) => x.sendAt.getTime() - new Date(start).getTime())).toEqual([0, 10000, 20000]);
    expect(rows.every((x) => x.status === 'scheduled')).toBe(true);
    expect(await emailQueue.getDelayedCount()).toBe(3);
    for (const row of rows) expect(await emailQueue.getJob(`email-${row.id}`)).toBeTruthy();
    const stats = await request(app).get('/api/dashboard/stats').set('Cookie', cookie);
    expect(stats.body).toMatchObject({ total: 3, pending: 3, sent: 0, failed: 0 });
    const q = await request(app).get('/api/queue/stats').set('Cookie', cookie);
    expect(q.body.counts.delayed).toBe(3);
  });

  it('handles a 1,200 recipient batch', async () => {
    const { cookie } = await makeUser();
    const recipients = Array.from({ length: 1200 }, (_, i) => `lead${i}@example.com`);
    const r = await request(app).post('/api/emails/schedule').set('Cookie', cookie).send(payload({ recipients, delaySeconds: 1 }));
    expect(r.status).toBe(201);
    expect(await prisma.email.count()).toBe(1200);
    expect(await emailQueue.getDelayedCount()).toBe(1200);
  });

  it('scheduled / sent lists paginate, search and split by status', async () => {
    const { cookie, user } = await makeUser();
    await request(app).post('/api/emails/schedule').set('Cookie', cookie).send(payload({ recipients: Array.from({ length: 25 }, (_, i) => `p${i}@x.com`) }));
    const p1 = await request(app).get('/api/emails/scheduled?pageSize=10&page=1').set('Cookie', cookie);
    expect(p1.body.items).toHaveLength(10);
    expect(p1.body.total).toBe(25);
    const p3 = await request(app).get('/api/emails/scheduled?pageSize=10&page=3').set('Cookie', cookie);
    expect(p3.body.items).toHaveLength(5);
    const q = await request(app).get('/api/emails/scheduled?q=p17@').set('Cookie', cookie);
    expect(q.body.items.map((i: { toEmail: string }) => i.toEmail)).toEqual(['p17@x.com']);
    expect((await request(app).get('/api/emails/sent').set('Cookie', cookie)).body.total).toBe(0);
    await prisma.email.updateMany({ where: { userId: user.id, toEmail: { in: ['p1@x.com', 'p2@x.com'] } }, data: { status: 'sent', sentAt: new Date() } });
    await prisma.email.updateMany({ where: { userId: user.id, toEmail: 'p3@x.com' }, data: { status: 'failed', lastError: 'boom' } });
    const sent = await request(app).get('/api/emails/sent').set('Cookie', cookie);
    expect(sent.body.total).toBe(3);
    expect((await request(app).get('/api/emails/sent?status=failed').set('Cookie', cookie)).body.items[0].lastError).toBe('boom');
    expect((await request(app).get('/api/emails/scheduled').set('Cookie', cookie)).body.total).toBe(22);
  });

  it('search falls back to PostgreSQL when Elasticsearch is disabled, and reports the source', async () => {
    const { cookie } = await makeUser();
    await request(app).post('/api/emails/schedule').set('Cookie', cookie).send(payload({ subject: 'Quarterly pricing update' }));
    const r = await request(app).get('/api/emails/search?q=pricing').set('Cookie', cookie);
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('database');
    expect(r.body.total).toBe(3);
  });
});

describe('tenant isolation', () => {
  it('user B cannot see or fetch user A\u2019s emails', async () => {
    const A = await makeUser('a'); const B = await makeUser('b');
    await request(app).post('/api/emails/schedule').set('Cookie', A.cookie).send(payload());
    const a1 = await prisma.email.findFirstOrThrow({ where: { userId: A.user.id } });
    expect((await request(app).get(`/api/emails/${a1.id}`).set('Cookie', A.cookie)).status).toBe(200);
    expect((await request(app).get(`/api/emails/${a1.id}`).set('Cookie', B.cookie)).status).toBe(404);
    for (const p of ['scheduled', 'sent', 'search?q=x']) {
      const r = await request(app).get(`/api/emails/${p}`).set('Cookie', B.cookie);
      expect(r.body.total).toBe(0);
    }
    expect((await request(app).get('/api/dashboard/stats').set('Cookie', B.cookie)).body.total).toBe(0);
    expect((await request(app).get('/api/emails/not-a-uuid').set('Cookie', B.cookie)).status).toBe(400);
  });
  it('each user gets their own sender accounts', async () => {
    const A = await makeUser('a'); const B = await makeUser('b');
    await request(app).post('/api/emails/schedule').set('Cookie', A.cookie).send(payload());
    await request(app).post('/api/emails/schedule').set('Cookie', B.cookie).send(payload());
    const sa = await prisma.sender.findMany({ where: { userId: A.user.id } });
    const sb = await prisma.sender.findMany({ where: { userId: B.user.id } });
    expect(sa).toHaveLength(2); expect(sb).toHaveLength(2);
    expect(sa.some((s) => sb.some((t) => t.id === s.id))).toBe(false);
    expect(sa[0].smtpPassEnc).not.toBe('pw'); // SMTP password is encrypted at rest
  });
});

describe('recipient file parsing endpoint', () => {
  it('parses CSV and TXT uploads', async () => {
    const { cookie } = await makeUser();
    const csv = await request(app).post('/api/emails/recipients/parse').set('Cookie', cookie).attach('file', Buffer.from('name,email\nA,a@x.com\nB,b@x.com\nC,a@x.com\nD,oops\n'), 'leads.csv');
    expect(csv.status).toBe(200);
    expect(csv.body).toMatchObject({ valid: ['a@x.com', 'b@x.com'], duplicates: 1 });
    expect(csv.body.invalid).toHaveLength(1);
    const txt = await request(app).post('/api/emails/recipients/parse').set('Cookie', cookie).attach('file', Buffer.from('x@y.com\nz@y.com'), 'leads.txt');
    expect(txt.body.valid).toHaveLength(2);
  });
  it('rejects other file types and missing files', async () => {
    const { cookie } = await makeUser();
    expect((await request(app).post('/api/emails/recipients/parse').set('Cookie', cookie).attach('file', Buffer.from('x'), 'a.pdf')).status).toBe(400);
    expect((await request(app).post('/api/emails/recipients/parse').set('Cookie', cookie)).status).toBe(400);
  });
});

describe('Slack OAuth', () => {
  it('connect: redirects to slack.com with a state stored server-side and bound to the user', async () => {
    const { cookie, user } = await makeUser();
    const r = await request(app).get('/api/slack/connect').set('Cookie', cookie);
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.location);
    expect(loc.host).toBe('slack.com');
    expect(loc.searchParams.get('scope')).toBe('chat:write');
    expect(await redis.get(`slack:state:${loc.searchParams.get('state')}`)).toBe(user.id);
  });
  it('callback: rejects unknown/forged state (CSRF)', async () => {
    const { cookie } = await makeUser();
    const r = await request(app).get('/api/slack/callback?code=c&state=forged').set('Cookie', cookie);
    expect(r.headers.location).toContain('/slack?error=');
    expect(await prisma.slackIntegration.count()).toBe(0);
  });
  it('callback: rejects a valid state used from a different signed-in user', async () => {
    const A = await makeUser('a'); const B = await makeUser('b');
    const loc = new URL((await request(app).get('/api/slack/connect').set('Cookie', A.cookie)).headers.location);
    const r = await request(app).get(`/api/slack/callback?code=c&state=${loc.searchParams.get('state')}`).set('Cookie', B.cookie);
    expect(r.headers.location).toContain('error=');
    expect(await prisma.slackIntegration.count()).toBe(0);
  });
  it('full flow: connect -> callback stores an ENCRYPTED token, state is single-use, status/test/disconnect work', async () => {
    const { cookie, user } = await makeUser();
    const loc = new URL((await request(app).get('/api/slack/connect').set('Cookie', cookie)).headers.location);
    const state = loc.searchParams.get('state')!;
    const cb = await request(app).get(`/api/slack/callback?code=abc&state=${state}`).set('Cookie', cookie);
    expect(cb.headers.location).toContain('/slack?connected=1');
    const row = await prisma.slackIntegration.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.botTokenEnc).not.toContain('xoxb-super-secret');
    expect(decrypt(row.botTokenEnc)).toBe('xoxb-super-secret');
    // state cannot be replayed
    const replay = await request(app).get(`/api/slack/callback?code=abc&state=${state}`).set('Cookie', cookie);
    expect(replay.headers.location).toContain('error=');

    const st = await request(app).get('/api/slack/status').set('Cookie', cookie);
    expect(st.body).toMatchObject({ connected: true, workspace: { name: 'Demo Workspace' } });
    expect(JSON.stringify(st.body)).not.toContain('xoxb'); // token never leaves the server

    const d = await request(app).post('/api/slack/disconnect').set('Cookie', cookie);
    expect(d.status).toBe(200);
    expect((await request(app).get('/api/slack/status').set('Cookie', cookie)).body.connected).toBe(false);
    expect(await prisma.slackIntegration.count()).toBe(0);
  });
  it('one user cannot see another user\u2019s Slack connection', async () => {
    const A = await makeUser('a'); const B = await makeUser('b');
    await prisma.slackIntegration.create({ data: { userId: A.user.id, teamId: 'T', teamName: 'A-Team', channelId: 'U', botTokenEnc: 'x' } });
    expect((await request(app).get('/api/slack/status').set('Cookie', B.cookie)).body.connected).toBe(false);
  });
});

describe('Bull Board', () => {
  it('is served to signed-in users and blocked for anonymous users', async () => {
    const { cookie } = await makeUser();
    expect((await request(app).get('/admin/queues')).status).toBe(401);
    const ok = await request(app).get('/admin/queues/').set('Cookie', cookie);
    expect(ok.status).toBe(200);
    expect(ok.text).toContain('<html');
    const api = await request(app).get('/admin/queues/api/queues').set('Cookie', cookie);
    expect(api.status).toBe(200);
    expect(JSON.stringify(api.body)).toContain('email-queue');
  });
});
