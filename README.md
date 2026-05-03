# VENOM

Initial Week 1-7 scaffold for the VENOM project.

## Structure
- `backend/` Node.js API service
- `dashboard/` Next.js app (Week 3 implemented)
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

## Dashboard Quick Start
```bash
cd dashboard
npm install
npm run dev
```

Dashboard defaults to `http://localhost:3000` and calls backend at `http://localhost:5000`.

## API Endpoints
- `POST /api/engagements`
- `GET /api/engagements`
- `GET /api/engagements/:id`
- `POST /api/patterns`
- `GET /api/patterns`
- `GET /api/patterns/match?engagementId=...`
- `POST /api/plan`
- `GET /api/plan/engagement/:engagementId`
- `POST /api/learn`
- `GET /api/metrics/overview`
- `GET /api/metrics/alerts`
- `GET /api/metrics/progress`
- `GET /api/metrics/progress/:engagementId`
- `GET /api/execute/tools`
- `POST /api/execute`
- `GET /api/execute/:id`
- `GET /api/execute/engagement/:engagementId`

## Auth Headers
- `x-api-key`: must match `VENOM_API_KEY` when configured
- `x-user-id`: optional, defaults to `local-dev-user`
- `x-user-role`: optional, defaults to `operator`

## Local Troubleshooting
- If dashboard shows `Failed to fetch`, verify:
  1. Backend is running on `http://localhost:5000`
  2. `NEXT_PUBLIC_VENOM_API_BASE_URL` points to that backend
  3. `CORS_ORIGINS` includes your dashboard origin (for example `http://localhost:3000`)
