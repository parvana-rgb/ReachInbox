import { WebClient } from '@slack/web-api';
import { env } from '../config/env';
import { AppError } from '../utils/errors';

/** Short timeout + no retries: a Slack outage must never hang our API or workers. */
const web = (token?: string) => new WebClient(token, { timeout: 8000, retryConfig: { retries: 0 } });

export const slackConfigured = () => Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET);

function assertConfigured() {
  if (!slackConfigured()) {
    throw new AppError(503, 'Slack is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.', 'slack_not_configured');
  }
}

export function buildAuthUrl(state: string): string {
  assertConfigured();
  const u = new URL('https://slack.com/oauth/v2/authorize');
  u.searchParams.set('client_id', env.SLACK_CLIENT_ID!);
  u.searchParams.set('scope', 'chat:write');
  u.searchParams.set('redirect_uri', env.SLACK_REDIRECT_URI);
  u.searchParams.set('state', state);
  return u.toString();
}

export interface SlackInstall {
  teamId: string; teamName: string; botToken: string; botUserId?: string; installerUserId: string;
}

export async function exchangeCode(code: string): Promise<SlackInstall> {
  assertConfigured();
  const res = await web().oauth.v2.access({
    client_id: env.SLACK_CLIENT_ID!,
    client_secret: env.SLACK_CLIENT_SECRET!,
    code,
    redirect_uri: env.SLACK_REDIRECT_URI,
  });
  if (!res.ok || !res.access_token || !res.team?.id || !res.authed_user?.id) {
    throw new AppError(502, `Slack OAuth failed: ${res.error ?? 'unexpected response'}`, 'slack_oauth_failed');
  }
  return {
    teamId: res.team.id,
    teamName: res.team.name ?? res.team.id,
    botToken: res.access_token,
    botUserId: res.bot_user_id,
    installerUserId: res.authed_user.id,
  };
}

export type SlackPoster = (token: string, channel: string, text: string, blocks?: unknown[]) => Promise<void>;

const realPoster: SlackPoster = async (token, channel, text, blocks) => {
  const res = await web(token).chat.postMessage({ channel, text, blocks: blocks as never });
  if (!res.ok) throw new Error(`Slack chat.postMessage failed: ${res.error}`);
};
let poster: SlackPoster = realPoster;
/** Tests inject a fake poster. Pass null to restore the real Slack API call. */
export const setSlackPoster = (p: SlackPoster | null) => { poster = p ?? realPoster; };
export const postMessage: SlackPoster = (t, c, x, b) => poster(t, c, x, b);

export async function revokeToken(token: string): Promise<void> {
  try { await web(token).auth.revoke(); } catch { /* best effort */ }
}
