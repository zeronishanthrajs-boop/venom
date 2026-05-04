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
- `ENABLE_CVE_SYNC_JOB=false` (set `true` to schedule auto NVD sync)
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
