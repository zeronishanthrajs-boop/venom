# VENOM Current Version Note

**Project:** VENOM (Versatile Evolutionary Network Offensive Methodology)  
**Snapshot Type:** Code-first + runtime verification snapshot  
**Last Updated:** 2026-05-16 18:50:05 +05:30  
**Workspace Baseline:** `c:\Users\nisha\Music\VENOM`

---

## 0) Update Log

- `2026-05-16 18:50:05 +05:30`:
  - Added v0.8 attack-path learning completion details (schema/service/planner explainability/dashboard insights).
  - Added Option A auth hardening status (refresh token rotation, revocation persistence, session binding).
  - Added dashboard auth integration test status (`6/6` pass) and updated verification totals.
  - Added production requirement note for Mongo-backed dashboard session persistence.

---

## 1) Executive Summary

- Current codebase includes the original Week 1-7 foundation plus Week 8-12 autonomy/intel layers, "Final 5" operator controls, and v0.8 attack-path learning.
- Backend is a secured Express 5 service with MongoDB (external URI or in-memory fallback), strict auth headers, RBAC, rate limiting, payload validation, sanitization, and hardened response headers.
- Dashboard is a private-login Next.js 16 control center with server-side backend bridge (`/api/backend/*`) so browser clients never send raw backend API keys.
- Dashboard auth now includes refresh token rotation, persistent session revocation storage, User-Agent/IP session binding, and production Mongo persistence enforcement.
- Real-time transport is active through signed WebSocket tokens (`/ws`), with engagement-scoped events for orchestration, findings, and research updates.
- Reporting supports JSON/Markdown/PDF plus sanitized HTML export and SMTP email delivery (when SMTP vars are configured).

---

## 2) Verification Run (2026-05-16)

### Commands executed

1. `backend -> npm test`
2. `backend -> npm run test:integration`
3. `dashboard -> npm test`
4. `dashboard -> npm run build`

### Results

1. `backend npm test` -> **pass** (`135/135`).
2. `backend npm run test:integration` -> **pass** (`77/77`).
3. `dashboard npm test` -> **pass** (`6/6`).
4. `dashboard npm run build` -> **pass**.
   - Built routes include `/`, `/login`, `/onboard`, `/dashboard`, auth APIs, backend bridge API, and `/api/system/ready`.

### Interpretation

- Core code quality gates are healthy across backend and dashboard.
- v0.8 learning loop + explainability path is verified by service and integration tests.

---

## 3) Repository Structure (Current)

- `backend/` -> API, services, jobs, models, tests.
- `dashboard/` -> Next.js App Router UI + server bridge/auth routes.
- `docs/` -> deployment and weekly progress notes.
- `render.yaml` -> Render backend deployment blueprint.
- `dashboard/vercel.json` -> Vercel dashboard build config.

---

## 4) Backend Runtime Architecture

### Bootstrap flow (`backend/server.js`)

1. Connect DB (`connectDB`).
2. Start scheduled jobs:
   - CVE sync job
   - Prompt evolution job
   - Research job
   - Monitoring job
3. Initialize WebSocket server on `/ws`.
4. Start HTTP server.

### DB connection modes (`backend/config/db.js`)

- External mode when `MONGODB_URI` exists (`source: "external-uri"`).
- In-memory mode when URI is absent and `ENABLE_INMEMORY_DB=true` (or default non-production behavior) (`source: "in-memory"`).
- DB state exposed via:
  - `GET /health` (always 200 with status + DB state)
  - `GET /ready` (200 if connected, 503 otherwise, with dependency diagnostics)

### Dependency diagnostics on `/ready`

