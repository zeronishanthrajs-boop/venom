# VENOM Dashboard

Week 3 dashboard implementation using Next.js App Router + Tailwind CSS.

## Features
- `/login` private credential gate (server-side validated)
- `/dashboard` engagement list view
- New engagement creation form
- Per-engagement plan actions (`Generate Plan`, `View Latest Plan`)
- Per-engagement safe probe actions (`Run Headers Probe`, `View Latest Probe`)
- Per-engagement Week 6 actions (`Match Patterns`, `Run Learning`)
- Week 7 telemetry (`Metrics`, `Alerts`, live progress bars)
- API bridge route (`/api/backend/*`) that forwards to backend with server-held API key

## Local Run
```bash
cd dashboard
copy .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment
Set environment before running:

```bash
NEXT_PUBLIC_VENOM_API_BASE_URL=http://localhost:5000
VENOM_BACKEND_BASE_URL=http://localhost:5000
VENOM_BACKEND_API_KEY=replace-with-backend-key
VENOM_DASHBOARD_LOGIN_EMAIL=owner@example.com
VENOM_DASHBOARD_LOGIN_PASSWORD=replace-with-password
VENOM_DASHBOARD_SESSION_SECRET=replace-with-long-random-secret
```

Behavior:
- Login must match configured email + password.
- Browser never sends backend API key directly; server bridge injects it.
- `VENOM_BACKEND_BASE_URL` must be reachable from dashboard runtime.

## Backend Requirements
- Backend `VENOM_API_KEY` must match dashboard `VENOM_BACKEND_API_KEY`.
- Backend `CORS_ORIGINS` should include dashboard origin for direct calls and operational safety.
