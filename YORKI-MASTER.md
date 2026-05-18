# Yorki — Master Project Document
> Last updated: April 2026  
> Live URL: https://task.goldenstoneworks.com  
> Local: http://localhost:3001

---

## What Yorki Is

Internal task and request management app. Staff submit requests, admins manage them on a Kanban board. Built with Next.js 14, SQLite, Docker, deployed on DigitalOcean.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Database | SQLite via `better-sqlite3` |
| Auth | bcrypt + session cookies |
| Styling | Tailwind CSS + DM Sans font |
| Drag & Drop | @dnd-kit |
| Email | Resend (optional) |
| Hosting | DigitalOcean Droplet |
| Reverse Proxy | nginx + Let's Encrypt SSL |
| Container | Docker + Docker Compose |
| Backups | rclone → Google Drive |

---

## What Was Built (Completed)

### Authentication
- Session-based login with bcrypt password hashing
- HttpOnly session cookie, 30-day expiry
- Rate limiting: 5 failed attempts per email per 15 min
- Expired sessions pruned on every login
- Deactivated users blocked at login and session lookup
- `requireRole()` redirects to `/login` if unauthenticated
- Sign out destroys session and clears cookie

### User Invite System
- Admin creates user → unique invite token generated (48h expiry)
- Invite page at `/invite/[token]` — public, no auth
- Shows user name, email, role badge
- Password strength indicator
- Token marked `used_at` after password set — cannot be reused
- Expired/used tokens show clear error page
- Resend invite button (✉️) per user in Admin → Users
- Without `RESEND_API_KEY`: invite URL logged to terminal
- With `RESEND_API_KEY`: sends branded HTML email via Resend
- ✉️ and 🔑 buttons per user in Admin → Users panel

### Kanban Board
- Drag and drop columns (admin only)
- **Auto-status on drag**: dropping card to Completed → status = completed, Pending → pending, Inbox → new, Archive → archived
- Status updates live in browser without page reload
- Staff only see tasks assigned to them
- Task detail panel — priority badge + top border color
- Assign task to user via dropdown in detail panel
- Complete, reopen, archive, delete tasks
- Priority levels: Low · Normal · High · Urgent (color-coded)
- Search by title, description, submitter

### Task Detail Panel
- Slides in from right on desktop
- Slides up as bottom sheet on mobile
- Shows: meta info, attachments grid, address, checklist, description, comments
- Image lightbox — click image → full screen modal
- Non-image attachments open in new tab
- Internal notes (admin only, amber styling)

### Submit Form
- Title, description, priority, due date, notes
- **Address field** — full address block (multiline)
- **Dynamic checklist** — add/remove items, type label, check/uncheck
- File attachments (images, PDFs, docs up to 10MB)
- After submit → redirects to dashboard immediately
- Files saved to `public/uploads/<task_id>/`

### File Attachments
- Upload via Submit form or directly in task detail
- Saved to `public/uploads/<task_id>/`
- Images shown as grid in task detail panel
- Click image → lightbox modal
- Non-image files show file icon, open in new tab

### Admin Settings
- **Settings** — workspace info + light/dark theme toggle
- **Email** — recipients, subject prefix, notification triggers
- **Columns** — create, rename, recolor, delete columns
- **Users** — create, set roles, activate/deactivate, set password, resend invite

### Design System
- Yorki brand: Navy `#2F3650` · Steel `#6A97C4` · Bronze `#A6784A`
- Full navy (50–900) and bronze (50–900) Tailwind scales
- Light and dark mode, user-toggleable
- Logo-only nav (no text)
- DM Sans font (Google Fonts)
- `rounded-2xl` cards with hover lift + shadow
- Priority badge colors from brand palette
- Smooth animations: fade-in, slide-in-right, slide-up (mobile)

### Mobile
- Bottom sheet panel on mobile (slides up from bottom)
- Horizontal swipe to see columns
- Bottom navigation bar
- Touch-friendly drag with 5px activation threshold
- Bottom padding clears mobile nav on all pages

---

## Hosting & Deployment

**Server:** DigitalOcean Droplet  
**IP:** `146.190.130.170`  
**SSH:** `ssh root@146.190.130.170`  
**App path:** `/var/www/yorki`  
**DB:** `/var/lib/docker/volumes/yorki_yorki_data/_data/yorki.db`  
**Uploads:** `/var/lib/docker/volumes/yorki_yorki_uploads/_data/`

### Deploy an update

```bash
# 1. Local machine — upload files
rsync -avz --exclude node_modules --exclude .next --exclude data --exclude .git \
  ./ root@146.190.130.170:/var/www/yorki/

# 2. On the droplet — clean stray files then rebuild
ssh root@146.190.130.170
cd /var/www/yorki
find . -name "admin-layout.tsx" -delete
find . -name "auth-login-page.tsx" -delete
find . -path "*/lib/supabase" -type d -exec rm -rf {} + 2>/dev/null
docker compose build && docker compose up -d
```

### Quick edits (no full rsync needed)
```bash
nano /var/www/yorki/src/path/to/file.tsx
cd /var/www/yorki && docker compose build && docker compose up -d
```

