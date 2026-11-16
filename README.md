# ReachInbox — Full-Stack Email Job Scheduler

Schedule thousands of emails with BullMQ delayed jobs, per-sender hourly rate limits, Slack alerts, and Elasticsearch search. PostgreSQL is the source of truth; Redis holds the queue.

## 1. Features
- Google OAuth sign-in (ID token verified on the backend), server-side sessions in Redis
- Compose + schedule: subject, body, CSV/TXT recipient upload (drag and drop), start time, delay between emails, hourly limit
- One persistent BullMQ **delayed job per email** (no cron, no `setTimeout`)
- Multiple Ethereal sender accounts per user (round-robin), real SMTP via Nodemailer, preview URLs
- Atomic hourly rate limiting per sender (Redis Lua); excess emails move to the next hour, never dropped
- Slack OAuth + real Slack message when a sender hits its limit (once per sender per hour)
- Elasticsearch search (user-scoped) with automatic PostgreSQL fallback
- Protected Bull Board dashboard at `/admin/queues`
- Restart-safe: startup recovery re-creates any missing jobs with deterministic ids

## 2. Technology
Backend: Node 20+, TypeScript, Express 4, BullMQ, Redis, PostgreSQL, Prisma 6, Nodemailer, Elasticsearch 8 client, google-auth-library, @slack/web-api, Bull Board, Vitest.
Frontend: React 18 + Vite, TypeScript, Tailwind CSS 3, React Router, Axios, React Hook Form + Zod, Lucide, react-hot-toast.
Infra: Docker Compose (PostgreSQL 16, Redis 7 with AOF, Elasticsearch 8.15).

## 3. Architecture
```
Browser (React) ──cookie session──▶ Express API ──▶ PostgreSQL (truth: users, batches, emails, senders, events)
                                        │  └────────▶ Elasticsearch (searchable copy, best-effort)
                                        ▼
                              BullMQ queue "email-queue" (Redis, AOF)
                                        ▼
                                  Worker(s) ──▶ Redis Lua rate limiter ──▶ Nodemailer ──▶ Ethereal SMTP
                                        └────────▶ Slack (chat.postMessage) on rate-limit event
```
The worker runs inside the API process by default (`ENABLE_WORKER=true`). Set it to `false` on API-only instances and run extra instances with the worker on to scale out; the safety guarantees below hold with any number of workers.

## 4. Folder structure
```
backend/src/{config,controllers,services,routes,middleware,queues,workers,schedulers,integrations,repositories,utils,types,validators}
backend/prisma/{schema.prisma,migrations/}    backend/tests/
frontend/src/{components,pages,layouts,hooks,services,contexts,types,utils}
docker-compose.yml   docs/
```

## 5. Database design (Prisma, UUID keys, FKs, indexes)
| Model | Purpose / key constraints |
|---|---|
| User | `googleId` unique, `email` unique |
| Sender | Ethereal SMTP identity per user; password AES-256-GCM encrypted; unique (userId, email) |
| EmailBatch | One "Schedule" action: subject, body, startAt, delaySeconds, hourlyLimit |
| Email | status `scheduled/processing/sent/failed`, `sendAt` (moves when rate-limited), `lockedAt`, attempts, error, messageId, previewUrl, `indexDirty`; unique (batchId, toEmail); indexes on (userId,status,sendAt), (status,sendAt) |
| SlackIntegration | one per user; bot token AES-256-GCM encrypted |
| RateLimitEvent | unique (senderId, windowStart) — dedupes Slack alerts |

## 6. How BullMQ scheduling works
`POST /api/emails/schedule` writes the batch and all email rows in **one DB transaction**, then calls `queue.addBulk` with one job per email: `jobId = email-<uuid>`, `delay = sendAt − now`. Email *i* gets `sendAt = start + i × delay`. BullMQ keeps delayed jobs in a Redis sorted set and wakes the worker when the first one is due — there is no polling loop and no cron. Worker concurrency is `WORKER_CONCURRENCY` (default 5). Failures retry with exponential backoff (`EMAIL_MAX_ATTEMPTS`, `EMAIL_BACKOFF_MS`).

## 7. How jobs survive restarts
1. Jobs live in Redis, which runs with AOF persistence (`appendonly yes`), so they survive process and Redis restarts.
2. On every startup `recoverPendingEmails()` reads all `scheduled/processing` rows from PostgreSQL and checks each job id in Redis. Present → left alone (original time kept). Missing → re-added with the *remaining* delay. Rows stuck in `processing` for >5 min (crashed worker) are reset to `scheduled`.
3. `sent` rows are never touched, so sent mail is never re-sent.
Tested: worker restart mid-batch, Redis data wipe, recovery run twice (see `tests/worker.test.ts`).

