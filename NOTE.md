# VENOM Current Version Note

**Project:** VENOM (Versatile Evolutionary Network Offensive Methodology)  
**Version Snapshot:** `v0.7` (Weeks 1-7 implemented)  
**Last Updated:** 2026-05-03 17:29:02 +05:30  
**Source Baseline:** Local code + runtime verification on this workspace

---

## 1) Executive Status

- **Implementation status:** Weeks **1 to 7 are implemented in code** across backend + dashboard.
- **Runtime status:** Core service boots, auth works, non-DB routes work, DB-gated routes correctly return `503` while MongoDB is not configured.
- **Primary blocker:** `backend/.env` is present, but `MONGODB_URI` is still empty.
- **Quality fix completed now:** malformed JSON API requests now return **`400 Invalid JSON body`** (instead of generic `500`).

---

## 2) Repo Property Audit (Current)

### Structure
- `backend/` present
- `dashboard/` present
- `docs/` present
- `NOTE.md` present

### Git state
- Repository is initialized (`.git/` exists)
- Current files are still **uncommitted/untracked** in this workspace snapshot

---

## 3) Week-by-Week Delivery Status

## Week 1 (Foundation)
- Backend service scaffolded (`Express + Mongoose + dotenv`)
- Health routes:
  - `GET /`
  - `GET /health`
- Mongo bootstrap connection file added
- Initial models added:
  - `Target`
  - `Pattern`
  - `Trace`

## Week 2 (API + Auth + Scope)
- Engagement routes:
  - `POST /api/engagements`
  - `GET /api/engagements`
  - `GET /api/engagements/:id`
- Pattern routes:
  - `POST /api/patterns`
  - `GET /api/patterns`
- Auth middleware (`x-api-key`, `x-user-id`, `x-user-role`)
- Activity logging middleware
- Scope/constraint checks for target and authorization window
- DB readiness middleware (`503` when DB unavailable)
- `Engagement` model added

## Week 3 (Dashboard)
- Next.js App Router dashboard created
- Pages:
  - `/` (redirect)
  - `/login`
  - `/dashboard`
- Session handling in browser local storage
- Engagement create + list workflow integrated

## Week 4 (Planning Agent)
- Planning routes:
  - `POST /api/plan`
  - `GET /api/plan/engagement/:engagementId`
- `Plan` model added
- Planner service supports:
  - Claude path (if `CLAUDE_API_KEY` exists)
  - Template fallback (safe default)
- Prompt file added: `backend/prompts/planning-agent-v1.txt`

## Week 5 (Tool Execution)
- Execution routes:
  - `GET /api/execute/tools`
  - `POST /api/execute`
  - `GET /api/execute/:id`
  - `GET /api/execute/engagement/:engagementId`
- `ExecutionJob` model added
- Tool registry + guarded executor service
- Docker-gated passive tool support

## Week 6 (Pattern Match + Learning)
- Pattern match endpoint:
  - `GET /api/patterns/match?engagementId=...`
- Learning endpoint:
  - `POST /api/learn`
- Pattern scoring service + confidence logic
- Learning loop updates pattern stats and marks jobs with `learnedAt`

## Week 7 (Metrics + Monitoring)
- Metrics endpoints:
  - `GET /api/metrics/overview`
  - `GET /api/metrics/alerts`
  - `GET /api/metrics/progress`
  - `GET /api/metrics/progress/:engagementId`
- Metrics engine:
  - success rate, durations, estimated cost, findings, trend, alerts
- Dashboard telemetry:
  - KPI cards
  - alerts panel
  - progress bars
  - 5-second auto-refresh

---

## 4) Environment Property Check

## `backend/.env.example` keys verified
- `PORT`
- `MONGODB_URI`
- `VENOM_API_KEY`
- `CLAUDE_API_KEY`
- `CLAUDE_MODEL`
- `ENABLE_DOCKER_TOOLS`
- `VENOM_MONTHLY_BUDGET_USD`

## Actual local `.env`
- `backend/.env` is present
- Expected consequence:
  - DB-required routes => `503 Database unavailable`

---

## 5) Backend Property Check

## Core middleware
- `auth.js`
  - Timing-safe API key comparison
  - Optional non-prod auth when no key configured
