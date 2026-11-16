import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './config/prisma';
import { redis } from './config/redis';
import { emailQueue } from './queues/email.queue';
import { createEmailWorker } from './workers/email.worker';
import { recoverPendingEmails } from './schedulers/recovery';
import { ensureIndex, esEnabled } from './integrations/elasticsearch';
import { reindexDirty } from './services/search.service';

async function main() {
  await prisma.$queryRaw`SELECT 1`; // fail fast if DB is down
  await redis.ping();

  if (esEnabled()) {
    try { await ensureIndex(); logger.info('Elasticsearch index ready'); }
    catch (e) { logger.warn({ err: (e as Error).message }, 'Elasticsearch unavailable at startup (search falls back to the database)'); }
  }

  const worker = env.ENABLE_WORKER ? createEmailWorker() : null;
  await recoverPendingEmails();
  void reindexDirty().then((n) => n && logger.info({ n }, 'Reindexed dirty emails'));

  const server = createApp().listen(env.PORT, () => logger.info(`API listening on ${env.BACKEND_URL} (worker: ${worker ? 'on' : 'off'})`));

  const shutdown = async (sig: string) => {
    logger.info(`${sig} received, shutting down`);
    server.close();
    await worker?.close(); // waits for in-flight jobs to finish
    await emailQueue.close();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e) => { logger.error(e, 'Fatal startup error'); process.exit(1); });