## 8. How duplicate sending is prevented (three layers)
1. **Deterministic job id** — adding `email-<uuid>` twice is a no-op in BullMQ.
2. **Atomic DB claim** — before sending, the worker runs `UPDATE … SET status='processing' WHERE id=? AND status='scheduled'`. Only the worker that updates 1 row proceeds. This holds even if two jobs exist for the same email.
3. **Stable Message-ID** (`<emailId@reachinbox.local>`) on every send.
Residual risk (documented trade-off): if a worker dies after SMTP accepted the message but before the DB update, the row looks abandoned and may be re-sent after 5 minutes (at-least-once in that rare window).

## 9. How hourly rate limiting works
- Window = fixed **clock hour** (`floor(now / 3600000) × 3600000`, UTC). Counter key: `rl:<senderId>:<windowStart>`.
- A Redis **Lua script** does "read count; if below limit, increment" as one atomic step, so concurrent workers can never both take the last slot. (A plain GET-then-INCR would race.)
- If the window is full: the DB row gets `sendAt = next hour start`, then `job.moveToDelayed(nextHour)` + `DelayedError` moves the *same job* (not counted as a failure). Nothing is discarded. Moved jobs have an earlier timestamp than jobs originally planned inside that hour, so they go first; relative order is otherwise preserved by BullMQ's insertion order.
- If SMTP then fails, the slot is refunded.
- The limit comes from the batch; the counter is per sender.

## 10. How concurrency is controlled
`WORKER_CONCURRENCY` jobs run in parallel per worker process. Correctness under concurrency comes from the atomic Lua rate limiter and the atomic DB claim, not from running one job at a time.

## 11. How Slack notifications work
`GET /api/slack/connect` creates a random `state`, stores it in Redis for 10 min bound to your user id, and redirects to Slack. The callback consumes the state (single use), exchanges the code, encrypts the bot token (AES-256-GCM, key from `SLACK_TOKEN_ENCRYPTION_KEY`) and saves it. When a worker hits a limit it inserts a `RateLimitEvent`; the unique key (sender, hour) means only the first insert posts to Slack, so there is one alert per sender per hour. Messages are sent as a DM from the app to the person who connected. If Slack is disconnected or down, emails still send and the event records `skipped_not_connected` / `failed`.

## 12. How Elasticsearch indexing works
After each DB change (schedule, reschedule, sent, failed) the row is flagged `indexDirty=true`, then indexed (same `_id` = update in place) and flagged clean. Indexing never throws into the email flow. Dirty rows are swept at startup and via `POST /api/emails/reindex`. Searches always filter by `userId`; hits are re-loaded from PostgreSQL. If Elasticsearch is down or disabled, search transparently uses PostgreSQL `ILIKE` (response field `source` tells you which).

## 13. Prerequisites
Node.js 20+ (tested on 22), Docker Desktop, a Google account, a Slack workspace where you can install apps.

## 14. Configure Google OAuth
1. https://console.cloud.google.com → create/select a project.
2. **APIs & Services → OAuth consent screen**: External, fill app name + your email, add yourself under **Test users**.
3. **Credentials → Create credentials → OAuth client ID → Web application**.
4. Authorized redirect URI: `http://localhost:4000/auth/google/callback`.
5. Copy the client ID/secret into `backend/.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

## 15. Configure Slack OAuth
1. https://api.slack.com/apps → **Create New App → From scratch**.
2. **OAuth & Permissions**: add **Bot Token Scope** `chat:write`. Add redirect URL `http://localhost:4000/api/slack/callback` (Slack may insist on HTTPS: then run `npx ngrok http 4000`, use `https://<id>.ngrok-free.app/api/slack/callback` both in Slack and as `SLACK_REDIRECT_URI`).
3. **App Home**: turn on the **Messages Tab** and tick "Allow users to send Slash commands and messages from the messages tab" (alerts arrive as a DM from the app).
4. **Basic Information**: copy Client ID/Secret into `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`.
5. Generate the encryption key: `openssl rand -hex 32` → `SLACK_TOKEN_ENCRYPTION_KEY`.
6. In the app: **Slack Integration → Connect Slack → Allow**, then **Send test message**.

