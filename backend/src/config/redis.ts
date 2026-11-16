import IORedis from 'ioredis';
import { env } from './env';

/** Options handed to BullMQ (it creates and manages its own connections). */
export const bullConnection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  db: env.REDIS_DB,
};

/** General purpose connection: sessions, OAuth state, rate-limit Lua scripts. */
export const redis = new IORedis({ ...bullConnection, maxRetriesPerRequest: 3 });
redis.on('error', () => undefined); // errors surface via failed commands / health check
