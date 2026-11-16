import type { Redis } from 'ioredis';

export const WINDOW_MS = 60 * 60 * 1000;

/**
 * Atomic "check and take one slot". Redis runs a Lua script as a single indivisible step,
 * so two workers can never both take the last slot (no read-then-write race).
 * KEYS[1] = counter key, ARGV[1] = limit, ARGV[2] = key TTL in ms.
 * Returns {1, newCount} when allowed, {0, currentCount} when the window is full.
 */
const TAKE_SLOT_LUA = `
local c = tonumber(redis.call('GET', KEYS[1]) or '0')
if c >= tonumber(ARGV[1]) then return {0, c} end
c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return {1, c}
`;

/** Fixed clock-hour window, e.g. 14:00:00.000 - 14:59:59.999 UTC. */
export const windowStartOf = (nowMs: number) => Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
export const rateKey = (senderId: string, windowStart: number) => `rl:${senderId}:${windowStart}`;

export interface RateDecision {
  allowed: boolean;
  count: number;
  limit: number;
  windowStart: number;
  nextWindowStart: number;
}

export async function takeSlot(redis: Redis, senderId: string, limit: number, nowMs = Date.now()): Promise<RateDecision> {
  const windowStart = windowStartOf(nowMs);
  const [ok, count] = (await redis.eval(
    TAKE_SLOT_LUA, 1, rateKey(senderId, windowStart), String(limit), String(WINDOW_MS * 2),
  )) as [number, number];
  return { allowed: ok === 1, count, limit, windowStart, nextWindowStart: windowStart + WINDOW_MS };
}

/** Give a slot back (used when SMTP rejected the message, so the failed attempt didn't really send). */
export async function refundSlot(redis: Redis, senderId: string, windowStart: number): Promise<void> {
  const key = rateKey(senderId, windowStart);
  const v = await redis.get(key);
  if (v && Number(v) > 0) await redis.decr(key);
}