### Common commands
```bash
docker compose logs -f              # live logs
docker compose logs --tail=50       # last 50 lines
docker compose ps                   # container status
docker compose restart yorki        # restart without rebuild
nginx -t && systemctl reload nginx  # reload nginx config
certbot certificates                # check SSL expiry
```

---

## Known Issues & Bugs

### 🔴 Active Issues

**Logo disappears on deploy**
- Root cause: rsync uploads stale files from local machine that reference `/Yorki.png` instead of `/task/Yorki.png`
- Fix: always run `grep -r "Yorki.png" /var/www/yorki/src --include="*.tsx"` after rsync and fix any `/Yorki.png` to `/task/Yorki.png` before rebuilding
- Permanent fix: ensure all local files use `/task/Yorki.png` hardcoded

**Browser "not secure" warning**
- Certificate is valid (confirmed)
- Likely mixed content — some resource loading over HTTP
- Check: Chrome DevTools → Console → look for blocked HTTP requests
- Suspect: Google Fonts or an image URL using `http://`

**SQLite WAL files on crash**
- Stale `.db-shm` and `.db-wal` files corrupt the DB on hard stops
- Fix: `rm data/yorki.db data/yorki.db-shm data/yorki.db-wal` then restart
- Prevention: always use `docker compose down` not `kill`

**Seed runs partially**
- On fresh install, `boards` gets seeded but `users` may not
- Fix: run the manual insert command after first page load (see Setup section)

### 🟡 Known Limitations

- No forgot password flow — admin must use 🔑 button to reset
- Email requires `RESEND_API_KEY` + verified domain in Resend
- Rate limiting is in-memory — resets on server restart
- Checklist in task detail is read-only (cannot check items from panel, only view)
- `admin-layout.tsx` stray file must be manually deleted after every rsync

---

## Setup From Scratch (Fresh Server)

```bash
# 1. SSH into droplet
ssh root@YOUR_IP

# 2. Install dependencies
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
apt install -y nginx certbot python3-certbot-nginx sqlite3 nodejs npm
npm install -g bcryptjs

# 3. Upload project
rsync -avz --exclude node_modules --exclude .next --exclude data --exclude .git \
  ./ root@YOUR_IP:/var/www/yorki/

# 4. Create .env
cd /var/www/yorki
nano .env
# Add: APP_URL=https://yourdomain.com

# 5. Set up nginx + SSL
cp nginx/taskflow.conf /etc/nginx/sites-available/yorki
sed -i 's/YOUR_DOMAIN/yourdomain.com/g' /etc/nginx/sites-available/yorki
ln -s /etc/nginx/sites-available/yorki /etc/nginx/sites-enabled/yorki
mkdir -p /etc/nginx/snippets
cat > /etc/nginx/snippets/proxy-params.conf << 'NGINX'
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection 'upgrade';
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_cache_bypass $http_upgrade;
NGINX
nginx -t && systemctl start nginx
certbot --nginx -d yourdomain.com

# 6. Build and start
docker compose build && docker compose up -d

# 7. Seed the database (visit the site in browser first, then stop server)
# Visit https://yourdomain.com in browser to trigger DB creation
docker compose stop yorki

# 8. Insert first user manually
HASH=$(node -e "const b = require('/usr/lib/node_modules/bcryptjs'); console.log(b.hashSync('yorki1234', 12));")
sqlite3 /var/lib/docker/volumes/yorki_yorki_data/_data/yorki.db \
  "INSERT OR IGNORE INTO users (id,full_name,display_name,email,department,role,avatar_url,is_active,password_hash,created_at,updated_at) VALUES ('11111111-1111-1111-1111-111111111111','George','George','george@yorki',null,'super_admin',null,1,'$HASH',datetime('now'),datetime('now'));"

# 9. Start again
docker compose start yorki
```

**Login:** `george@yorki` / `yorki1234` — change immediately via Settings → Users → 🔑

---

## Activity Log & Observability Plan

The `activity_logs` table already records every action in the DB. No new DB changes needed.

### Phase 1 — Add to existing Settings area (recommended next step)

**New file:** `src/app/(protected)/admin/activity/page.tsx`

```tsx
// Read-only activity log viewer
// Shows last 100 entries: time, actor, action, task
// No new DB tables — data already being written
import { getDb } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { formatRelativeDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function ActivityPage() {
  const user = await getSessionUser()
  if (!user || user.role === 'staff') redirect('/dashboard')

  const db   = getDb()
  const logs = db.prepare(`
    SELECT a.*, u.full_name, u.email
    FROM activity_logs a
    LEFT JOIN users u ON u.id = a.actor_id
    ORDER BY a.created_at DESC
    LIMIT 100
  `).all() as Array<{
    id: string; action: string; entity_type: string
    created_at: string; full_name: string | null; email: string | null
    metadata: string; task_id: string | null
  }>

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Activity Log</h1>
      <div className="divide-y divide-border border border-border rounded-xl overflow-hidden">
        {logs.map(log => (
          <div key={log.id} className="flex items-center gap-4 px-4 py-3 bg-card text-sm">
            <span className="text-muted-foreground text-xs w-28 shrink-0">
              {formatRelativeDate(log.created_at)}
            </span>
            <span className="font-medium text-foreground w-32 shrink-0 truncate">
              {log.full_name ?? log.email ?? 'System'}
            </span>
            <span className="text-muted-foreground flex-1 truncate">
              {log.action.replace(/_/g, ' ')}
              {log.task_id ? ` · task ${log.task_id.slice(0, 8)}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

