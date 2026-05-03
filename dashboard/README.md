# VENOM Dashboard

Week 3 dashboard implementation using Next.js App Router + Tailwind CSS.

## Features
- `/login` local session capture (email, role, API key)
- `/dashboard` engagement list view
- New engagement creation form
- Per-engagement plan actions (`Generate Plan`, `View Latest Plan`)
- Per-engagement safe probe actions (`Run Headers Probe`, `View Latest Probe`)
- Per-engagement Week 6 actions (`Match Patterns`, `Run Learning`)
- Week 7 telemetry (`Metrics`, `Alerts`, live progress bars)
- API integration with Week 2 backend routes

## Local Run
```bash
cd dashboard
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment
Set backend URL before running in production-like setups:

```bash
NEXT_PUBLIC_VENOM_API_BASE_URL=http://localhost:5000
```

If omitted, the app defaults to `http://localhost:5000`.

## Backend Requirements
- `VENOM_API_KEY` must be set in backend `.env`
- Use the same key in login form (`VENOM API Key`)
- Backend `CORS_ORIGINS` must include dashboard origin (for local dev: `http://localhost:3000`)
