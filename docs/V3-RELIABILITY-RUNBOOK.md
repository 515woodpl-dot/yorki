# Yorki v3.0 Reliability Runbook

This runbook is the mandatory deployment and recovery process for production reliability.

## 1) Pre-requisites

- App path: `/var/www/yorki`
- DB path: `/var/lib/yorki/yorki.db`
- Service: `yorki.service`
- Scripts:
  - `scripts/predeploy-backup.sh`
  - `scripts/deploy-safe.sh`
  - `scripts/healthcheck.sh`
  - `scripts/rollback.sh`

## 2) Golden deploy command

Run on droplet:

```bash
cd /var/www/yorki
./scripts/deploy-safe.sh
```

What it does:
- takes snapshot backup (DB + env + service + nginx + source archive)
- stops Yorki
- installs deps
- builds with safe heap size
- starts Yorki
- runs healthchecks
- rolls back automatically if healthcheck fails

## 3) Health checks

```bash
cd /var/www/yorki
./scripts/healthcheck.sh
```

Checks:
- `/task/login`
- `/task/dashboard`
- `/task/Yorki.png`
- CSS asset discovered from login HTML

## 4) Rollback

Rollback to latest backup:

```bash
cd /var/www/yorki
./scripts/rollback.sh latest
```

Rollback to specific backup timestamp:

```bash
cd /var/www/yorki
./scripts/rollback.sh 20260428-120000
```

## 5) Debug quick commands

```bash
systemctl status yorki --no-pager -l
journalctl -u yorki -n 200 --no-pager -l
ss -ltnp | grep 3000
curl -I http://127.0.0.1:3000/task/login
```

## 6) Reliability rules for v3

- Never deploy without `predeploy-backup.sh`.
- Never run more than one Yorki process on port 3000.
- Always build with `NODE_OPTIONS=--max-old-space-size=4096`.
- Keep swap enabled on low-memory droplets.
- If deploy fails, rollback first, then debug.