Add to admin nav in `src/app/(protected)/admin/layout.tsx`:
```tsx
import { Activity } from 'lucide-react'
// Add to adminNav array:
{ href: '/admin/activity', label: 'Activity', icon: Activity },
```

### Phase 2 — Health check endpoint

**New file:** `src/app/api/health/route.ts`

```ts
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET() {
  try {
    const db = getDb()
    const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    const users     = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n
    const tasks     = (db.prepare('SELECT COUNT(*) as n FROM tasks WHERE deleted_at IS NULL').get() as { n: number }).n
    const sessions  = (db.prepare('SELECT COUNT(*) as n FROM sessions WHERE expires_at > ?').get(new Date().toISOString()) as { n: number }).n

    return NextResponse.json({
      status: 'ok', integrity: integrity.integrity_check,
      users, tasks, sessions, time: new Date().toISOString(),
    })
  } catch (err) {
    return NextResponse.json({ status: 'error', error: String(err) }, { status: 500 })
  }
}
```

Visit: `https://task.goldenstoneworks.com/task/api/health`

### Phase 3 — Global error boundary

**New file:** `src/app/error.tsx`

```tsx
'use client'
import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[Yorki Error]', { message: error.message, digest: error.digest, time: new Date().toISOString() })
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <button onClick={reset} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm">
          Try again
        </button>
      </div>
    </div>
  )
}
```

### Viewing logs right now (no code changes needed)

```bash
# All app logs
docker compose logs -f

# Errors only
docker compose logs | grep -i "error\|warn\|failed"

# Auth events
docker compose logs | grep "\[auth\]"

# Email/invite events  
docker compose logs | grep "\[Email\|Invite\]"

# nginx access log
tail -f /var/log/nginx/access.log

# Health check
curl https://task.goldenstoneworks.com/task/api/health

# DB integrity check
docker compose exec yorki node -e "
const db = require('./node_modules/better-sqlite3')('/app/data/yorki.db');
console.log(db.prepare('PRAGMA integrity_check').get());
console.log('Users:', db.prepare('SELECT COUNT(*) as n FROM users').get());
console.log('Tasks:', db.prepare('SELECT COUNT(*) as n FROM tasks WHERE deleted_at IS NULL').get());
"
```

---

## Key File Map

```
src/lib/auth.ts                           — bcrypt, sessions, requireRole, rate limiting
src/lib/db.ts                             — SQLite schema + seed
src/lib/local-data.ts                     — all DB query functions
src/lib/actions/tasks.ts                  — board data, task CRUD, auto-status on drag
src/lib/actions/settings.ts              — users, columns, email settings, invites
src/lib/actions/invite.ts                — invite create/validate/accept
src/lib/actions/email.ts                  — Resend email templates
src/lib/actions/activity.ts              — comments, activity log

src/app/(auth)/login/                     — login page + form + server action
src/app/(auth)/invite/[token]/           — invite acceptance page + form
src/app/(protected)/dashboard/           — kanban board
src/app/(protected)/submit/              — new request form (address + checklist)
src/app/(protected)/archive/             — archived tasks
src/app/(protected)/admin/               — settings, users, columns, email, activity

src/components/board/KanbanBoard.tsx     — DnD, search, live status updates
src/components/board/BoardColumn.tsx     — droppable column
src/components/board/TaskCard.tsx        — sortable card with priority border
src/components/tasks/TaskDetailPanel.tsx — slide panel, attachments, address, checklist
src/components/layout/AppNav.tsx         — top nav, user menu, avatar

src/styles/globals.css                   — Yorki design tokens, animations

scripts/set-password.js                  — one-time password setter (run locally)
scripts/backup.sh                        — rclone backup to Google Drive
nginx/taskflow.conf                      — nginx config template
Dockerfile                               — production Docker build
docker-compose.yml                       — container + volume config
data/yorki.db                            — SQLite database (dev only)
public/uploads/                          — uploaded files (dev only)
public/Yorki.png                         — logo
```

---

## Default Credentials

| Email | Password | Role |
|-------|----------|------|
| george@yorki | yorki1234 | Super Admin |

**Change immediately via Settings → Users → 🔑**

---

## Not Yet Built

- [ ] Forgot password flow
- [ ] Activity log UI page in admin (code template above, ready to implement)
- [ ] Health check endpoint (code template above, ready to implement)  
- [ ] Global error boundary (code template above, ready to implement)
- [ ] Filter panel (button exists, disabled)
- [ ] Checklist items checkable from task detail panel (currently read-only display)
- [ ] Due date editing from detail panel
- [ ] Title/description inline editing from detail panel
- [ ] In-app notifications
- [ ] Email on comment
- [ ] Backup restore script
- [ ] rclone Google Drive setup docs
