import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { asyncHandler as h } from '../utils/async';
import * as auth from '../controllers/auth.controller';
import * as email from '../controllers/email.controller';
import * as slack from '../controllers/slack.controller';
import * as dash from '../controllers/dashboard.controller';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

export const authRouter = Router();
authRouter.get('/google', auth.googleStart);
authRouter.get('/google/callback', h(auth.googleCallback));
authRouter.get('/me', requireAuth, auth.me);
authRouter.post('/logout', h(auth.logout));

export const apiRouter = Router();
// Slack callback is browser-redirected from slack.com; it validates the session itself.
apiRouter.get('/slack/callback', h(slack.callback));
apiRouter.use(requireAuth);

apiRouter.post('/emails/schedule', h(email.schedule));
apiRouter.get('/emails/scheduled', h(email.listScheduled));
apiRouter.get('/emails/sent', h(email.listSent));
apiRouter.get('/emails/search', h(email.search));
apiRouter.post('/emails/recipients/parse', upload.single('file'), h(email.parseFile));
apiRouter.post('/emails/reindex', h(email.reindex));
apiRouter.get('/emails/:id', h(email.getOne));

apiRouter.get('/dashboard/stats', h(dash.stats));
apiRouter.get('/dashboard/rate-limit-events', h(dash.rateLimitEvents));

apiRouter.get('/slack/connect', h(slack.connect));
apiRouter.get('/slack/status', h(slack.status));
apiRouter.post('/slack/disconnect', h(slack.disconnect));
apiRouter.post('/slack/test', h(slack.sendTest));

apiRouter.get('/queue/stats', h(dash.queueStats));
