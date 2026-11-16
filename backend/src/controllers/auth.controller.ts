import { randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { googleAuthUrl, profileFromCode } from '../integrations/google';
import { createSession, destroySession, sessionCookieOptions } from '../services/session.service';
import { AppError } from '../utils/errors';

const STATE_COOKIE = 'rib_oauth_state';

export function googleStart(_req: Request, res: Response) {
  const state = randomBytes(24).toString('hex');
  const url = googleAuthUrl(state); // throws 503 if credentials are missing
  res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production', maxAge: 10 * 60 * 1000, path: '/auth' });
  res.redirect(url);
}

export async function googleCallback(req: Request, res: Response) {
  const fail = (reason: string) => res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent(reason)}`);
  try {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    if (error) return fail(error === 'access_denied' ? 'Google sign-in was cancelled' : error);
    const expected = req.cookies?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, { path: '/auth' });
    if (!code || !state || !expected || state !== expected) return fail('Invalid sign-in state. Please try again.');

    const p = await profileFromCode(code);
    const user = await prisma.user.upsert({
      where: { googleId: p.googleId },
      create: { googleId: p.googleId, email: p.email, name: p.name, avatarUrl: p.avatarUrl },
      update: { email: p.email, name: p.name, avatarUrl: p.avatarUrl },
    });
    const sid = await createSession(user.id);
    res.cookie(env.SESSION_COOKIE_NAME, sid, sessionCookieOptions());
    res.redirect(`${env.FRONTEND_URL}/dashboard`);
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Google callback failed');
    fail(err instanceof AppError ? err.message : 'Google sign-in failed. Please try again.');
  }
}

export const me = (req: Request, res: Response) => {
  const u = req.user!;
  res.json({ user: { id: u.id, email: u.email, name: u.name, avatarUrl: u.avatarUrl } });
};

export async function logout(req: Request, res: Response) {
  const sid = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (sid) await destroySession(sid);
  res.clearCookie(env.SESSION_COOKIE_NAME, { ...sessionCookieOptions(), maxAge: undefined });
  res.json({ ok: true });
}
