# Requirement completion report

## Implemented and tested (automated tests against real Redis + PostgreSQL, or build/boot checks)
- BullMQ delayed jobs, one per email, deterministic ids, backoff retries, concurrency 5 (worker tests)
- Restart persistence: recovery with jobs present, jobs lost from Redis, already-sent rows, worker restart mid-batch, crashed "processing" rows
- Duplicate prevention: 25 concurrent claims → 1 winner; duplicate adds → 1 job; 3 rogue jobs for one email → 1 send
- Atomic hourly limit (Lua): 200 concurrent calls, limit 25 → exactly 25; deferral to next hour; nothing dropped; refund on SMTP failure
- Email status flow scheduled → processing → sent / failed with errors and attempts; SMTP failure never reported as success
- Slack alert logic: one message per (sender, hour); decrypted token used; not-connected and Slack-outage cases don't break sending
- Slack OAuth state handling (CSRF, one-time, user-bound), token stored encrypted, status never leaks token, disconnect
- Google login redirect + state cookie + mismatched-state rejection (configuration path)
- Sessions, logout, forged cookies, 401 on every protected route, tenant isolation (emails, lists, search, senders, Slack)
- Validation (zod), pagination, search + DB fallback, CSV/TXT parsing (unit + upload endpoint), 1,200-recipient batch
- Bull Board protected, health endpoint, compiled build boots and shuts down gracefully
- Elasticsearch indexing/search **logic** (fake client): owner filter, re-index on change, failure keeps DB row and stays dirty, fallback
- Frontend: TypeScript typecheck and production build pass
- Real server boot with curl smoke tests (health, auth guard, validation of missing Google/Ethereal reachability)

Totals: 66 backend tests passing.

## Implemented but requires external credentials / services (not verified live here)
- Google OAuth full round-trip (needs GOOGLE_CLIENT_ID/SECRET)
- Slack OAuth exchange and real message delivery (needs SLACK_* and an app with Messages Tab enabled; the HTTP exchange was stubbed in tests)
- Ethereal account creation and SMTP delivery + preview URLs (sandbox could not reach api.nodemailer.com; tests used a fake transport)
- Elasticsearch against a real cluster (mapping/query not run against a real node)
- Docker Compose file (written; Docker not available in the sandbox so `docker compose up` was not run)
- Browser UI: built and type-checked, but **not opened in a browser** here (no visual check, no click-through). Expect to fix small styling/layout issues.

## Not implemented / needs attention
- Initial Prisma migration SQL was hand-written (engine download blocked); run `npx prisma migrate deploy`, or `npx prisma db push` if it complains
- No frontend automated tests
- Rich-text body editor (plain text textarea only)
- Sliding-window rate limit (fixed hour window by design)
- Not done by me: GitHub repo creation/access, demo video recording
