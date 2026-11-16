import 'dotenv/config';
import { z } from 'zod';

const bool = (def: 'true' | 'false') =>
  z.enum(['true', 'false']).default(def).transform((v) => v === 'true');
const emptyToUndef = (v: unknown) => (v === '' ? undefined : v);
const optStr = z.preprocess(emptyToUndef, z.string().optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  BACKEND_URL: z.string().url().default('http://localhost:4000'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: optStr,
  REDIS_DB: z.coerce.number().default(0),

  ELASTICSEARCH_URL: z.string().default('http://localhost:9200'),
  ELASTICSEARCH_ENABLED: bool('true'),

  SESSION_SECRET: z.string().default('dev-only-secret'),
  SESSION_COOKIE_NAME: z.string().default('rib_session'),
  SESSION_TTL_SECONDS: z.coerce.number().default(604800),
  ADMIN_EMAILS: z.string().default(''),

  GOOGLE_CLIENT_ID: optStr,
  GOOGLE_CLIENT_SECRET: optStr,
  GOOGLE_CALLBACK_URL: z.string().default('http://localhost:4000/auth/google/callback'),

  SLACK_CLIENT_ID: optStr,
  SLACK_CLIENT_SECRET: optStr,
  SLACK_REDIRECT_URI: z.string().default('http://localhost:4000/api/slack/callback'),
  SLACK_TOKEN_ENCRYPTION_KEY: optStr,

  ETHEREAL_USER: optStr,
  ETHEREAL_PASS: optStr,
  ETHEREAL_HOST: z.string().default('smtp.ethereal.email'),
  ETHEREAL_PORT: z.coerce.number().default(587),
  SENDER_COUNT: z.coerce.number().int().min(1).max(10).default(2),

  ENABLE_WORKER: bool('true'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(5),
  EMAIL_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  EMAIL_BACKOFF_MS: z.coerce.number().int().min(0).default(5000),
  BULLMQ_PREFIX: z.string().default('reachinbox'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = parsed.data;
export const adminEmails = env.ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
