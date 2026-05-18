# Yorki — DigitalOcean Deployment Guide

## What you need
- A DigitalOcean account
- A domain name (or use a DO subdomain)
- ~20 minutes

---

## 1. Create a Droplet

1. Go to DigitalOcean → **Create Droplet**
2. Choose:
   - **Image**: Ubuntu 24.04 LTS
   - **Size**: Basic → $6/month (1GB RAM, 1 vCPU) — sufficient for a small team
   - **Region**: closest to your users
   - **Authentication**: SSH key (recommended) or password
3. Click **Create Droplet**

---

## 2. Point your domain to the Droplet

In your domain registrar (or DO DNS):
- Add an **A record**: `yourdomain.com` → Droplet IP
- Wait 5–10 minutes for DNS to propagate

---

## 3. SSH into the Droplet and install dependencies

```bash
ssh root@YOUR_DROPLET_IP

# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Install nginx + certbot
apt install -y nginx certbot python3-certbot-nginx

# Install rclone (for backups)
curl https://rclone.org/install.sh | bash
```

---

## 4. Upload the project

On your **local machine**:
```bash
# From inside your Yorki project folder
rsync -avz --exclude node_modules --exclude .next --exclude data \
  ./ root@YOUR_DROPLET_IP:/opt/yorki/
```

---

## 5. Configure environment variables

On the **Droplet**:
```bash
cd /opt/yorki
cp .env.production.example .env
nano .env
```

Fill in:
```
APP_URL=https://yourdomain.com
RESEND_API_KEY=re_...          # optional but recommended
EMAIL_FROM=noreply@yourdomain.com
```

---

## 6. Set up SSL with Let's Encrypt

```bash
# Make sure nginx is running
systemctl start nginx

# Get SSL certificate
certbot --nginx -d yourdomain.com

# Test auto-renewal
certbot renew --dry-run
```

---

## 7. Configure nginx

```bash
# Copy the nginx config
cp /opt/yorki/nginx/taskflow.conf /etc/nginx/sites-available/yorki

# Edit it — replace YOUR_DOMAIN with your actual domain
nano /etc/nginx/sites-available/yorki

# Enable it
ln -s /etc/nginx/sites-available/yorki /etc/nginx/sites-enabled/yorki

# Remove default nginx site
rm /etc/nginx/sites-enabled/default

# Test and reload
nginx -t && systemctl reload nginx
```

---

## 8. Build and start the app

```bash
cd /opt/yorki

# Build Docker image (takes 2–4 minutes on first run)
docker compose build

# Start the app
docker compose up -d

# Check it's running
docker compose ps
docker compose logs -f
```

---

## 9. Set up the first user

```bash
# Wait for app to start, then visit https://yourdomain.com in browser
# This seeds the database. Then:

docker compose exec yorki node scripts/set-password.js
```

You'll see: `✓ Password set for george@yorki`

Login at `https://yourdomain.com` with `george@yorki` / `yorki1234`

**Change your password immediately** via Settings → Users → 🔑

---

## 10. Set up automatic backups

```bash
# Configure rclone for Google Drive
rclone config
# → New remote → name: gdrive → type: drive → follow OAuth prompts

# Test the backup script
cd /opt/yorki && bash scripts/backup.sh

# Schedule twice daily (8am and 8pm)
crontab -e
```

Add:
```
0 8,20 * * * cd /opt/yorki && bash scripts/backup.sh >> logs/backup.log 2>&1
```

---

## Updating the app

```bash
cd /opt/yorki

# Pull latest code from your machine
rsync -avz --exclude node_modules --exclude .next --exclude data \
  ./ root@YOUR_DROPLET_IP:/opt/yorki/

# Rebuild and restart (zero-downtime with Docker)
docker compose build && docker compose up -d
```

---

## Useful commands

```bash
# View live logs
docker compose logs -f

# Restart app
docker compose restart yorki

# Stop everything
docker compose down

# DB shell (while app is stopped)
docker compose stop yorki
sqlite3 /var/lib/docker/volumes/yorki_yorki_data/_data/yorki.db

# Restore from backup
docker compose stop yorki
cp data/backups/yorki_TIMESTAMP.db /var/lib/docker/volumes/yorki_yorki_data/_data/yorki.db
docker compose start yorki
```

---

## Architecture on the Droplet

```
Internet → nginx (port 443, SSL) → Yorki app (port 3000, Docker)
                                         ↓
                              /opt/yorki/data/yorki.db  (SQLite)
                              /opt/yorki/public/uploads/ (files)
                                         ↓
                              rclone → Google Drive (backups, 2x/day)
```
