import IORedis from 'ioredis';
import { Client } from 'pg';

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://reachinbox:reachinbox@localhost:5432/reachinbox_test';

export default async function setup() {
  const r = new IORedis({ host: process.env.REDIS_HOST ?? 'localhost', db: 1, lazyConnect: true, maxRetriesPerRequest: 1 });
  try { await r.connect(); await r.flushdb(); } catch (e) {
    throw new Error(`Tests need a real Redis on localhost:6379 (docker compose up -d redis). ${(e as Error).message}`);
  } finally { r.disconnect(); }
  const pg = new Client({ connectionString: url });
  try { await pg.connect(); await pg.query('SELECT 1 FROM "Email" LIMIT 1'); } catch (e) {
    throw new Error(`Tests need PostgreSQL with migrations applied to the test DB (see README -> Testing). ${(e as Error).message}`);
  } finally { await pg.end().catch(() => undefined); }
}