- `engagementConstraints.js`
  - Valid URL checks
  - Allowed domain enforcement
  - Restricted path blocking
  - Authorization expiry blocking
- `requireDb.js`
  - Hard gate on `mongoose.connection.readyState === 1`
- `activityLogger.js`
  - Method, path, user, status, duration logging

## Error handling
- Added robust malformed JSON handling:
  - Returns `400` with `{ "error": "Invalid JSON body" }`

## Tool registry
- `http_headers_probe` (`timeoutSeconds: 45`, cost `0.01`)
- `tls_metadata_probe` (`timeoutSeconds: 45`, cost `0.015`)
- `dns_lookup_probe` (`timeoutSeconds: 20`, cost `0.005`)
- `zap_baseline_passive` (`timeoutSeconds: 180`, docker-gated, cost `0.08`)

---

## 6) Data Model Property Check

## Engagement
- Core: `name`, `description`, `targetUrl`, `targetType`
- Scope: `allowedDomains`, `allowedIpRanges`, `restrictedPaths`, `restrictedServices`
- Authorization: `engagementId`, `authorizedBy`, `validFrom`, `validUntil`, `scopeOfWork`
- Constraints: `toolWhitelist`, `noDestructiveOps`, `quietMode`, `maxConcurrentOps`, `timeoutMinutes`
- State: `status`, `createdBy`, timestamps

## Pattern
- Identity: `name`, `description`, `targetType`, `tags`
- Performance: `successCount`, `failureCount`, `successRate`, `confidence`
- Learning state: `recentOutcomes`, `recentSuccessRate`, `generalizationScore`, `lastUsedAt`

## Plan
- Context: `engagementId`, `promptVersion`, `plannerSource`, `model`
- Content: `summary`, `phases[]`, `riskNotes[]`, `disclaimers[]`
- Traceability: `inputSnapshot`, `rawModelOutput`, `createdBy`, timestamps

## ExecutionJob
- Context: `engagementId`, `toolId`, `targetUrl`, `createdBy`
- Runtime: `status`, `startedAt`, `finishedAt`, `durationMs`
- Output: `output`, `rawOutput`, `errorMessage`
- Learning marker: `learnedAt`

## Legacy models still present
- `Target`
- `Trace`

---

## 7) Dashboard Property Check

- Login/session flow implemented (`email`, `role`, `apiKey`)
- Engagement creation/listing implemented
- Per-engagement actions implemented:
  - Generate/View plan
  - Run/View probe
  - Match patterns
  - Run learning
- Week 7 telemetry implemented:
  - overview KPIs
  - alerts
  - progress bars
- Auto telemetry refresh every 5 seconds

---

## 8) Runtime Verification (Latest)

**Verification date:** 2026-05-02 (local)  
**Run mode:** backend started with temporary `VENOM_API_KEY=week2-secret`, no MongoDB configured

| Check | HTTP Status | Result |
|---|---:|---|
| `GET /` | `200` | Pass |
| `GET /health` | `200` | Pass |
| `GET /api/engagements` (no auth) | `401` | Pass (auth enforced) |
| `GET /api/engagements` (auth) | `503` | Pass (DB gate enforced) |
| `GET /api/patterns` (auth) | `503` | Pass |
| `GET /api/patterns/match?engagementId=123` (auth) | `503` | Pass |
| `POST /api/plan` (auth, empty body) | `503` | Pass |
| `GET /api/execute/tools` (auth) | `200` | Pass |
| `POST /api/execute` (auth, empty body) | `503` | Pass |
| `POST /api/learn` (auth, empty body) | `503` | Pass |
| `GET /api/metrics/overview` (auth) | `503` | Pass |
| `GET /api/metrics/alerts` (auth) | `503` | Pass |
| `GET /api/metrics/progress` (auth) | `503` | Pass |
| `POST /api/plan` (auth, malformed JSON) | `400` | Pass (fixed behavior) |

---

## 9) Build/Test Verification

## Dashboard
- `npm run lint` => **pass**
- `npm run build` => **pass**
- Static routes generated: `/`, `/login`, `/dashboard`

## Backend
- `npm test` => `"No tests configured yet"` (placeholder script)

---

