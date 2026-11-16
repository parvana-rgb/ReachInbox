import axios, { AxiosError } from 'axios';
import type { EmailItem, EmailStatus, Paged, ParsedRecipients, QueueStats, RateLimitEventItem, ScheduleInput, ScheduleResult, SlackStatus, Stats, User } from '../types';

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

export const http = axios.create({ baseURL: API_URL, withCredentials: true, timeout: 30_000 });

/** Turns any thrown value into a message that is safe and useful to show to a person. */
export function errorMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const err = e as AxiosError<{ error?: { message?: string; details?: { path: string; message: string }[] } }>;
    const body = err.response?.data?.error;
    if (body?.details?.length) return body.details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join('; ');
    if (body?.message) return body.message;
    if (!err.response) return 'Cannot reach the server. Check that the backend is running.';
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}

export interface ListParams { page: number; pageSize: number; q?: string; status?: EmailStatus }
const clean = (p: ListParams) => ({ page: p.page, pageSize: p.pageSize, ...(p.q ? { q: p.q } : {}), ...(p.status ? { status: p.status } : {}) });

export const api = {
  me: () => http.get<{ user: User }>('/auth/me').then((r) => r.data.user),
  logout: () => http.post('/auth/logout'),
  stats: () => http.get<Stats>('/api/dashboard/stats').then((r) => r.data),
  scheduled: (p: ListParams) => http.get<Paged<EmailItem>>('/api/emails/scheduled', { params: clean(p) }).then((r) => r.data),
  sent: (p: ListParams) => http.get<Paged<EmailItem>>('/api/emails/sent', { params: clean(p) }).then((r) => r.data),
  search: (p: ListParams) => http.get<Paged<EmailItem>>('/api/emails/search', { params: clean(p) }).then((r) => r.data),
  schedule: (b: ScheduleInput) => http.post<ScheduleResult>('/api/emails/schedule', b).then((r) => r.data),
  parseRecipients: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return http.post<ParsedRecipients>('/api/emails/recipients/parse', fd).then((r) => r.data);
  },
  queueStats: () => http.get<QueueStats>('/api/queue/stats').then((r) => r.data),
  rateLimitEvents: () => http.get<{ items: RateLimitEventItem[] }>('/api/dashboard/rate-limit-events').then((r) => r.data.items),
  slackStatus: () => http.get<SlackStatus>('/api/slack/status').then((r) => r.data),
  slackDisconnect: () => http.post('/api/slack/disconnect'),
  slackTest: () => http.post('/api/slack/test'),
};

export const urls = {
  googleLogin: `${API_URL}/auth/google`,
  slackConnect: `${API_URL}/api/slack/connect`,
  bullBoard: `${API_URL}/admin/queues`,
};
