# VENOM Deployment Runbook

## Objective
Deploy backend to Render and dashboard to Vercel using the newest secure flow:
- Private dashboard login (email/password)
- Signed session cookie
- Server-side backend API bridge (dashboard never exposes API key field)

## 1) Backend Deployment (Render)

### Option A: Blueprint (recommended)
1. In Render, choose **New +** -> **Blueprint**.
2. Connect this repository.
3. Render reads `render.yaml` from repo root and creates `venom-backend`.

### Option B: Manual service
1. Create **Web Service** from this repo.
2. Root directory: `backend`
3. Build command: `npm ci`
4. Start command: `npm start`

### Required backend environment variables
- `NODE_ENV=production`
- `PORT=5000`
- `MONGODB_URI=<atlas-uri>`
- `VENOM_API_KEY=<strong-random-key>`
- `CORS_ORIGINS=https://<your-dashboard-domain>`
- `ENABLE_INMEMORY_DB=false`
- `CLAUDE_API_KEY=<optional>`
- `CLAUDE_MODEL=claude-3-5-sonnet-latest`
- `CLAUDE_LEARNER_MODEL=claude-3-5-sonnet-latest`
- `CLAUDE_CHAIN_MODEL=claude-3-5-sonnet-latest`
- `CLAUDE_PROMPT_EVOLVER_MODEL=claude-3-5-sonnet-latest`
- `CLAUDE_CHAIN_ENABLED=true`
- `MAX_CONCURRENT_TARGETS=3`
- `ENABLE_PROMPT_EVOLUTION_JOB=false` (set `true` to run weekly automatic prompt evolution)
- `PROMPT_EVOLUTION_CRON=0 3 * * 0`
- `PROMPT_EVOLUTION_TIMEZONE=UTC`
- `PROMPT_EVOLUTION_MIN_CONFIDENCE=0.70`
- `ENABLE_CVE_SYNC_JOB=false` (set `true` to schedule auto NVD sync)
- `ENABLE_DOCKER_TOOLS=false` (set `true` only when Render runtime has Docker access and policy approval)
- `CVE_SYNC_CRON=0 2 * * *`
- `CVE_SYNC_TIMEZONE=UTC`
- `CVE_SYNC_ON_STARTUP=true`
- `CVE_SYNC_STARTUP_DELAY_MS=10000`
- `NVD_SYNC_DAYS=7`
- `NVD_SYNC_LIMIT=25`
- `NVD_PAGE_SIZE=100`
- `NVD_API_KEY=<optional but recommended for higher rate limits>`
- `SMTP_HOST=<optional>`
- `SMTP_PORT=587`
- `SMTP_USER=<optional>`
- `SMTP_PASS=<optional>`
- `SMTP_FROM=<optional>`
- `ENABLE_RESEARCH_JOB=false` (set `true` for scheduled autonomous research cycles)
- `RESEARCH_JOB_CRON=0 4 * * 2,5`
- `RESEARCH_JOB_TIMEZONE=UTC`
- `RESEARCH_NVD_DAYS=2`
- `RESEARCH_NVD_LIMIT=40`
- `ENABLE_RESEARCH_PROMPT_EVOLUTION=true`
- `SLACK_WEBHOOK_URL=<optional>` (critical finding alerting)
- `JIRA_API_URL=<optional>`
- `JIRA_PROJECT_KEY=<optional>`
- `JIRA_EMAIL=<optional>`
- `JIRA_API_TOKEN=<optional>`
- `VENOM_REALTIME_SECRET=<strong-random-secret>`
- `VENOM_REALTIME_TOKEN_TTL_MS=600000`
- `DEFAULT_STARTUP_PROFILE=true`
- `TRANSLATE_FINDINGS_ON_COMPLETE=true`
- `ENABLE_DECISION_BRIEF_AI=true` (set false to force heuristic-only briefs)
- `CLAUDE_DECISION_MODEL=claude-3-5-sonnet-latest`
- `CLAUDE_TRANSLATOR_MODEL=claude-3-5-haiku-latest`
- `ENABLE_FINDING_TRANSLATION_AI=false` (set true for AI-generated audience translations)
- `CONTINUOUS_SCAN_ENABLED=false` (set true for daily baseline snapshots + change detection)
- `CONTINUOUS_SCAN_CRON=0 6 * * *`
- `CONTINUOUS_SCAN_TIMEZONE=UTC`

