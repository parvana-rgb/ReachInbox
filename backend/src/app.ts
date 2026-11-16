import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { env } from './config/env';
import { prisma } from './config/prisma';
import { redis } from './config/redis';
import { emailQueue } from './queues/email.queue';
import { apiRouter, authRouter } from './routes';
import { requireQueueAccess } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', async (_req, res) => {
    const checks = { database: false, redis: false };
    try { await prisma.$queryRaw`SELECT 1`; checks.database = true; } catch { /* reported below */ }
    try { checks.redis = (await redis.ping()) === 'PONG'; } catch { /* reported below */ }
    res.status(checks.database && checks.redis ? 200 : 503).json({ status: checks.database && checks.redis ? 'ok' : 'degraded', ...checks });
  });

  // Bull Board: protected by the same session cookie (+ optional ADMIN_EMAILS allow-list)
  const board = new ExpressAdapter();
  board.setBasePath('/admin/queues');
  createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter: board });
  app.use('/admin/queues', requireQueueAccess, board.getRouter());

  app.use('/auth', authRouter);
  app.use('/api', apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
