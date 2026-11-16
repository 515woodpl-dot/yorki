# Droplet update procedure

This prepares a release; it does not grant this workspace access to the server. The live host previously returned task/admin content to anonymous HTTP requests. Limit external access during remediation and verify the deployed result before inviting users. Avoid restoring the old deployment's public cache configuration.

## 1. Inspect the host first

In the DigitalOcean web console:

```bash
cd /var/www/yorki
node -v
systemctl show yorki -p ActiveState -p MainPID -p WorkingDirectory -p ExecStart
df -h /
du -sh /var/www/yorki /var/lib/yorki /var/backups/yorki /var/cache/apt/archives /var/log 2>/dev/null
```

Do not display `.env` contents or paste credentials. Confirm which absolute SQLite path the service actually uses (environment files and systemd settings may differ). Confirm cron jobs and calendar key locations. The screenshot showed about 95% disk usage. Do not delete database, uploads, logs needed for investigation, or backups to make room. Identify large files first; expand the Droplet disk or move verified backups off-host as appropriate. The release script requires at least 3 GiB free before dependency installation; additional backup space may be needed for larger uploads.

## 2. Preconditions

- Node 24 LTS recommended, Node 22+ required. The old service and operator shell must use the same Node native-module ABI. A Node major upgrade needs a separate tested runtime/rollback plan because existing better-sqlite3 binaries depend on that ABI. The script stops before changing code when this differs.
- `yorki.service` must use `/var/www/yorki` as its working directory and start Next through the app's local package. Inspect any custom unit before use; Docker/PM2/symlink layouts need a different procedure.
- The configured database must exist at an absolute path outside the app/release folders. If currently under `/var/www/yorki/data`, first stop writes, back up, migrate DB and uploads together to external storage, set the service configuration, and verify it against the existing app. Do not assume `/var/lib/yorki` is active simply because it exists.
- Make a DigitalOcean snapshot and/or verified off-host backup before deployment. Local backups on a nearly full disk are insufficient disaster recovery.
- Rotate published/default passwords and review user roles. Existing production credentials are preserved by this update; fresh databases no longer have a known password.

## 3. Fetch into a NEW sibling directory

Once preconditions have been checked, fetch the prepared branch without overwriting the current app:

```bash
git clone --branch fix/production-readiness --single-branch \
  https://github.com/515woodpl-dot/yorki.git /var/www/yorki-release
```

Private repository access may require authentication. Do not put access tokens directly in command URLs. If that directory already exists, inspect it before reusing it; the script expects a fresh sibling checkout.

Before running the command below, inspect the release changes and service configuration with the operator. Then:

```bash
bash /var/www/yorki-release/scripts/deploy-staged.sh
```

The script validates the service directory, running Node ABI, disk space, and DB configuration; copies environment files and app-local calendar credentials into the staged release; installs from lockfile; builds against isolated sample data; and runs regression tests while the old service remains running. It sets `APP_URL=https://task.goldenstoneworks.com/task` in the staged environment.

Only after the build succeeds does it stop the service, snapshot the live DB with SQLite's backup API, check integrity, copy private/legacy uploads and env files, and privately migrate legacy attachment paths. It then renames directories, retains the complete previous app, starts the service, and requires anonymous dashboard/admin requests to redirect to login. Failure triggers code rollback while retaining the current DB. The legacy file migration does not delete original files.

`BACKUP_ROOT` defaults to `/var/backups/yorki`. Completed backups include a `COMPLETE` marker and `manifest.json`. Restrict access: they contain user data, passwords hashes, session tokens, uploads, and environment secrets. Pause writes while making a DB/files pair. The root `backup.sh` cron entrypoint additionally copies each completed snapshot off-host with rclone (`YORKI_BACKUP_REMOTE`, default `gdrive:yorki-backups`); it fails if rclone is unavailable. Confirm the actual remote and retention policy on the host. `scripts/backup.sh` makes local snapshots only. Scheduled online backups are DB-consistent but file copies may race uploads, so require periodic stopped-write snapshots too.

## 4. Verify externally

- In a fresh signed-out browser, dashboard, archive, submit, and admin URLs must lead to login.
- Sign in as admin and staff separately; verify task boundaries, internal notes, downloads/uploads, invitations and password setup, logout, and disabled users.
- Verify SMTP/Resend delivery and Google Calendar with a test task. Local tests do not validate real external credentials.
- Inspect actual nginx/cache rules, clear any cached private pages, and verify health response timestamps change. Ensure static asset caching does not apply to HTML/RSC.
- Verify service user permissions and disk/memory monitoring. A local pass does not establish production capacity; measure the expected concurrent workload.

## Code rollback

The deploy script prints the previous release path. To deliberately roll code back:

```bash
bash /var/www/yorki/scripts/rollback.sh /var/www/yorki-previous-TIMESTAMP
```

This preserves the current database and keeps the failed release for investigation. The previous code may contain the observed access issue; restrict access and recheck it. Restoring a database is a separate recovery operation that can lose post-backup writes. Stop the service, quarantine the current DB and its WAL/SHM files, restore the standalone backup and matching uploads from a completed snapshot, and validate integrity and file access before restarting. Never place an old live WAL beside the standalone snapshot.
