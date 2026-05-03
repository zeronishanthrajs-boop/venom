# VENOM Deployment Runbook

## Objective
Deploy dashboard + backend with correct cross-origin configuration so API calls work in cloud.

## 1) Backend Deployment (Render)
1. Create a new Web Service from this GitHub repo.
2. Root directory: `backend`
3. Build command: `npm install`
4. Start command: `npm start`
5. Set environment variables:
   - `PORT=5000`
   - `VENOM_API_KEY=<strong-random-key>`
   - `MONGODB_URI=<atlas-uri>`
   - `CORS_ORIGINS=https://<dashboard-domain>`
   - `ENABLE_INMEMORY_DB=false`
6. Deploy and verify:
   - `GET https://<backend-domain>/health` -> `200`
   - `GET https://<backend-domain>/ready` -> `200`

## 2) Dashboard Deployment (Vercel)
1. Import the same repository and set root directory to `dashboard`.
2. Set environment variable:
   - `NEXT_PUBLIC_VENOM_API_BASE_URL=https://<backend-domain>`
3. Deploy and verify:
   - Open `https://<dashboard-domain>/login`
   - Login with `VENOM_API_KEY` value from backend
   - Open dashboard and click `Refresh`

## 3) Cross-Origin Validation
From a terminal:

```bash
curl -i -X OPTIONS "https://<backend-domain>/api/engagements" \
  -H "Origin: https://<dashboard-domain>" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: x-api-key,x-user-id,x-user-role,content-type"
```

Expected:
- `204 No Content`
- `Access-Control-Allow-Origin: https://<dashboard-domain>`

## 4) Common Failure Map
- `Failed to fetch` in dashboard:
  - Check `NEXT_PUBLIC_VENOM_API_BASE_URL`
  - Check backend `CORS_ORIGINS`
- `503 Database unavailable`:
  - Check backend `MONGODB_URI`
  - Check backend `/ready`
- `401 Unauthorized`:
  - API key mismatch between login form and backend `VENOM_API_KEY`
