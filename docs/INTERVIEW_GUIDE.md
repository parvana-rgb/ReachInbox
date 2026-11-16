# Explaining it in an interview (plain language)

**One sentence:** "Postgres records what must be sent; Redis/BullMQ wakes a worker at the right time; the worker sends via SMTP, enforcing an hourly cap atomically."

**Why a job per email?** Each email has its own time and retries independently, and a job id lets me avoid duplicates.

**Why delayed jobs instead of cron?** Cron wakes up on a timer and scans for work. A delayed job sits in Redis and the worker is woken exactly when it is due. It also survives restarts.

**What happens if the server restarts?** Redis (AOF on) still has the jobs. On boot I compare Postgres (what should be pending) with Redis (what is queued) and add only what is missing, using the same job id so nothing doubles.

**How do you stop double sends?** (1) same job id can't be added twice, (2) an atomic `UPDATE … WHERE status='scheduled'` — only one worker wins, (3) stable Message-ID. Honest caveat: crash between SMTP success and DB write can re-send after 5 minutes.

**Why Lua for rate limiting?** Two workers reading the counter at the same time could both see "4 of 5" and both send. Redis runs a Lua script as one uninterruptible step, so read+increment can't interleave. I tested 200 simultaneous calls with limit 25 → exactly 25 allowed.

**What happens to the extra emails?** They are moved (same job) to the start of the next hour with `moveToDelayed`, DB `sendAt` updated so the UI shows it. Not dropped.

**Why is Slack alerting once?** DB unique key (sender, hour). Only the insert that succeeds sends the message.

**Why encrypt tokens?** A DB leak shouldn't give Slack access. AES-256-GCM, key only in env.

**How do you keep users apart?** Every query includes `userId`; other users' ids return 404; ES queries always filter on userId and results are re-checked against Postgres.

**Trade-offs to mention:** fixed hour window (boundary burst), Elasticsearch is eventually consistent (dirty flag + fallback), worker in the API process (can be split with `ENABLE_WORKER`).

**Things I'd improve next:** sliding-window limiter, per-user queue fairness, templates/personalisation, bounce handling, CSRF token.
