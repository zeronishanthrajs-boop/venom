# Week 2 Progress

## Implemented
- API routes added:
  - `POST /api/engagements`
  - `GET /api/engagements/:id`
  - `POST /api/patterns`
  - `GET /api/patterns`
- Authorization middleware:
  - Header-based API key check via `VENOM_API_KEY` and `x-api-key`
  - Request user context from `x-user-id`, `x-user-role`
- Activity logging middleware:
  - Logs method, path, user, status code, and latency
- Engagement scope/constraint middleware:
  - Validates `targetUrl`
  - Enforces `scope.allowedDomains`
  - Blocks restricted paths
  - Blocks expired authorization windows
- Database readiness middleware:
  - Returns `503` when `MONGODB_URI` is not configured/connected
- New model:
  - `Engagement` with target, scope, authorization, and constraint fields

## Smoke Test Results (Local)
- `GET /` -> `200`
- `GET /api/patterns` without API key -> `401`
- `GET /api/patterns` with API key and no DB -> `503`
- `POST /api/engagements` with expired authorization -> `403`

## Pending To Complete Week 2
- Connect MongoDB Atlas (`MONGODB_URI`) for full CRUD verification
- Execute successful `POST /api/engagements`
- Execute successful `POST /api/patterns` and `GET /api/patterns`
- Deploy and validate on Render