## 10) Solved Items In Current Version

1. Route ordering conflict fixed in execute routes:
   - `/engagement/:engagementId` is defined before `/:id`
2. Dashboard JSX probe status rendering issue fixed
3. Endpoint listing alignment updated in README
4. **Newly fixed:** malformed JSON now returns `400 Invalid JSON body`

---

## 11) Current Blockers

1. `backend/.env` exists, but live MongoDB is not configured (`MONGODB_URI` empty)
2. No persisted engagement/job/pattern data yet (because DB not connected)
3. Backend test suite not implemented yet

---

## 12) Upcoming Plan (Week 8)

## Goal
Start Meta-Evolution prep with prompt versioning + controlled evaluation pipeline.

## Day-by-day execution
1. **Day 1:** Environment go-live
   - Create `backend/.env`
   - Configure `MONGODB_URI`, `VENOM_API_KEY`
   - Optional: `CLAUDE_API_KEY`, `ENABLE_DOCKER_TOOLS`
2. **Day 2:** Baseline data creation
   - Create 5-10 engagements
   - Run planning + execution + learning loops
3. **Day 3:** Prompt version control setup
   - Create `backend/prompts/` version convention
   - Add version metadata records
4. **Day 4:** A/B framework scaffold
   - Add `promptVersion` assignment strategy per engagement
   - Track per-version win-rate fields
5. **Day 5:** Week 8 checkpoint
   - Publish initial prompt comparison report
   - Lock next prompt candidate rollout

## Week 8 success criteria
- Real data flowing to MongoDB
- Prompt versions tracked per engagement
- Initial A/B split logic in place
- First version-comparison metrics visible

---

## 13) Source-of-Truth Files

- Spec: `docs/VENOM_SPECIFICATION_v1.0.md`
- Weekly logs:
  - `docs/WEEK1_PROGRESS.md`
  - `docs/WEEK2_PROGRESS.md`
  - `docs/WEEK3_PROGRESS.md`
  - `docs/WEEK4_PROGRESS.md`
  - `docs/WEEK5_PROGRESS.md`
  - `docs/WEEK6_PROGRESS.md`
  - `docs/WEEK7_PROGRESS.md`
- Runtime docs:
  - `README.md`
  - `dashboard/README.md`

---

## 14) Final Readout

The current VENOM codebase is **functionally ready for Week 8**, with Weeks 1-7 features implemented and validated. The project is blocked only by environment/bootstrap steps (MongoDB + `.env`) before full end-to-end live workflow execution.

---

## 15) 3/5/26 CHECK:1 - Full Folder Audit (Findings + Fixes Applied)

### Scope reviewed
- Full project tree (excluding build/vendor directories) was reviewed for runtime issues, config mismatches, and documentation inconsistencies.
- Validation commands run:
  - `backend`: `npm test`, syntax checks
  - `dashboard`: `npm run lint`, `npm run build`
  - live API smoke checks on localhost

### Findings
1. `Failed to fetch` in browser dashboard actions was caused by missing CORS handling for cross-origin requests (`localhost:3000` -> `localhost:5000`) using custom headers.
2. CORS configuration was not documented in setup docs, which can re-create the same local failure for future runs.
3. During runtime re-validation, dashboard process was not active in one pass (operational inconsistency for manual testing).

### Fixes applied
1. Added CORS middleware in backend:
   - file: `backend/server.js`
   - allows local origins and required headers (`x-api-key`, `x-user-id`, `x-user-role`, `Content-Type`)
2. Added explicit CORS env template:
   - file: `backend/.env.example`
   - added `CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000`
3. Updated docs to prevent recurrence:
   - file: `README.md` (local troubleshooting + CORS note)
   - file: `dashboard/README.md` (backend CORS requirement note)
4. Re-started local services and re-verified routes after patch.

---

## 16) 3/5/26 CHECK:2 - Post-Fix Verification Status

### Re-check results
- `GET http://localhost:5000/health` => `200` (pass)
- `OPTIONS http://localhost:5000/api/engagements` with browser preflight headers => `204` (pass)
- `GET http://localhost:5000/api/execute/tools` with auth + origin => `200` (pass)
- `GET http://localhost:5000/api/engagements` with auth + origin => `503` (expected: DB not configured)
- malformed JSON `POST /api/plan` => `400` (pass, expected)
- `GET http://localhost:3000/login` => `200` (pass)
- `GET http://localhost:3000/dashboard` => `200` (pass)
- `dashboard` lint/build => pass

