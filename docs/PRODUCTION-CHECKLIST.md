# Production checklist — small team (≈4 users)

Code-side, the app is ready for a small team: live board, conflict
protection, presence, @mentions and notifications are built and covered by
`tests/e2e/run.sh` (28 checks, 3 concurrent users). Load is trivial at this
size — SQLite + one Node process handles it with lots of headroom.

What remains is **server setup that can't be verified from the repo**.
Do these once, in order. Tick them off.

## 1 · Must do before inviting people

- [ ] **Deploy this version** with `./scripts/deploy-safe.sh`.
  (Earlier versions of `healthcheck.sh` rejected the dashboard's normal
  login redirect, so safe deploys would always roll back.)
- [ ] **Update nginx** from `nginx/taskflow.conf` — the new
  `location /task/api/board/stream` block (`proxy_buffering off`) is required,
  otherwise live updates and the bell will lag or not arrive.
  `sudo nginx -t && sudo systemctl reload nginx`
- [ ] **Run under systemd with auto-restart**, not `nohup`. `deploy-safe.sh`
  already expects a `yorki` service. Make sure the unit has:
  ```ini
  [Service]
  WorkingDirectory=/var/www/yorki
  Environment=NODE_ENV=production
  Environment=YORKI_DB_DIR=/var/lib/yorki
  EnvironmentFile=/var/www/yorki/.env
  # use the path printed by `which node`
  ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000
  Restart=always
  RestartSec=3
  [Install]
  WantedBy=multi-user.target
  ```
  `sudo systemctl enable --now yorki` — so it survives crashes and reboots.
- [ ] **HTTPS only.** The session cookie is `secure` in production; logins
  fail over plain HTTP.
- [ ] **`APP_URL`** in `.env` = the real public URL including `/task`
  (used in email links).
- [ ] **Change the bootstrap admin password** (George / super_admin) if it was
  never changed. Then give each person their **own account** via
  Admin → Users → invite. No shared logins — notifications, presence and
  "who changed this" depend on it.
- [ ] **Backups — schedule and prove a restore** (see §3).

## 2 · Recommended

- [ ] **Email** — set `RESEND_API_KEY` + `EMAIL_FROM` (or SMTP vars) so
  @mentions reach people who aren't looking at the app. Without it,
  notifications are in-app only (still fully functional).
- [ ] Keep the app on **Tailscale / VPN or behind nginx rate limits**.
  Next.js 14 has open advisories (DoS) that are only fixed in Next 15/16;
  this release is on the latest 14.2 patch and has the image optimizer
  disabled, which removes the main exposed surface. Plan the major upgrade
  as a separate project.
- [ ] Remove `public/uploads/…png` from the repo if it's a real customer
  attachment — anything in `public/` is downloadable without logging in.
  (New uploads are private and stored next to the database.)

## 3 · Backups

```bash
# one-off, as the app user (rclone remote "gdrive" configured first)
YORKI_DB_DIR=/var/lib/yorki /var/www/yorki/scripts/backup.sh

# schedule twice daily
crontab -e
0 8,20 * * * YORKI_DB_DIR=/var/lib/yorki /var/www/yorki/scripts/backup.sh >> /var/log/yorki-backup.log 2>&1
```

The script refuses to run without `sqlite3` and `rclone`, verifies every
snapshot with `PRAGMA integrity_check`, and copies the database **and the
private attachments folder** off-site.

**Restore drill (do it once now, not during an emergency):**
```bash
sudo systemctl stop yorki
cp /var/lib/yorki/yorki.db /var/lib/yorki/yorki.db.before-restore
rclone copy gdrive:yorki-backups/db/yorki_YYYYMMDD_HHMMSS.db /tmp/
cp /tmp/yorki_YYYYMMDD_HHMMSS.db /var/lib/yorki/yorki.db
rm -f /var/lib/yorki/yorki.db-wal /var/lib/yorki/yorki.db-shm
rclone sync gdrive:yorki-backups/uploads /var/lib/yorki/uploads
sudo systemctl start yorki && ./scripts/healthcheck.sh
```

## 4 · Day-one smoke test (5 minutes, two people)

1. Both open the board. One drags a card → the other sees it move.
2. Both open the same card → each sees "X is viewing".
3. One presses **Mark Complete**, the other **Archive** → the second gets
   "…updated this card… it is now completed".
4. Comment `@` + a name → that person's bell shows 1, clicking opens the card.

## Known limits (fine at 4 users)

- One server, one SQLite file: no failover. Restore from backup if the
  machine dies (RPO ≤ 12 h with the schedule above).
- Login rate limiting is in memory (resets on restart); nginx also limits.
- The "Comment added" email toggle is not wired (in-app notifications cover it).
- An open card's backdrop covers the header, so close the card to use the bell
  (toasts still appear for new mentions).
