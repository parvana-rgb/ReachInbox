import { describe, expect, it, beforeAll } from 'vitest';
import IORedis from 'ioredis';
import { parseRecipients } from '../src/services/recipientParser';
import { encrypt, decrypt } from '../src/utils/crypto';
import { takeSlot, windowStartOf, WINDOW_MS, refundSlot } from '../src/services/rateLimiter';
import { jobIdFor, toBulkJobs } from '../src/queues/email.queue';
import { scheduleSchema } from '../src/validators/email.validators';
import { buildEsQuery } from '../src/services/search.service';

describe('recipient parser', () => {
  it('parses a plain TXT list, one per line, and dedupes case-insensitively', () => {
    const r = parseRecipients('a@x.com\nB@y.com\r\na@x.com\n');
    expect(r.valid).toEqual(['a@x.com', 'b@y.com']);
    expect(r.duplicates).toBe(1);
  });
  it('parses comma/semicolon separated TXT', () => {
    expect(parseRecipients('a@x.com, b@y.com; c@z.org').valid).toHaveLength(3);
  });
  it('uses the email column of a CSV with header and ignores other columns', () => {
    const r = parseRecipients('name,Email,company\nAnn,ann@x.com,Acme\n"Bob, Jr",bob@y.com,Beta\nNoMail,,Gamma\n');
    expect(r.valid).toEqual(['ann@x.com', 'bob@y.com']);
    expect(r.invalid).toHaveLength(0);
  });
  it('reports invalid entries with line numbers', () => {
    const r = parseRecipients('ok@x.com\nnot-an-email\nfoo@\n');
    expect(r.valid).toEqual(['ok@x.com']);
    expect(r.invalid.map((i) => i.value)).toEqual(['not-an-email', 'foo@']);
    expect(r.invalid[0].line).toBe(2);
  });
  it('handles BOM and header-only files', () => {
    expect(parseRecipients('\uFEFFemail\nz@x.com').valid).toEqual(['z@x.com']);
    expect(parseRecipients('email\n').valid).toEqual([]);
  });
});

describe('token encryption', () => {
  it('round-trips and uses random IVs', () => {
    const a = encrypt('xoxb-secret'); const b = encrypt('xoxb-secret');
    expect(a).not.toBe(b);
    expect(a).not.toContain('xoxb-secret');
    expect(decrypt(a)).toBe('xoxb-secret');
  });
  it('detects tampering', () => {
    const parts = encrypt('hello').split('.'); parts[3] = Buffer.from('tampered!!').toString('base64');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });
});

describe('rate limiter (real Redis, Lua)', () => {
  let r: IORedis;
  beforeAll(() => { r = new IORedis({ db: 1 }); });

  it('window is the clock hour', () => {
    const t = Date.UTC(2026, 0, 1, 14, 37, 12);
    expect(windowStartOf(t)).toBe(Date.UTC(2026, 0, 1, 14, 0, 0));
    expect(windowStartOf(t) + WINDOW_MS).toBe(Date.UTC(2026, 0, 1, 15, 0, 0));
  });

  it('NEVER exceeds the limit under 200 concurrent attempts', async () => {
    const results = await Promise.all(Array.from({ length: 200 }, () => takeSlot(r, 'sender-concurrent', 25)));
    expect(results.filter((x) => x.allowed)).toHaveLength(25);
    expect(results.filter((x) => !x.allowed)).toHaveLength(175);
  });

  it('separate senders and separate hours have separate counters', async () => {
    const now = Date.UTC(2026, 0, 1, 10, 30);
    expect((await takeSlot(r, 's1', 1, now)).allowed).toBe(true);
    expect((await takeSlot(r, 's1', 1, now)).allowed).toBe(false);
    expect((await takeSlot(r, 's2', 1, now)).allowed).toBe(true);
    const next = await takeSlot(r, 's1', 1, now + WINDOW_MS);
    expect(next.allowed).toBe(true);
  });

  it('reports the next window start and supports refunds', async () => {
    const now = Date.UTC(2026, 0, 1, 9, 59, 59);
    const a = await takeSlot(r, 's-refund', 1, now);
    const b = await takeSlot(r, 's-refund', 1, now);
    expect(b.allowed).toBe(false);
    expect(b.nextWindowStart).toBe(Date.UTC(2026, 0, 1, 10, 0, 0));
    await refundSlot(r, 's-refund', a.windowStart);
    expect((await takeSlot(r, 's-refund', 1, now)).allowed).toBe(true);
  });
});

describe('job ids and delays', () => {
  it('job ids are deterministic and BullMQ-safe (no colon)', () => {
    expect(jobIdFor('abc')).toBe('email-abc');
    expect(jobIdFor('abc')).not.toContain(':');
  });
  it('delay = sendAt - now, never negative', () => {
    const now = 1_000_000;
    const [a, b] = toBulkJobs([{ id: '1', sendAt: new Date(now + 5000) }, { id: '2', sendAt: new Date(now - 5000) }], now);
    expect(a.opts.delay).toBe(5000);
    expect(b.opts.delay).toBe(0);
  });
});

describe('schedule validation', () => {
  const base = { subject: 's', body: 'b', recipients: ['a@x.com'], startAt: new Date().toISOString(), delaySeconds: 1, hourlyLimit: 10 };
  it('accepts a valid payload and lowercases recipients', () => {
    expect(scheduleSchema.parse({ ...base, recipients: ['A@X.com'] }).recipients).toEqual(['a@x.com']);
  });
  it.each([
    ['empty subject', { subject: '  ' }], ['no recipients', { recipients: [] }], ['bad email', { recipients: ['nope'] }],
    ['negative delay', { delaySeconds: -1 }], ['zero hourly limit', { hourlyLimit: 0 }],
    ['past start', { startAt: new Date(Date.now() - 3600_000).toISOString() }], ['garbage date', { startAt: 'tomorrow-ish' }],
  ])('rejects %s', (_n, patch) => { expect(scheduleSchema.safeParse({ ...base, ...patch }).success).toBe(false); });
});

describe('elasticsearch query builder', () => {
  it('always filters by owner (tenant isolation)', () => {
    const q = buildEsQuery({ userId: 'u1', q: 'john', status: 'sent', page: 1, pageSize: 10 });
    expect(JSON.stringify(q.bool.filter)).toContain('"userId":"u1"');
    expect(JSON.stringify(q.bool.filter)).toContain('"status":"sent"');
    expect(q.bool.must).toHaveLength(1);
  });
  it('escapes wildcard characters from user input', () => {
    const q = buildEsQuery({ userId: 'u1', q: 'a*b?', page: 1, pageSize: 10 });
    expect(JSON.stringify(q)).toContain('*a\\\\*b\\\\?*');
  });
});
