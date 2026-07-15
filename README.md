# VENOM

Initial Week 1-7 scaffold for the VENOM project.

## Structure
- `backend/` Node.js API service
- `dashboard/` Next.js app (includes startup onboarding + operator dashboard)
- `docs/` project documentation

## Backend Quick Start
```bash
cd backend
copy .env.example .env
npm install
npm run dev
```

Server defaults to `http://localhost:5000`.
Local browser CORS allowlist is controlled via `CORS_ORIGINS` in `backend/.env` (default allows `localhost:3000` and `127.0.0.1:3000`).
If `MONGODB_URI` is not set in development, backend automatically starts an in-memory MongoDB instance when `ENABLE_INMEMORY_DB=true`.

## Dashboard Quick Start
```bash
cd dashboard
copy .env.example .env.local
npm install
npm run dev
```

Dashboard defaults to `http://localhost:3000` and calls backend at `http://localhost:5000`.

## API Endpoints
- `GET /health`
- `GET /ready`
- `POST /api/engagements`
- `GET /api/engagements`
- `GET /api/engagements/:id`
- `POST /api/patterns`
- `GET /api/patterns`
- `GET /api/patterns/match?engagementId=...`
- `POST /api/plan`
- `GET /api/plan/engagement/:engagementId`
- `POST /api/learn`
- `GET /api/compliance/:engagementId`
- `GET /api/reports/:engagementId/pdf`
- `GET /api/reports/:engagementId/markdown`
- `POST /api/reports/:engagementId/email`
- `GET /api/metrics/overview`
- `GET /api/metrics/alerts`
- `GET /api/metrics/progress`
- `GET /api/metrics/progress/:engagementId`
- `POST /api/cves/sync`
- `GET /api/cves`
- `GET /api/cves/summary`
- `GET /api/cves/stats`
- `GET /api/cve` (compat alias)
- `GET /api/cve/stats` (compat alias)
- `GET /api/execute/tools`
- `POST /api/execute`
- `GET /api/execute/:id`
- `GET /api/execute/engagement/:engagementId`
- `POST /api/chain/:engagementId`
- `GET /api/evidence/:engagementId`
- `GET /api/evidence/:engagementId/verify`
- `GET /api/prompts/active`
- `GET /api/prompts/history`
- `POST /api/prompts/evolve`
- `GET /api/orchestrate/status`
- `POST /api/orchestrate`
- `POST /api/orchestrate/:engagementId`
- `GET /api/research/latest`
- `GET /api/research/log`
- `POST /api/research/trigger`
- `GET /api/realtime/token`
- `GET /api/realtime/status`
- `POST /api/decisions/:engagementId/brief`
- `GET /api/decisions/:engagementId/brief`
- `GET /api/control/scope/:engagementId`
- `GET /api/control/preview/:engagementId`
- `GET /api/control/killswitch`
- `POST /api/control/killswitch/global`
- `POST /api/control/killswitch/engagement/:engagementId`
- `GET /api/control/activity/recent`
- `GET /api/monitoring/:engagementId/snapshots`
- `POST /api/monitoring/:engagementId/snapshot`
- `GET /api/monitoring/:engagementId/changes`
- `WS /ws?token=<signed-token>&engagementId=<optional>`

## Dashboard Auth
- Login is private and server-validated by:
  - `VENOM_DASHBOARD_LOGIN_EMAIL`
  - `VENOM_DASHBOARD_LOGIN_PASSWORD`
- Dashboard sets an HTTP-only signed session cookie.
- Browser requests call `/api/backend/*`, and dashboard server injects:
  - `x-api-key` from `VENOM_BACKEND_API_KEY`
  - `x-user-id` from session email
  - `x-user-role` from session role

## Local Troubleshooting
- If dashboard shows backend bridge errors, verify:
  1. Backend is running on `http://localhost:5000`
  2. `VENOM_BACKEND_BASE_URL` points to backend
  3. `VENOM_BACKEND_API_KEY` matches backend `VENOM_API_KEY`
- If DB routes return `503`, either:
  1. Set a valid `MONGODB_URI`, or
  2. Set `ENABLE_INMEMORY_DB=true` for local development and restart backend

## Cloud Deploy Minimum Env
- Backend (Render):
  - `VENOM_API_KEY`
  - `MONGODB_URI` (required for persistent data)
  - `CORS_ORIGINS` including dashboard URL
  - Optional AI features: `GEMINI_API_KEY` plus the related `GEMINI_*_MODEL` settings in `backend/.env.example`
  - Optional threat-intel: `NVD_API_KEY`, `ENABLE_CVE_SYNC_JOB=true`
  - Suggested Week 8: `ENABLE_GEMINI_CVE_TAGGING=true`, `GEMINI_TAGGER_MODEL`, `CVE_SYNC_CRON`
  - Suggested Week 9: `GEMINI_LEARNER_MODEL` for pattern extraction
  - Suggested Week 10: `GEMINI_CHAIN_ENABLED=true`, `GEMINI_CHAIN_MODEL`, `ENABLE_DOCKER_TOOLS=true` (only where Docker execution policy is approved)
  - Suggested Week 11: `MAX_CONCURRENT_TARGETS`, `ENABLE_PROMPT_EVOLUTION_JOB`, `PROMPT_EVOLUTION_CRON`, `PROMPT_EVOLUTION_TIMEZONE`, `PROMPT_EVOLUTION_MIN_CONFIDENCE`, `GEMINI_PROMPT_EVOLVER_MODEL`
  - Suggested Week 12: `ENABLE_RESEARCH_JOB`, `RESEARCH_JOB_CRON`, `SLACK_WEBHOOK_URL`, `JIRA_API_URL`, `JIRA_PROJECT_KEY`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `VENOM_REALTIME_SECRET`
  - Final 5 track: `DEFAULT_STARTUP_PROFILE`, `TRANSLATE_FINDINGS_ON_COMPLETE`, `ENABLE_DECISION_BRIEF_AI`, `GEMINI_DECISION_MODEL`, `GEMINI_TRANSLATOR_MODEL`, `ENABLE_FINDING_TRANSLATION_AI`, `CONTINUOUS_SCAN_ENABLED`, `CONTINUOUS_SCAN_CRON`
  - Report email delivery (optional): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- Dashboard (Vercel):
  - `VENOM_DASHBOARD_LOGIN_EMAIL`
  - `VENOM_DASHBOARD_LOGIN_PASSWORD`
  - `VENOM_DASHBOARD_SESSION_SECRET`
  - `VENOM_BACKEND_BASE_URL=https://<your-backend-domain>`
  - `VENOM_BACKEND_API_KEY=<same as backend VENOM_API_KEY>`

## PDF Generation & Download Overhaul
PDF report downloads are reinforced against server-side timeouts and cold starts, with status polling and clear UI error presentation.

