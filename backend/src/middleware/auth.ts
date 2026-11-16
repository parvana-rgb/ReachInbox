import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { env, adminEmails } from '../config/env';
import { resolveSession } from '../services/session.service';
import { forbidden, unauthorized } from '../utils/errors';

export async function loadUser(req: Request): Promise<void> {
  const userId = await resolveSession(req.cookies?.[env.SESSION_COOKIE_NAME]);
  if (userId) req.user = (await prisma.user.findUnique({ where: { id: userId } })) ?? undefined;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    await loadUser(req);
    if (!req.user) throw unauthorized();
    next();
  } catch (e) { next(e); }
}

/** Bull Board shows every user's jobs, so optionally restrict it to ADMIN_EMAILS. */
export function requireQueueAccess(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (adminEmails.length && !adminEmails.includes(req.user!.email.toLowerCase())) return next(forbidden('Queue dashboard is restricted to administrators'));
    next();
  });
}
