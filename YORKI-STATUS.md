# Yorki — Project Status

> Last updated: April 2026  
> Stack: Next.js 14 · SQLite (better-sqlite3) · bcrypt · Tailwind · DnD Kit

---

## ✅ Working

### Authentication
- Session-based login with bcrypt password verification
- HttpOnly session cookie, 30-day expiry
- `requireRole()` redirects to `/login` if unauthenticated
- Sign out destroys session and clears cookie
- Login page at `/login` with Yorki branding

### User Invite Flow
- Admin creates user → invite token generated (48h expiry) → stored in `invites` table
- Invite page at `/invite/[token]` — public, no auth required
- Shows user name, email, role badge on invite page
- Password strength indicator on set-password form
- Token marked `used_at` after password set → cannot be reused
- Expired/used tokens show a clear error page
- Resend invite button (✉️) per user in Admin → Users panel
- **Without `RESEND_API_KEY`**: invite URL is logged to terminal — fully testable locally
- **With `RESEND_API_KEY`**: sends branded HTML email via Resend

### Board & Tasks
- Kanban board with drag-and-drop (admin only)
- Staff users only see tasks assigned to them
- Task detail panel — open/close, priority badge + top border color
- Assign task to user via dropdown in detail panel
- Complete, reopen, archive, delete tasks
- Priority levels: Low · Normal · High · Urgent (color-coded cards + panel)
- Comments (public + internal admin notes)
- Search/filter by title, description, submitter

### File Attachments
- Upload images and files via Submit form
- Files saved to `public/uploads/<task_id>/`
- Images shown as grid in task detail panel
- Click image → lightbox modal (full screen, centered, closes on backdrop click)
- Non-image files open in new tab

### Submit Form
- Staff and admins can submit new requests
- Priority selector, description, due date, file attachments
- After submit → immediately redirects to dashboard with new card in Inbox

### Admin Settings
- **Settings** — workspace info + light/dark theme toggle (saves to DB)
- **Email** — configure notification recipients, subject prefix, triggers
- **Columns** — create, rename, recolor, delete board columns
- **Users** — create accounts, set roles, activate/deactivate, set password, resend invite

### Design System
- Yorki brand palette: Navy `#2F3650` · Steel `#6A97C4` · Bronze `#A6784A`
- Full navy (50–900) and bronze (50–900) Tailwind scales
- Light and dark mode, user-toggleable
- Logo-only nav (no text), DM Sans font
- Priority badge colors derived from brand palette
- `rounded-2xl` cards with hover lift + subtle shadow
- Smooth animations: fade-in, slide-in-right, scale-in

### Infrastructure
- SQLite via `better-sqlite3` — all data in `data/yorki.db`
- WAL mode for safe concurrent reads
- File uploads to `public/uploads/`
- rclone backup script at `scripts/backup.sh`
  - Backs up DB + uploads to Google Drive twice daily (via cron)
  - Prunes local backups >7 days, remote >30 days
- `scripts/set-password.js` — manual password setter for initial setup

---

## ⚠️ Partially Working / Known Issues

### Email Notifications (task submit/complete)
- Email code exists and is wired up
- **Requires `RESEND_API_KEY`** in `.env.local` to actually send
- Without key: silently skips (no error, no log)
- Invite emails log the URL to terminal as fallback — task emails do not yet

### Invite Email Delivery
- HTML template is built and styled
- Delivery depends on `RESEND_API_KEY` + a verified sender domain in Resend
- Locally: URL logged to terminal — paste into browser to test

### WAL Checkpoint
- On macOS, stale `-shm` / `-wal` files can corrupt the DB on hard stops
- Fix: `rm data/yorki.db data/yorki.db-shm data/yorki.db-wal` then restart

---

## ❌ Not Yet Built

### Authentication
- [ ] Forgot password flow (request reset link via email)
- [ ] Force password change on first login (currently optional via invite)
- [ ] Session list / revoke other sessions

### User Management
- [ ] Edit user profile (name, email, department, avatar)
- [ ] User self-service profile page
- [ ] Deactivated users should be blocked from login (currently only hidden from board)

### Board & Tasks
- [ ] Filter panel (UI exists, button is disabled)
- [ ] Task labels management (create/delete labels)
- [ ] Due date editing from detail panel
- [ ] Task title/description editing inline from detail panel
- [ ] Watchers — notify on comment/complete
- [ ] Activity log view per task

### Notifications
- [ ] In-app notifications (bell icon)
- [ ] Email on comment (notify_on_comment setting exists but not wired)

### Staff Experience
- [ ] Staff dashboard — filtered view of only assigned tasks
- [ ] Staff cannot currently see the Submit confirmation after redirect

### Backup
- [ ] rclone Google Drive OAuth setup docs
- [ ] Cron job setup verification
- [ ] Backup restore script

### Misc
- [ ] Custom fields (schema exists, UI not built)
- [ ] Mobile drag-and-drop (touch events partially wired)
- [ ] Production deployment guide (Dockerfile + nginx config exist)

---

## Environment Variables

```env
# Required for email (Resend)
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@yourdomain.com

# App URL (used in invite/notification links)
APP_URL=http://localhost:3001

# Set to true to bypass auth in local dev (not recommended with real auth)
# LOCAL_DEV_BYPASS_AUTH=true
```

---

## Key File Map

```
src/lib/auth.ts                          — session, bcrypt, requireRole
src/lib/db.ts                            — SQLite schema + seed
src/lib/local-data.ts                    — all DB query functions
src/lib/actions/tasks.ts                 — board data, task CRUD
src/lib/actions/settings.ts             — users, columns, email settings
src/lib/actions/invite.ts               — invite create/validate/accept
src/lib/actions/email.ts                 — Resend email templates
src/lib/actions/activity.ts             — comments, activity log

src/app/(auth)/login/                    — login page + form + action
src/app/(auth)/invite/[token]/           — invite acceptance page + form
src/app/(protected)/dashboard/          — kanban board
src/app/(protected)/submit/             — new request form
src/app/(protected)/archive/            — archived tasks
src/app/(protected)/admin/              — settings, users, columns, email

src/components/board/KanbanBoard.tsx    — DnD context, search, state
src/components/board/BoardColumn.tsx    — droppable column
src/components/board/TaskCard.tsx       — sortable card
src/components/tasks/TaskDetailPanel.tsx — slide-in panel, attachments, comments
src/components/layout/AppNav.tsx        — top nav, user menu, avatar

scripts/set-password.js                 — one-time password setter
scripts/backup.sh                       — rclone backup to Google Drive
data/yorki.db                           — SQLite database
public/uploads/                         — uploaded files
public/Yorki.png                        — logo
```

---

## Default Credentials (fresh install)

After running `node scripts/set-password.js` or inserting manually:

| Email | Password | Role |
|-------|----------|------|
| george@yorki | yorki1234 | Super Admin |

**Change immediately via Settings → Users → 🔑**
