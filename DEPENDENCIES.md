# Yorki — System Dependencies

## Node packages (npm install handles these)
- `better-sqlite3` — SQLite driver (native module, requires Xcode CLT on macOS)
- `@types/better-sqlite3` — TypeScript types (devDependency)

## System tools

### rclone (required for backup)
```bash
brew install rclone
```
One-time Google Drive setup:
```bash
rclone config
# → New remote → name: gdrive → type: drive → follow OAuth prompts
```

### sqlite3 CLI (required for hot backup in backup.sh)
```bash
brew install sqlite3
```

## Scheduling backups (twice daily at 8am and 8pm)
```bash
crontab -e
```
Add:
```
0 8,20 * * * /absolute/path/to/yorki/backup.sh >> /absolute/path/to/yorki/logs/backup.log 2>&1
```

## Data locations
| What | Path |
|------|------|
| SQLite database | `data/yorki.db` |
| Local backup copies | `data/backups/yorki_TIMESTAMP.db` |
| Uploaded files | `public/uploads/<task_id>/` |
| Backup logs | `logs/backup.log` |
| Google Drive | `gdrive:yorki-backups/db/` and `gdrive:yorki-backups/uploads/` |
