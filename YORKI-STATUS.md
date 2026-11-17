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

### Multi-user Collaboration
Anyone with permission to move a card (admins, the card's submitter, its
assignees) can work on it at the same time as others, without overwriting
each other:
- **Live board** — open boards update automatically (moves, edits, comments,
  attachments, new/archived cards) via `/api/board/stream` (SSE). No refresh needed.
- **Conflict protection** — every action says what the user saw; the server
  checks it in the same SQLite transaction as the write:
  - Moving a card is refused only if someone else moved / completed / archived it.
  - Complete vs Archive (or any two status changes) — only the first succeeds;
    the second person gets "*X updated this card … it is now completed*".
  - Editing details sends only the changed fields. Different fields merge;
    the same field is stopped, drafts are kept, and pressing Save again is a
    deliberate overwrite.
  - Delete is refused if the card changed at all since it was opened.
- **Presence** — cards and the detail panel show who is viewing / editing.
- **Staff** who can move a card can also Complete / Reopen it. Archive and
  Delete stay admin-only.
- Tasks have `version` + `updated_by` columns; `board_events` and
  `task_presence` tables are created automatically on startup.
- nginx: `/task/api/board/stream` needs `proxy_buffering off` (see `nginx/taskflow.conf`).

### @Mentions & Notifications
- Type `@` in a comment to pick a person. Only people who can open the card
  are offered; in an internal note, only admins. Mentions render as chips
  (yours highlighted). Stored as `@[Name](userId)`; the server re-validates
  every mention, fixes forged names, and drops mentions of people without access.
- Bell (desktop header + mobile top bar) with unread count, live updates,
  "Mark all as read", and a toast for new mentions / assignments.
  Clicking a notification opens the card; opening a card marks its notifications read.
- You're notified when: someone @mentions you · comments on a card you
  submitted or are assigned to · assigns you · completes your card.
  Never for your own actions; staff are never notified about internal notes.
- Email for @mentions (Admin → Email → "@mentions", on by default) when
  Resend or SMTP is configured. Other notifications are in-app only.

### Push notifications
- Alerts on phones and computers even when Yorki is closed: mentions, assignments, comments on your
  cards, completed cards. Per-device opt-in, per-type switches, optional private lock-screen text,
  app-icon badge, tap opens the card. iPhone works from the Home Screen app (iOS 16.4+).
- Nothing to configure (signing key is created automatically); signing out removes that device.
- Encrypted end to end; the server only posts to the real push services. See `docs/PUSH.md`.

### Quick add (chat box)
- Type a sentence on the board (e.g. "I want @Mia to call the supplier by Friday, urgent")
  and get editable cards from it — people, dates, times, priority and labels are picked
  out by plain rules (no AI). Live preview, then Enter to create. See `docs/QUICK-ADD.md`.
- English and Spanish (and a mix of both); accents optional; Spanish titles use the infinitive.
- Reads whole briefs (e.g. a long all-caps message to one person) as one card: assignee, deadline
  ("tienes 2 semanas"), priority ("tu mayor task"), clean title, deliverables as a checklist,
  original message as the description.
- Guesses misspelled dates/urgency words and @names, and shows each guess.
- Learns as a team: nicknames fixed in the preview ("Who is Jimmy?", which "Ana") are shared by
  everyone (`quick_add_alias_votes`, one vote per person, majority wins, real names protected,
  admins can remove). Date habits ("next Friday", "5/12") stay personal (`quick_add_memory`).
- Suggests people / priority / labels from past cards (one click, never automatic), matching by
  meaning via a bilingual concept dictionary (leak = gotera = fuga). Roadmap in docs/QUICK-ADD.md.

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
- [x] Notify on comment/complete (submitter + assignees; see Notifications)
- [ ] Activity log view per task

### Notifications
- [x] In-app notifications (bell icon) + @mentions
- [ ] Email on every comment (the "Comment added" email toggle is still not wired; @mention emails are)

### Staff Experience
- [ ] Staff dashboard — filtered view of only assigned tasks
- [ ] Staff cannot currently see the Submit confirmation after redirect

### Backup
- [ ] rclone Google Drive OAuth setup docs
- [ ] Cron job setup verification (see docs/PRODUCTION-CHECKLIST.md)
- [ ] Backup restore script (manual steps in docs/PRODUCTION-CHECKLIST.md)

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