### Verify backend
- `GET https://<backend-domain>/health` -> `200`
- `GET https://<backend-domain>/ready` -> `200`

## 2) Dashboard Deployment (Vercel)

1. In Vercel, import this repository.
2. **Root Directory**: `dashboard`
3. Vercel uses `dashboard/vercel.json`.

### Required dashboard environment variables
- `VENOM_DASHBOARD_LOGIN_EMAIL=nishanthrajs01@gmail.com`
- `VENOM_DASHBOARD_LOGIN_PASSWORD=<your-password>`
- `VENOM_DASHBOARD_SESSION_SECRET=<long-random-secret>`
- `VENOM_BACKEND_BASE_URL=https://<backend-domain>`
- `VENOM_BACKEND_API_KEY=<same-value-as-backend-VENOM_API_KEY>`
- `NEXT_PUBLIC_VENOM_API_BASE_URL=https://<backend-domain>`

### Verify dashboard
1. Open `https://<dashboard-domain>/login`.
2. Login with configured private email/password.
3. Open `/dashboard` and click `Refresh`.
4. Create an engagement and confirm it appears in list.

## 3) Data-Path Validation (important)
The dashboard now calls `/api/backend/*` on Vercel, and that bridge forwards to Render using server-side API key.

Quick checks:
- Login works only with configured credentials.
- Calling `https://<dashboard-domain>/api/backend/engagements` without session should return `401`.
- After login, dashboard reads and writes engagements normally.
- `GET /api/backend/api/compliance/<engagementId>` returns CVSS + OWASP summary.
- `GET /api/backend/api/reports/<engagementId>/pdf` downloads backend-rendered PDF.
- `POST /api/backend/api/chain/<engagementId>` runs Week 10 chain orchestration.
- `GET /api/backend/api/evidence/<engagementId>/verify` validates evidence chain-of-custody hashes.
- `POST /api/backend/api/prompts/evolve` triggers Week 11 prompt evolution cycle.
- `GET /api/backend/api/prompts/history` returns prompt lineage and evolution log.
- `GET /api/backend/api/orchestrate/status` shows active orchestration workers.
- `POST /api/backend/api/orchestrate` runs multi-target orchestration (bounded by `MAX_CONCURRENT_TARGETS`).
- `POST /api/backend/api/research/trigger` runs Week 12 threat-intel research cycle.
- `GET /api/backend/api/research/log?limit=5` returns recent research run history.
- `GET /api/backend/api/realtime/status` returns WebSocket server and room stats.
- `POST /api/backend/api/decisions/<engagementId>/brief` generates decision-intelligence top risks.
- `GET /api/backend/api/control/scope/<engagementId>` returns scope dashboard.
- `GET /api/backend/api/control/preview/<engagementId>` returns action preview before execution.
- `POST /api/backend/api/control/killswitch/global` toggles global execution kill switch.
- `POST /api/backend/api/control/killswitch/engagement/<engagementId>` toggles per-engagement kill switch.
- `GET /api/backend/api/monitoring/<engagementId>/snapshots` returns security timeline snapshots.
- `GET /api/backend/api/monitoring/<engagementId>/changes` returns delta since previous snapshot.

## 4) Common Failure Map
- Login fails with valid credentials:
  - Check `VENOM_DASHBOARD_LOGIN_EMAIL` and `VENOM_DASHBOARD_LOGIN_PASSWORD` in Vercel env.
- Dashboard says backend bridge misconfigured:
  - Set `VENOM_BACKEND_API_KEY` in Vercel env.
- Dashboard loads but no data:
  - Verify `VENOM_BACKEND_BASE_URL`.
  - Verify backend `VENOM_API_KEY` matches dashboard `VENOM_BACKEND_API_KEY`.
- `503` from backend endpoints:
  - Check backend `MONGODB_URI` and `/ready`.

## 5) Security Notes
- Keep `VENOM_BACKEND_API_KEY`, dashboard login password, and session secret out of git.
- Rotate credentials immediately if exposed.
- Use separate credentials for production and local development.
