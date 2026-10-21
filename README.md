# PulseCheck

An API uptime and latency monitoring service with a public status page.
You register monitors for the URLs you care about; PulseCheck checks them on
a schedule, records every result, tracks incidents when a target goes down
and recovers, and publishes a live status page anyone can view.

## Features

- **Accounts** — register/login with bcrypt-hashed passwords and JWT sessions.
- **Monitors** — create monitors for any http(s) URL with a custom check
  interval (≥ 30s), timeout (1–30s), method (GET/HEAD/POST) and expected
  status-code range. Pause, resume, edit and delete; every endpoint is
  owner-scoped.
- **Scheduled checks** — a background scheduler finds monitors that are due,
  queues them, and a worker performs the HTTP checks and stores every result.
- **Incident tracking** — an incident opens automatically when a monitor goes
  down and closes when it recovers. Repeated failures during an outage do not
  create duplicate incidents. Optional webhook notifications (POSTed JSON on
  open and on resolve).
- **Statistics** — per-monitor uptime percentage, average latency and p95
  latency over 24h / 7d / 30d windows, computed in SQL
  (`percentile_cont`), plus full check history and incident history.
- **Public status page** — every active monitor with its current status and
  24h uptime, no login required. The payload is cached (Redis) with a 15s TTL
  because status pages get polled a lot.
- **Rate limiting** on auth and write endpoints.

## Architecture

```
            ┌────────────┐   due monitors   ┌──────────────┐
            │ Scheduler  │ ───────────────▶ │ Check queue  │
            │ (interval) │                  │ Redis list / │
            └────────────┘                  │ in-memory    │
                                            └──────┬───────┘
                                                   │ dequeue
                                            ┌──────▼───────┐
                                            │    Worker    │
                                            │  checker.ts  │── HTTP ──▶ target URL
                                            └──────┬───────┘
                                                   │ result
              ┌────────────────────────────────────▼─────────────────────┐
              │ monitorService: store check row, update status,  │
              │ run the incident state machine, fire webhooks    │
              └──────────────────────────────────────────────────────────┘

  PostgreSQL — users, monitors, checks, incidents (hand-written SQL, no ORM)
  Redis      — check queue + public-status cache (in-memory fallbacks included)
```

**Incident state machine** — after each check, the monitor's status and the
check result decide what happens:

| Current status | Check | Action | New status |
|---|---|---|---|
| up / unknown | ok | — | up |
| up / unknown | fail | open incident | down |
| down | fail | — (already open) | down |
| down | ok | close incident | up |

A partial unique index (`WHERE resolved_at IS NULL`) guarantees at most one
open incident per monitor at the database level, on top of the state machine.

## Tech stack

- **Server:** TypeScript, Node.js, Express, `pg` (node-postgres), ioredis,
  jsonwebtoken, bcryptjs, zod, Jest + supertest
- **Client:** React + TypeScript, Vite (charts are hand-drawn inline SVG —
  no chart library)
- **Data:** PostgreSQL 16, Redis 7 (both optional to replace: the cache and
  queue have in-memory implementations with the same interfaces, selected
  automatically when Redis is unreachable)

## Running it

### With Docker Compose

```bash
docker compose up --build
# → http://localhost:4000  (API + client, scheduler running)
```

### Local development

You need PostgreSQL and (optionally) Redis running locally.

```bash
# 1. Create the database and user
sudo -u postgres psql -c "CREATE USER pulsecheck WITH PASSWORD 'pulsecheck';"
sudo -u postgres psql -c "CREATE DATABASE pulsecheck OWNER pulsecheck;"

# 2. Server
cd server
cp ../.env.example .env   # adjust if your setup differs
npm install
npm run migrate
npm run dev               # API on http://localhost:4000

# 3. Client (separate terminal)
cd client
npm install
npm run dev               # UI on http://localhost:5173 (proxies /api → :4000)
```

For production, `npm run build` in both `client/` and `server/`, then
`npm start` in `server/` — the server serves the built client itself.