- SMTP readiness (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`)
- Gemini configured flag and model/fallback model list
- PDF runtime hints (`CHROMIUM_PATH` provided/existing)
- Warning list for missing dependencies

---

## 5) Security and Guardrails

### Backend protections

- API key + user headers required: `x-api-key`, `x-user-id`, `x-user-role`.
- Timing-safe credential comparison.
- Role normalization + RBAC (`owner/admin/operator/viewer`).
- API rate limit defaults:
  - `API_RATE_LIMIT_MAX=300` per `60000ms`
  - Auth rate limiter defaults available for auth-focused flows.
- Input hardening:
  - JSON-only enforcement on write endpoints (when auth headers present)
  - max payload check (`MAX_BODY_BYTES`, default 10MB)
  - Mongo operator key blocking (`$...`, dotted keys)
  - XSS sanitization on body/query values
- DB safety gate:
  - `requireDb` returns 503 if `mongoose.connection.readyState !== 1`.
- CORS allowlist with explicit deny -> 403 `CORS denied`.
- Security headers applied globally:
  - `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `COOP`, `CORP`, strict CSP, conditional HSTS.

### Dashboard protections

- Private login via server route (`/api/auth/login`) using configured email/password.
- Login rate limiting (`DASHBOARD_LOGIN_RATE_WINDOW_MS`, `DASHBOARD_LOGIN_RATE_MAX`).
- Signed HTTP-only session cookie (`venom_auth`, 12h default).
- Route proxy/middleware gates `/dashboard` and `/api/backend/*` behind session cookie.
- Backend bridge injects server-held headers (`x-api-key`, `x-user-id`, `x-user-role`), keeping API key out of browser payloads.

### Important caveats

1. Dashboard session persistence now enforces Mongo in production; startup throws if neither `VENOM_DASHBOARD_MONGODB_URI` nor `MONGODB_URI` is configured.
2. In non-production, session storage can still fall back to in-memory mode for local development.
3. If `VENOM_DASHBOARD_SESSION_SECRET` is missing, runtime fallback secret is generated, so sessions invalidate after process restart.

---

## 6) API Surface (Current)

### Core

- `GET /`
- `GET /health`
- `GET /ready`

### Engagements

- `POST /api/engagements`
- `GET /api/engagements`
- `DELETE /api/engagements` (owner-only bulk clear)
- `GET /api/engagements/:id`
- `GET /api/engagements/:id/report?format=json|markdown`
- `DELETE /api/engagements/:id`

### Patterns

- `POST /api/patterns`
- `GET /api/patterns`
- `GET /api/patterns/match?engagementId=...`

### Planning

- `POST /api/plan`
- `GET /api/plan/:engagementId/explain`
- `GET /api/plan/engagement/:engagementId/explain`
- `GET /api/plan/engagement/:engagementId`

### Execution

- `GET /api/execute/tools`
- `POST /api/execute`
- `GET /api/execute/engagement/:engagementId`
- `GET /api/execute/:id`

### Learning

- `POST /api/learn`

### Metrics

- `GET /api/metrics/overview`
- `GET /api/metrics/alerts`
- `GET /api/metrics/progress/:engagementId`
- `GET /api/metrics/progress`

### CVE / Threat Intel

- `POST /api/cves/sync`
- `GET /api/cves`
- `GET /api/cves/stats`
- `GET /api/cves/summary`
- Compatibility alias mounted at `/api/cve/*`.

### Reports

- `GET /api/reports/:engagementId/pdf`
- `GET /api/reports/:engagementId/markdown`
- `GET /api/reports/:engagementId/md`
- `GET /api/reports/:engagementId/html` (sanitized export)
- `POST /api/reports/:engagementId/email`

### Compliance / Chain / Evidence

- `GET /api/compliance/:engagementId`
- `POST /api/chain/:engagementId`
- `GET /api/evidence/:engagementId`
- `GET /api/evidence/:engagementId/verify`

### Prompt Evolution + Catalog

- `GET /api/prompts/active`
- `GET /api/prompts/history`
- `POST /api/prompts/evolve`
- `POST /api/prompts/evolve/run`
- Legacy/compat route set:
  - `POST /api/evolve/prompts`
  - `GET /api/evolve/prompts/history`

### Orchestration

- `GET /api/orchestrate/status`
- `POST /api/orchestrate`
- `POST /api/orchestrate/:engagementId`

### Research

- `POST /api/research/trigger`
- `GET /api/research/latest`
- `GET /api/research/log`

### Realtime

- `GET /api/realtime/token`
- `GET /api/realtime/status`
- `WS /ws?token=...&engagementId=...`

### Decision Intelligence

- `POST /api/decisions/:engagementId/brief`
- `GET /api/decisions/:engagementId/brief`

### Trust/Control

- `GET /api/control/scope/:engagementId`
- `GET /api/control/preview/:engagementId`
- `GET /api/control/killswitch`
- `POST /api/control/killswitch/global`
- `POST /api/control/killswitch/engagement/:engagementId`
- `GET /api/control/activity/recent`

### Monitoring

- `GET /api/monitoring/:engagementId/snapshots`
- `POST /api/monitoring/:engagementId/snapshot`
- `GET /api/monitoring/:engagementId/changes`

### Admin

- `POST /api/admin/fix-draft-statuses`
- `POST /api/admin/fix-tool-whitelists`
- `POST /api/admin/fix-orphaned-jobs`
- `POST /api/admin/fix-all`
- `GET /api/admin/health`

---

## 7) Execution Tooling (Current Registry)

### Internal tools

- `http_headers_probe`
- `tls_metadata_probe`
- `dns_lookup_probe`
- `zap_baseline_passive` (docker mode)

### Docker-real tools

- `nmap_tcp_scan`
- `nuclei_scan`
- `nikto_scan`
- `sqlmap_detect`

### Enforcement behavior

- Scope check against `allowedDomains` + `restrictedPaths`.
- Authorization expiry guard.
- Tool whitelist enforcement per engagement.
- Kill-switch enforcement (global/engagement) before execution.
- Docker tools blocked when `ENABLE_DOCKER_TOOLS != true`.
- Findings translated to founder/engineer/brief modes by default unless disabled.
- Evidence entries are hash-chained for integrity verification.
- Critical/high findings can trigger Slack/Jira notification integrations.

---

## 8) Intelligence, Automation, and Ops

### Planner

- Primary: Gemini API with model fallback chain (`GEMINI_MODEL` + `GEMINI_FALLBACK_MODELS`).
- Automatic template fallback with explicit `fallbackReason`.
- Unsafe offensive terms filtered from generated plan structure.
- Prompt source resolution supports DB-active prompt versions, then file defaults.

### Learner

- Updates baseline pattern outcomes from job results.
- Skips `blocked` jobs from pattern success/failure scoring.
- Creates new patterns from Gemini extraction or heuristic fallback.

### Prompt evolution

- Supported prompt types: `planning`, `chain`, `learning`.
- Uses performance metrics and confidence threshold gating.
- Writes generated prompt files to `backend/prompts/generated/`.

### Research engine

- Sources: CISA KEV, NVD recent, GitHub advisories.
- Gemini-assisted extraction with heuristic fallback.
- Persists runs in `ResearchLog`, broadcasts realtime research updates.
- Can trigger prompt evolution automatically when sufficient new patterns are discovered.

### Monitoring

- Scheduled orchestration + snapshot + change detection job (`CONTINUOUS_SCAN_*`).
- Snapshot delta includes new/resolved findings and open-port drift.

---

## 9) Data Model Inventory

### Core operational models

- `Engagement`
- `Plan`
- `ExecutionJob`
- `Pattern`
- `Evidence` (chain hash + integrity verification)

### Intelligence/ops models

- `CveSnapshot`
- `PromptVersion`
- `ResearchLog`
- `DecisionBrief`
- `SecurityBaseline`
- `KillSwitch`
- `ActivityLog`

### Legacy/compat models still present

- `Target`
- `Trace`

---

## 10) Dashboard Current Behavior

### Routes

- `/login` -> private credential terminal UI + readiness heartbeat.
- `/onboard` -> guided startup scan flow (URL, authorization, concern, launch).
- `/dashboard` -> operator control center.

### Dashboard functional blocks

- Engagement lifecycle management and creation.
- Plan generation and viewing.
- Learning insights panel (planner rationale, learned patterns, confidence, suggested tools).
- Probe execution and deep forensic mode toggle.
- Week 7 telemetry (overview, alerts, progress, CVE summary).
- Week 10 chain actions and evidence verification.
- Week 11 autonomy panel (prompt evolution + orchestration status).
- Week 12 operations panel (socket status, research logs, event count).
- Final 5 panels:
  - Decision intelligence
  - Trust/control (scope preview, action preview, kill switch, activity log)
  - Human-readable finding modes
  - Security timeline snapshots + change summary

### Refresh model

- Telemetry refresh every `15000ms`.
- Control-plane refresh every `30000ms`.
- Ops refresh every `30000ms`.
- In-flight flags prevent overlapping refresh bursts.

### Realtime handlers

- Listens for: `realtime_connected`, `tool_result`, `new_finding`, `research_update`, `orchestration_state`, `orchestration_step`.
- Triggers targeted panel refreshes on event reception.

### Export actions

- Download report (markdown/pdf from dashboard formatter).
- Download sanitized HTML snapshot (backend generated).
- Download investor-ready backend PDF with markdown fallback.
- Email PDF report.

### Owner-only controls

- Run data migrations (`/api/admin/fix-all`).
- Clear all tests (`DELETE /api/engagements`).

---

## 11) Deployment and Environment Notes

### Backend deployment config

- Render blueprint file: `render.yaml`.
- Production defaults include `ENABLE_INMEMORY_DB=false`, API/auth rate limit envs, and optional toggles for CVE sync, research, prompt evolution, monitoring, Gemini, SMTP, Slack, Jira, and realtime secret.

### Dashboard deployment config

- Vercel config: `dashboard/vercel.json`.

### Minimum required backend env

- `MONGODB_URI`
- `VENOM_API_KEY`
- `CORS_ORIGINS`
- `NODE_ENV=production`

### Minimum required dashboard env

- `VENOM_DASHBOARD_LOGIN_EMAIL`
- `VENOM_DASHBOARD_LOGIN_PASSWORD`
- `VENOM_DASHBOARD_SESSION_SECRET`
- `VENOM_DASHBOARD_MONGODB_URI` (or `MONGODB_URI`) in production
- `VENOM_BACKEND_BASE_URL`
- `VENOM_BACKEND_API_KEY`
- `NEXT_PUBLIC_VENOM_API_BASE_URL` (required for websocket hook behavior)

---

## 12) Known Gaps / Follow-up Items

1. Login boot text still mentions `5s auto-refresh` and `v0.7`, while dashboard refresh cadence is now 15s/30s and feature set is beyond Week 7.
2. Session revocation store is single-database backed and not multi-region/distributed yet (future hardening if global edge scale is needed).

---

## 13) Source-of-Truth Files

- Runtime composition:
  - `backend/server.js`
  - `backend/app.js`
- Security + middleware:
  - `backend/middleware/*.js`
- API routes:
  - `backend/routes/*.js`
- Intelligence + automation services:
  - `backend/services/*.js`
  - `backend/jobs/*.js`
- Dashboard auth/bridge/control center:
  - `dashboard/src/app/api/auth/*`
  - `dashboard/src/app/api/backend/[...path]/route.ts`
  - `dashboard/src/app/dashboard/page.tsx`
  - `dashboard/src/hooks/useVenomSocket.ts`
- Deployment docs/config:
  - `docs/DEPLOYMENT.md`
  - `render.yaml`
  - `dashboard/vercel.json`

---

## 14) Current Readout

VENOM is currently a multi-layer secured scanning/orchestration platform with private operator access, AI-assisted planning/learning/research loops, realtime ops feedback, and robust reporting/compliance surfaces. The current snapshot includes Option A auth hardening (refresh rotation, revocation persistence, session binding checks) and v0.8 attack-path learning with planner explainability and dashboard insights.
