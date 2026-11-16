import { randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { buildAuthUrl, exchangeCode, postMessage, revokeToken, slackConfigured } from '../integrations/slack';
import { encrypt, decrypt } from '../utils/crypto';
import { loadUser } from '../middleware/auth';
import { AppError, badRequest } from '../utils/errors';

const stateKey = (s: string) => `slack:state:${s}`;

/** Step 1: create a one-time CSRF `state` bound to this user (10 min TTL) and send them to Slack. */
export async function connect(req: Request, res: Response) {
  const state = randomBytes(24).toString('hex');
  const url = buildAuthUrl(state); // 503 if Slack credentials are missing
  await redis.set(stateKey(state), req.user!.id, 'EX', 600);
  res.redirect(url);
}

/** Step 2: Slack redirects back here with ?code&state. */
export async function callback(req: Request, res: Response) {
  const back = (q: string) => res.redirect(`${env.FRONTEND_URL}/slack?${q}`);
  try {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    if (error) return back(`error=${encodeURIComponent(error === 'access_denied' ? 'Slack connection was cancelled' : error)}`);
    if (!code || !state) return back('error=Missing+code+or+state');

    const stateUserId = await redis.getdel(stateKey(state)); // one-time use
    if (!stateUserId) return back('error=Invalid+or+expired+state.+Please+try+again');
    // The one-time state is bound server-side to the user who clicked "Connect". If a session cookie
    // is present (it may not be when the redirect goes through an HTTPS tunnel host) it must match.
    await loadUser(req);
    if (req.user && req.user.id !== stateUserId) return back('error=Session+mismatch.+Sign+in+and+try+again');

    const inst = await exchangeCode(code);
    const data = {
      teamId: inst.teamId, teamName: inst.teamName, channelId: inst.installerUserId,
      channelName: 'Direct message from ReachInbox', botTokenEnc: encrypt(inst.botToken), botUserId: inst.botUserId ?? null,
    };
    await prisma.slackIntegration.upsert({ where: { userId: stateUserId }, create: { userId: stateUserId, ...data }, update: { ...data, connectedAt: new Date() } });
    back('connected=1');
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Slack callback failed');
    back(`error=${encodeURIComponent(err instanceof AppError ? err.message : 'Slack connection failed')}`);
  }
}

export async function status(req: Request, res: Response) {
  const i = await prisma.slackIntegration.findUnique({ where: { userId: req.user!.id } });
  res.json({
    configured: slackConfigured(),
    connected: Boolean(i),
    workspace: i ? { id: i.teamId, name: i.teamName } : null,
    channel: i ? i.channelName : null,
    connectedAt: i?.connectedAt ?? null,
  });
}

export async function disconnect(req: Request, res: Response) {
  const i = await prisma.slackIntegration.findUnique({ where: { userId: req.user!.id } });
  if (i) {
    try { await revokeToken(decrypt(i.botTokenEnc)); } catch { /* token unreadable: still delete */ }
    await prisma.slackIntegration.delete({ where: { userId: req.user!.id } });
  }
  res.json({ ok: true });
}

/** Sends a real test message so users can verify the connection. */
export async function sendTest(req: Request, res: Response) {
  const i = await prisma.slackIntegration.findUnique({ where: { userId: req.user!.id } });
  if (!i) throw badRequest('Slack is not connected');
  try {
    await postMessage(decrypt(i.botTokenEnc), i.channelId, 'ReachInbox test notification: your Slack connection works.');
  } catch (err) {
    throw new AppError(502, `Slack rejected the message: ${(err as Error).message}`, 'slack_post_failed');
  }
  res.json({ ok: true });
}
