# UI Simplification Audit

## Buttons Removed or Hidden

| Button | Current | New | Reason |
|--------|---------|-----|--------|
| View Latest Plan | Visible | Hidden | Plan now appears automatically in report context |
| View Latest Probe | Visible | Hidden | Probe outputs are consolidated into report findings |
| Load Compliance | Visible | Hidden | Compliance summary auto-loads in report view |
| Match Patterns | Visible | Hidden | Pattern matching runs in orchestration flow |
| Run Learning | Visible | Hidden | Learning stage runs automatically after execution |
| Verify Evidence | Visible | Hidden | Evidence chain handled in backend lifecycle |
| Run Nmap TCP | Visible | Hidden | Tool selection is auto-orchestrated |
| Run Nuclei | Visible | Hidden | Tool selection is auto-orchestrated |
| Run Nikto | Visible | Hidden | Tool selection is auto-orchestrated |
| Run SQLMap Detect | Visible | Hidden | Tool selection is auto-orchestrated |
| Download Report (manual mode) | Visible | Hidden | One-click smart download in report action bar |
| Download Sanitized HTML | Visible | Hidden | Single default download surface to reduce choice overload |
| Download Investor-Ready PDF | Visible | Hidden | Single default download surface to reduce choice overload |
| Email PDF Report | Visible | Hidden | Deferred to backend export workflows |

## New Primary UX Surface

- `Login` (unchanged auth screen)
- `New Scan` (`/dashboard/new-scan`)
- `Report View` (`/dashboard/report/:id`) with integrated `Ask AI`
- `Recent Scans` (`/dashboard/recent`) as lightweight report access list

## Outcome

- Old 22+ button dashboard removed as default entry surface.
- Operator journey reduced to: **enter target -> start scan -> view report + ask AI**.
- Existing backend APIs and orchestration services remain intact and reused.