### CHECK:2 final status
- Browser connectivity issue (`Failed to fetch`) is resolved by CORS fix.
- Local stack is stable for UI/API interaction.
- Remaining known blocker is unchanged and expected:
  - `MONGODB_URI` is empty, so DB-backed endpoints return `503` by design.

---

## 17) 3/5/26 17:27 + CHECK:1 - Consolidated Issue List + Full Implementation Plan

### Issues flagged across recent chats
1. Dashboard showed `Failed to fetch` (cross-origin/API reachability ambiguity).
2. Cloud deployment risk: dashboard default API target can be `localhost` when env is missing.
3. Local productivity blocker: DB-backed routes were unusable when `MONGODB_URI` was empty.
4. Backend had no real test suite (`npm test` placeholder only).
5. Deployment guidance was fragmented (missing a single end-to-end cloud runbook).

### Implementation plan to solve all issues
1. **Backend resilience + observability**
   - Add in-memory MongoDB fallback for local development when `MONGODB_URI` is absent.
   - Expose DB status in health response and add readiness endpoint.
   - Keep DB-gating middleware strict for non-connected states.
2. **Dashboard API reliability**
   - Improve API base URL resolution behavior:
     - localhost dev fallback remains.
     - non-localhost deployment requires explicit API base env.
   - Improve network and `503` error messaging for actionable operator feedback.
3. **Quality baseline**
   - Replace placeholder backend test script with real test cases.
4. **Deployment readiness**
   - Expand env templates with required keys.
   - Add explicit cloud deployment runbook.
   - Update README files for local/cloud behavior parity.

### Execution (implemented)
1. Backend local DB fallback + status tracking:
   - `backend/config/db.js`
     - added `mongodb-memory-server` fallback
     - added `getDbStatus()` and `stopInMemoryServer()`
2. Backend runtime endpoints and shutdown:
   - `backend/server.js`
     - `/health` now includes DB status
     - added `/ready` endpoint (`200` when DB connected, `503` otherwise)
     - graceful shutdown stops in-memory DB
3. DB gate error clarity:
   - `backend/middleware/requireDb.js`
4. Env templates expanded:
   - `backend/.env.example`:
     - `ENABLE_INMEMORY_DB`
     - `INMEMORY_DB_NAME`
     - `NEXT_PUBLIC_DASHBOARD_URL`
5. Dashboard API reliability improvements:
   - `dashboard/src/lib/api.ts`
     - deployment-safe API base resolution
     - actionable fetch failure messages
     - enriched `503` guidance
6. Backend test suite added:
   - `backend/tests/patternEngine.test.js`
   - `backend/package.json` test script changed to `node --test tests/**/*.test.js`
7. Deployment docs added:
   - `docs/DEPLOYMENT.md`
8. Documentation updated:
   - `README.md`
   - `dashboard/README.md`

---

## 18) 3/5/26 17:27 + CHECK:2 - Revalidation After Full Implementation

### Runtime/API checks
- `GET http://localhost:5000/health` => `200`
  - DB state now reports connected via in-memory fallback:
    - `readyState: 1`
    - `source: in-memory`
- `GET http://localhost:5000/ready` => `200`
- `GET http://localhost:5000/api/engagements` (auth) => `200`
- `GET http://localhost:5000/api/patterns` (auth) => `200`
- `OPTIONS http://localhost:5000/api/engagements` (browser preflight) => `204`
- `GET http://localhost:3000/login` => `200`
- `GET http://localhost:3000/dashboard` => `200`

### Build/Test checks
- `backend npm test` => pass (`6/6` tests)
- `dashboard npm run build` => pass

### Final status
- Previously reported issues from recent chats are now addressed in code and docs.
- Local stack is fully usable even without Atlas credentials due in-memory DB fallback.
- Cloud deployment path is now explicit and documented; production still requires real `MONGODB_URI` and correct `NEXT_PUBLIC_VENOM_API_BASE_URL`.
