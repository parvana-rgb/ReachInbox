import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env';
import { AppError } from '../utils/errors';

export const googleConfigured = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

function client() {
  if (!googleConfigured()) {
    throw new AppError(503, 'Google login is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.', 'google_not_configured');
  }
  return new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_CALLBACK_URL);
}

export const googleAuthUrl = (state: string) =>
  client().generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, prompt: 'select_account', access_type: 'online' });

export interface GoogleProfile { googleId: string; email: string; name: string; avatarUrl?: string }

/** Exchanges the code and cryptographically verifies the ID token (signature, audience, expiry). */
export async function profileFromCode(code: string): Promise<GoogleProfile> {
  const c = client();
  const { tokens } = await c.getToken(code);
  if (!tokens.id_token) throw new AppError(502, 'Google did not return an ID token', 'google_oauth_failed');
  const ticket = await c.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID! });
  const p = ticket.getPayload();
  if (!p?.sub || !p.email) throw new AppError(502, 'Google ID token is missing profile fields', 'google_oauth_failed');
  if (!p.email_verified) throw new AppError(403, 'Your Google email address is not verified', 'email_not_verified');
  return { googleId: p.sub, email: p.email.toLowerCase(), name: p.name ?? p.email, avatarUrl: p.picture };
}
