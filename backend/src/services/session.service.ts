import { randomBytes } from 'crypto';
import type { CookieOptions } from 'express';
import { redis } from '../config/redis';
import { env } from '../config/env';

const key = (id: string) => `sess:${id}`;

export async function createSession(userId: string): Promise<string> {
  const id = randomBytes(32).toString('hex');
  await redis.set(key(id), userId, 'EX', env.SESSION_TTL_SECONDS);
  return id;
}

/** Returns the userId and slides the expiry forward (7 days of inactivity by default). */
export async function resolveSession(id: string | undefined): Promise<string | null> {
  if (!id || !/^[a-f0-9]{64}$/.test(id)) return null;
  const userId = await redis.get(key(id));
  if (userId) await redis.expire(key(id), env.SESSION_TTL_SECONDS);
  return userId;
}

export const destroySession = (id: string) => redis.del(key(id));

export const sessionCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
  path: '/',
  maxAge: env.SESSION_TTL_SECONDS * 1000,
});
