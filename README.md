# Yorki

Internal task board with staff/admin roles, invitations, private attachments, optional email notifications, and Google Calendar integration.

**Runtime:** Next.js 16, React 19, Node.js 24 LTS recommended (22+ required), SQLite through better-sqlite3. Current authentication uses SQLite sessions and HttpOnly cookies. The `supabase/` folder and older deployment guides are historical; they do not configure the current app.

## Workspace

The desktop sidebar links to My tasks, Team board, and a calendar agenda. Switch between board and list views, filter by assignee/priority/due date, or use the task totals to focus on overdue work. On phones the default is a task list with bottom navigation; the Board view retains your configured columns. All totals and views use the signed-in user’s authorized tasks.

## Local development

```bash
npm ci
cp env.production.example .env.local
npm run dev
```

For development, set `APP_URL=http://localhost:3000` and a local `YORKI_DB_DIR` in `.env.local`. Production runs under `/task`; development runs at `/`.

The app creates its SQLite schema and initial board automatically. The seeded administrator is `george@yorki`; it has **no usable password** until explicitly initialized. Set a unique password on an existing active account using the operator-only script:

```bash
YORKI_DB_DIR=/absolute/path/to/data \
YORKI_ADMIN_EMAIL=george@yorki \
YORKI_ADMIN_PASSWORD='<unique password of 12+ characters>' \
node scripts/set-password.js
```

Use secure secret entry rather than leaving passwords in shell history. The script honors `YORKI_DB_PATH` over `YORKI_DB_DIR`, never prints passwords, and revokes existing sessions/invites. Existing production accounts and passwords are not overwritten by deployment.

## Checks

```bash
npm test
npm run type-check
npm run lint
npm run build
npm run test:browser
npm audit --omit=dev
```

The browser smoke uses an isolated temporary SQLite database and port 3100. It requires Chromium at `/usr/bin/chromium` (override `CHROMIUM_PATH` for another installation). It tests actual production login and role guards, mobile staff visibility, attachments/uploads, internal-note isolation, deactivation, and logout. It never accesses the live host. Lint currently reports existing UI/compiler recommendation warnings but no errors; React Compiler is not enabled.

## Production configuration

- `APP_URL=https://task.goldenstoneworks.com/task` for notification and invitation links.
- `YORKI_DB_DIR=/var/lib/yorki` or explicit absolute `YORKI_DB_PATH`. Keep data outside releases. Private uploads live beside the DB in `uploads/`.
- SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`) or `RESEND_API_KEY` for delivery.
- Optional calendar: `GOOGLE_CALENDAR_ID`, `GOOGLE_CALENDAR_TIME_ZONE`, and `GOOGLE_SERVICE_ACCOUNT_JSON_PATH`. Keep credentials outside `public/` and preferably outside release directories.
- HTTPS is required for production session cookies. Use a supervised service and nginx/reverse proxy. Never publicly cache authenticated HTML or RSC responses.

See [deployment procedure](docs/DROPLET-UPDATE.md) and [readiness findings](docs/PRODUCTION-READINESS.md). The staged deployment script builds before stopping the old service, takes a verified database/uploads backup, retains the previous release, and rolls code back on failure without restoring an older database. The host's actual service, data locations, and free space must be verified before use.
