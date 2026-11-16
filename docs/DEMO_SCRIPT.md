# Demo video script (under 5 minutes)

**Before recording:** `docker compose up -d`, backend and frontend running, `.env` filled in, Slack connected once, a file `leads.csv` ready (see below), Bull Board open in a second tab. For the rate-limit step use a 12-row file and hourly limit 3.

`leads.csv`
```
name,email
Ann,ann@example.com
Ben,ben@example.com
... (12 rows)
```

| Time | Do this | Say |
|---|---|---|
| 0:00 | Open `http://localhost:5173`. Click **Continue with Google**, pick your account. | "Real Google OAuth; the backend verifies the ID token and creates a session." |
| 0:25 | Dashboard: point at the 4 summary cards and sidebar. | "Numbers come from the API and refresh every few seconds." |
| 0:40 | **Compose New Email**. Subject + body. Drag `leads.csv` onto the drop zone. | "It parses the file, removes duplicates and shows invalid rows." Show the recipient count and preview. |
| 1:20 | Set start = 2 minutes from now, delay = 5 s, hourly limit = 3. Click **Schedule**. | "One delayed BullMQ job per email." |
| 1:40 | **Scheduled Emails**: show rows. Open Bull Board tab (**Queue Monitoring → Open Bull Board**): show Delayed jobs. | "Jobs live in Redis, not in memory." |
| 2:10 | **Restart test:** in the backend terminal press Ctrl+C, run `npm run dev` again. Refresh Bull Board. | "Jobs are still delayed. Startup recovery found them already queued and added nothing." (log line `Startup recovery finished`) |
| 2:40 | When the time arrives: **Sent Emails** fills in. Click **Preview on Ethereal** on one row. | "Real SMTP delivery to Ethereal; status comes from the SMTP result." |
| 3:20 | Rate limit: the first 3 emails per sender send, the rest show "Moved by rate limit" in **Scheduled Emails** and the dashboard banner appears. Show **Queue Monitoring** rate-limit table. | "Excess emails move to the next hour, nothing dropped." |
| 3:50 | Switch to Slack: show the alert (sender, limit, resume time). | "One alert per sender per hour; Slack is a real message." |
| 4:20 | **Search**: type part of an address. Footer shows the engine used. | "Elasticsearch, scoped to my user." |
| 4:40 | **Log out**. | Done. |

Tip: with 2 senders each allowing 3/hour, 6 emails send and 6 are deferred.