## API

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | — | Create account, returns JWT |
| POST | `/api/auth/login` | — | Log in, returns JWT |
| POST | `/api/monitors` | ✓ | Create a monitor |
| GET | `/api/monitors` | ✓ | List your monitors |
| GET | `/api/monitors/:id` | ✓ | Get one monitor |
| PATCH | `/api/monitors/:id` | ✓ | Update (incl. pause/resume via `is_active`) |
| DELETE | `/api/monitors/:id` | ✓ | Delete a monitor |
| GET | `/api/monitors/:id/stats?window=24h\|7d\|30d` | ✓ | Uptime %, avg & p95 latency |
| GET | `/api/monitors/:id/checks?limit=&offset=` | ✓ | Paginated check history |
| GET | `/api/monitors/:id/incidents` | ✓ | Incident list (with durations) |
| GET | `/api/status` | — | Public status of all active monitors |
| GET | `/health` | — | Liveness probe |

### Example session (captured from an actual run)

Register and create a monitor for a service running locally on port 9100:

```bash
$ curl -s -X POST localhost:4000/api/auth/register \
    -H 'content-type: application/json' \
    -d '{"email":"demo@pulsecheck.dev","password":"demo-password-123"}'
{"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…","user":{"id":1,"email":"demo@pulsecheck.dev"}}

$ curl -s -X POST localhost:4000/api/monitors \
    -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
    -d '{"name":"demo-stub-service","url":"http://127.0.0.1:9100/","interval_seconds":30,"timeout_ms":5000}'
{"id":1,"user_id":1,"name":"demo-stub-service","url":"http://127.0.0.1:9100/","method":"GET",
 "interval_seconds":30,"timeout_ms":5000,"expected_status_min":200,"expected_status_max":399,
 "webhook_url":null,"is_active":true,"last_checked_at":null,"current_status":"unknown",
 "created_at":"2026-10-21T16:38:48.277Z"}
```

The scheduler picks the monitor up within one tick; afterwards its checks,
stats and the public status look like this:

```bash
$ curl -s localhost:4000/api/monitors/1/checks -H "Authorization: Bearer $TOKEN"
{"checks":[{"id":1,"monitor_id":1,"checked_at":"2026-10-21T16:38:49.294Z","ok":true,
  "status_code":200,"latency_ms":36,"error":null}],"total":1,"limit":50,"offset":0}

$ curl -s "localhost:4000/api/monitors/1/stats?window=24h" -H "Authorization: Bearer $TOKEN"
{"monitorId":1,"window":"24h","currentStatus":"up","totalChecks":1,"okChecks":1,
 "uptimePct":100,"avgLatencyMs":36,"p95LatencyMs":36}

$ curl -s localhost:4000/api/status
{"generatedAt":"2026-10-21T16:39:01.264Z",
 "monitors":[{"id":1,"name":"demo-stub-service","status":"up","uptime24h":100}]}
```

## Tests

```bash
cd server
# Uses a separate database (pulsecheck_test by default; override with TEST_DATABASE_URL)
npm install
npm test
```

The suite (22 tests) covers:

- **Unit:** the incident state machine over fixture sequences (a full
  up→down→down→up cycle opens and closes exactly one incident), uptime
  percentage math, and scheduler due-monitor selection against a real
  database.
- **Integration:** an end-to-end run against a local stub HTTP server whose
  status can be flipped between 200 and 500 — register → create monitor →
  checks are recorded → flipping to 500 opens exactly one incident → flipping
  back resolves it → webhook events arrive for both transitions → stats and
  the public status endpoint reflect the 50% uptime.

## Project structure

```
pulsecheck/
├── docker-compose.yml        # postgres + redis + server
├── server/
│   ├── migrations/           # hand-written SQL migrations
│   └── src/
│       ├── index.ts          # bootstrap (drivers, HTTP server, scheduler)
│       ├── app.ts            # express app factory
│       ├── scheduler.ts      # producer tick + worker loop
│       ├── lib/              # cache, queue (Redis + in-memory), rate limiter
│       ├── middleware/       # JWT auth
│       ├── repositories/     # SQL data access (users, monitors, checks, incidents)
│       ├── services/         # checker, monitor/incident logic, stats
│       └── routes/           # auth, monitors (+stats/checks/incidents), public status
└── client/                   # Vite + React UI (dashboard, detail, public status)
```

## Configuration

All configuration is via environment variables — see `.env.example`
(`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `SCHEDULER_TICK_MS`,
`CACHE_DRIVER` / `QUEUE_DRIVER`, `DISABLE_SCHEDULER`).