## 16. Configure Ethereal
No account needed: the backend creates Ethereal mailboxes automatically (`SENDER_COUNT`, default 2) through Ethereal's API the first time you schedule. To use a mailbox you created at https://ethereal.email/create, set `ETHEREAL_USER` / `ETHEREAL_PASS` (it becomes the first sender). View delivered mail through the **Preview on Ethereal** link in Sent Emails.

## 17. Docker setup
```bash
docker compose up -d
docker compose ps        # wait until all three show "healthy" (Elasticsearch takes ~30-60s)
```

## 18. Backend
```bash
cd backend
cp .env.example .env     # fill in the values from sections 14-16; set SESSION_SECRET (openssl rand -hex 32)
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev              # http://localhost:4000  (health: /health)
```
Production: `npm run build && npm start`.

## 19. Frontend
```bash
cd frontend
cp .env.example .env     # VITE_API_URL=http://localhost:4000
npm install
npm run dev              # http://localhost:5173
```
Use `localhost` (not `127.0.0.1`) everywhere so session cookies are shared between ports.

## 20. API
All `/api/*` routes need the session cookie (401 otherwise). Errors: `{ "error": { "code", "message", "details?" } }`.

| Method & path | Description |
|---|---|
| GET `/auth/google` | Start Google login |
| GET `/auth/google/callback` | Google redirect target; verifies ID token, creates session |
| GET `/auth/me` | Current user |
| POST `/auth/logout` | Destroy session |
| POST `/api/emails/schedule` | Body `{subject, body, recipients[], startAt(ISO), delaySeconds, hourlyLimit}` → 201 `{batchId,total,duplicatesRemoved,firstSendAt,lastSendAt,senders,queued}` |
| POST `/api/emails/recipients/parse` | multipart `file` (.csv/.txt) → `{valid[],invalid[],duplicates}` |
| GET `/api/emails/scheduled` | `?page&pageSize&q` pending emails |
| GET `/api/emails/sent` | `?page&pageSize&q&status=sent\|failed` |
| GET `/api/emails/search` | `?q&status&page&pageSize` (Elasticsearch, DB fallback) |
| GET `/api/emails/:id` | One email (404 for other users' ids) |
| POST `/api/emails/reindex` | Re-index dirty rows |
| GET `/api/dashboard/stats` | `{total,pending,sent,failed,…}` |
| GET `/api/dashboard/rate-limit-events` | Recent limit hits |
| GET `/api/slack/connect` | Redirects to Slack |
| GET `/api/slack/callback` | Slack redirect target |
| GET `/api/slack/status` | Connection info (never returns the token) |
| POST `/api/slack/disconnect` / `/api/slack/test` | Revoke+delete / send test message |
| GET `/api/queue/stats` | BullMQ counts |
| GET `/admin/queues` | Bull Board (session required; optional `ADMIN_EMAILS` allow-list) |
| GET `/health` | DB + Redis check |

## 21. Testing
Tests use the **real** Redis and PostgreSQL (isolated DB `reachinbox_test`, Redis DB 1, prefix `rib-test`).
```bash
docker compose up -d postgres redis
docker exec -it reachinbox-postgres psql -U reachinbox -c "CREATE DATABASE reachinbox_test;"
cd backend
DATABASE_URL="postgresql://reachinbox:reachinbox@localhost:5432/reachinbox_test?schema=public" npx prisma migrate deploy
npm test
```
66 tests: parser, encryption, Lua limiter under 200 concurrent calls, scheduling API, tenant isolation, worker delivery/retry/failure, rate limiting + Slack alerts, duplicate prevention, restart recovery, Slack OAuth state, Bull Board protection, Elasticsearch logic.

## 22. Known limitations and trade-offs
- Elasticsearch, Ethereal's live API, real Google/Slack OAuth round-trips and the browser UI were **not** exercised in the build sandbox (no Docker/internet to those hosts). They are implemented and covered by logic tests with fakes; verify them on your machine using the demo script.
- The initial migration SQL was written by hand (the sandbox could not download Prisma's migration engine). If `migrate deploy` complains, run `npx prisma db push` once.
- Fixed clock-hour windows allow a burst at a window boundary (limit at 10:59 and again at 11:00). A sliding window is stricter but costs more Redis work.
- Rare at-least-once window described in section 8.
- Sessions are cookie based with `SameSite=Lax`; mutations accept JSON only and CORS is restricted to `FRONTEND_URL`. Add a CSRF token if you ever host the frontend on a different site.
- Bull Board shows all users' jobs; set `ADMIN_EMAILS` for a real deployment.
- Message body is plain text (sent with a simple HTML wrapper).
