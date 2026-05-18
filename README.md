# TaskFlow — Internal Task Management System

## Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Copy env template and fill in your Supabase credentials
cp .env.example .env.local

# 3. Run the database migration
# → Open Supabase Dashboard → SQL Editor → New Query
# → Paste contents of: supabase/migrations/001_initial_schema.sql
# → Click Run

# 4. Create your first Super Admin user
# → Supabase Dashboard → Authentication → Users → Invite user
# → After user confirms email, run in SQL Editor:
#   UPDATE public.user_profiles
#   SET role = 'super_admin', full_name = 'Your Name'
#   WHERE email = 'your@email.com';

# 5. Start dev server
npm run dev

# 6. Open http://localhost:3000/task
```

## Production Deployment

### Prerequisites
- Pi 4 (4GB RAM recommended) booting from USB SSD (not SD card)
- Docker + Docker Compose installed
- Nginx installed
- Domain pointed to Pi IP, or Tailscale Funnel configured

### Recommended deploy flow

Build on your local machine, then sync the built app to the server.

```bash
# local machine
rm -rf .next
npm run build
rsync -avz --exclude node_modules --exclude data --exclude .git ./ root@YOUR_SERVER:/var/www/yorki/

# server
cd /var/www/yorki
npm ci --ignore-scripts
npm rebuild better-sqlite3
pkill -f "next-server" || true
nohup node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000 > /var/log/yorki-app.log 2>&1 &
```

This is the runtime that matched production successfully.

### Docker

Docker remains supported, but the most stable production path learned during setup was:
- build locally
- rsync `.next`
- run with `next start` on the server

### Update Deployment

```bash
cd /var/www/yorki
pkill -f "next-server" || true
nohup node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000 > /var/log/yorki-app.log 2>&1 &
```

### v3 Reliability Deploy (recommended)

```bash
cd /var/www/yorki
./scripts/deploy-safe.sh
```

This includes:
- automatic pre-deploy backup
- memory-safe build
- health checks
- auto-rollback on failed deploy

Runbook:
- `docs/V3-RELIABILITY-RUNBOOK.md`

### Useful Commands

```bash
# View live logs
docker logs -f taskflow

# Check memory usage
docker stats taskflow

# Restart app
docker compose restart taskflow

# Shell into container (debugging)
docker exec -it taskflow sh
```

## Google Calendar Sync

Yorki supports Google Calendar sync through a Google service account.

Required production env:

```bash
GOOGLE_CALENDAR_ID=info@yourdomain.com
GOOGLE_CALENDAR_TIME_ZONE=America/Los_Angeles
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=/var/www/yorki/google-service-account.json
```

Setup:
- create a Google Cloud service account and JSON key
- place the JSON file on the server
- share the target Google Calendar with the service-account email
- grant `Make changes to events`

Behavior:
- task create creates a calendar event
- task update updates the linked event
- task delete deletes the linked event
- if Google sync fails, Yorki logs the error and still completes the task action

## Database Storage

Yorki uses SQLite and can now store the DB outside the app folder so rebuilds do not touch it.

Recommended production env:

```bash
YORKI_DB_DIR=/var/lib/yorki
# optional explicit file path instead of directory:
# YORKI_DB_PATH=/var/lib/yorki/yorki.db
```

Recommended setup:
- create `/var/lib/yorki`
- keep that directory outside `/var/www/yorki`
- back up `/var/lib/yorki/yorki.db` with rclone 3 times per day
- also back up `-wal` and `-shm` files if they exist during copy, or run a SQLite checkpoint before backup

## Architecture Notes

### Security Model
- `NEXT_PUBLIC_*` variables — safe for browser, inlined at build time
- `SUPABASE_SERVICE_ROLE_KEY` — server-side only, bypasses RLS
- All mutations go through Server Actions — service key never leaves the server
- Row Level Security enabled on every table

### /task Subfolder
The app lives at `yoursite.com/task/`. This is configured via:
- `next.config.mjs` → `basePath: '/task'`
- Nginx proxies `/task` → `localhost:3000`
- All Next.js routes, links, and API calls automatically respect this

### Future Mobile/Desktop Packaging
When wrapping as Electron, Capacitor (Android/iOS), or Tauri:
- Point the WebView to your Pi URL: `https://yoursite.com/task`
- Do NOT connect directly to Supabase from the wrapper
- All secrets stay on the Pi — wrappers are just a browser shell
- Rotating Supabase credentials requires only a `.env.local` update on Pi

## Project Structure

```
src/
├── app/
│   ├── (auth)/login/          Login page + form
│   ├── (protected)/           Auth-guarded pages
│   │   ├── dashboard/         Kanban board
│   │   ├── submit/            Staff submission form
│   │   ├── archive/           Archive view
│   │   └── admin/             Settings panels (Phase 2)
│   └── layout.tsx             Root layout + theme + brand colors
├── components/
│   ├── board/                 KanbanBoard, BoardColumn, TaskCard
│   ├── tasks/                 TaskDetailPanel
│   ├── layout/                AppNav, Avatar
│   └── forms/                 (Phase 2: dynamic form renderer)
├── lib/
│   ├── supabase/
│   │   ├── client.ts          Browser client (anon key only)
│   │   └── server.ts          Server client (service key + requireRole)
│   ├── actions/
│   │   ├── tasks.ts           Task CRUD + board operations
│   │   ├── activity.ts        Audit log + comments
│   │   └── email.ts           Resend email templates
│   ├── types/index.ts         All TypeScript types
│   └── utils/index.ts         Helpers, formatters, constants
├── middleware.ts              Auth guard on every request
└── styles/globals.css         Design tokens, dark mode, animations
```

## Phase 2 Checklist (after MVP validation)
- [ ] Dynamic form field builder (admin drag-and-drop field configuration)
- [ ] Supabase Realtime board updates (cards move live across browser tabs)
- [ ] Advanced filters (priority, assignee, date range, labels)
- [ ] In-app notification tray
- [ ] Activity log read UI
- [ ] Email template customisation panel
- [ ] File upload API route (currently form captures files, upload pending)

## Phase 3 Checklist
- [ ] Multi-board support
- [ ] Electron/Tauri desktop wrapper
- [ ] Capacitor Android APK
- [ ] Capacitor iOS wrapper
- [ ] Reporting dashboard
