# Security Policy

## Secrets

- Keep API keys, database URIs, SMTP credentials, webhook URLs, and realtime tokens out of source control.
- Store production secrets only in the deployment provider secret store.
- Use `backend/.env.example` and `dashboard/.env.example` as templates only.
- Rotate exposed or suspected-compromised secrets immediately.

## Rotation Guidance

- Rotate `VENOM_API_KEY`, `VENOM_REALTIME_SECRET`, dashboard session secrets, and provider API keys at least every 90 days.
- Rotate `GEMINI_API_KEY`, `NVD_API_KEY`, SMTP credentials, Slack webhooks, and Jira tokens when staff access changes.
- After rotation, restart affected services and confirm health endpoints return successfully.

## Dependency Checks

- Run `npm audit --audit-level=high` in `backend/` and `dashboard/` before release.
- CI enforces high-severity audit checks, lint, type checking, and tests.

## Reporting

Report vulnerabilities privately to the project owner with reproduction steps, affected version or commit, and impact summary.
