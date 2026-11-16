# Yorki release readiness — 2026-11-16

Reviewed baseline: `c2798f4`. This update is a production release candidate, not evidence that the live server has been remediated. Host access is through the user's DigitalOcean web console. Nothing has been deployed by this workspace.

## Critical live finding

Read-only HTTP requests without a Cookie header to `https://task.goldenstoneworks.com/task/dashboard` and `/task/admin/users` returned HTTP 200 with board and user-management content rather than a login redirect. The admin response included `x-nextjs-cache: HIT` and `Cache-Control: s-maxage=31536000, stale-while-revalidate`. No mutation was attempted. This differs from the tested repository build. The deployed source, service and caching rules must be inspected; the root cause has not been confirmed.

HTTP redirects to HTTPS work. Inspected app responses included frame/content-type/referrer headers, but no HSTS. The public health response exposed record counts and a May timestamp when observed in November; it was not reliable evidence of fresh liveness. DNS resolved to `146.190.130.170` during the check. A server screenshot showed roughly 95% disk utilization.

## Changes prepared

- Upgrade Next.js to 16.4.6 and React/React DOM to 19.3.1; migrate async route parameters and update email/form dependencies. Remove the unused React Email package and no-op middleware. Node 22+ required; Node 24 LTS recommended and used in Docker.
- Explicitly render protected pages dynamically. Require administrator authorization for invite creation; protect super-admin accounts from lower-role account management/reset actions. Validate role changes at runtime.
- Make invite redemption atomic after hashing and reject disabled users. Password reset revokes existing sessions and outstanding invites. Fresh databases have no known password; operator reset script accepts explicit credentials and honors configured DB paths. Existing passwords are preserved and must be reviewed/rotated as appropriate.
- Remove password hashes from returned profiles, keep email helpers server-only, remove the unused unauthenticated audit-writing action, and escape user content in HTML emails.
- Filter internal notes before staff board hydration, preserve server-managed assignment/sharing fields during staff edits, and validate move destinations/positions.
- Persist atomic login-attempt reservations in SQLite (5 attempts per email per 15 minutes), add session indexes, and initialize migrations transactionally. Limit reservations survive process restarts and share across workers using the same database. Network-level request limiting is still required against distributed abuse.
- Service worker v2 caches only immutable build assets and public PWA resources; activation drops old private caches. Remove the tracked public-upload example. Legacy files can be copied to private storage without deleting originals, and DB attachment URLs updated to authenticated downloads.
- Make health checks dynamic, cheap, no-store, and free of record counts/internal exception details. Add production HSTS and remove unrestricted image remote-host configuration.
- Replace historical Supabase backup scripts with SQLite's online backup API plus uploads/environment copies, standalone snapshot integrity checks, private backup permissions, manifest/completion marker. Do not copy live WAL/SHM over snapshots.
- Add staged deployment with disk/Node/service/DB preconditions, isolated build before downtime, backup before swap, retained previous code, anonymous access checks, and code-only rollback without overwriting a live database.

## Validation and limits

- Ten focused regression tests cover invite permissions/races/revocation, profile redaction, private-cache bypass, persistent rate limits, staff/internal-note boundaries, preserved assignment/sharing, and a real SQLite WAL snapshot restored with private uploads.
- Production build and TypeScript validation passed on Node 24. Lint passed with existing UI/compiler recommendation warnings; React Compiler is not enabled.
- Headless Chromium smoke tests cover real admin login/users, anonymous redirects, mobile staff task visibility, internal-note isolation, deactivation, logout, and authenticated/private attachment and upload boundaries. Tests run against isolated local data, not production.
- `npm audit --omit=dev`: **0 known vulnerabilities** with the prepared lockfile. Full audit retains **7 moderate development-tool advisories** through typescript-eslint/minimatch; no compatible upstream fix resolved those automatically at review time. An audit result is not a security guarantee.
- Build warnings remain for an existing icon Edge runtime and dynamic calendar-credential tracing. No live email or Calendar credentials were available for integration testing.
- Deployment scripts have shell syntax checks and backup/legacy-storage regression coverage. The real systemd unit, nginx/cache rules, Node upgrade, disk cleanup, scheduled off-host backups and full server rollback are not tested from this workspace. The staged script refuses unsupported layouts and insufficient space; it is not a substitute for host inspection.
- SQLite remains a single-writer system. No concurrent-user capacity target has been measured. Confirm expected workload, run realistic load tests, monitor memory/disk and request latency, and rehearse an off-host restore before expanding usage.

See [the Droplet procedure](DROPLET-UPDATE.md) for prerequisites and the console workflow. Older deployment documents are historical and should not be mixed with the current procedure.
