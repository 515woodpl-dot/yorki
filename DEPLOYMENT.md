# TaskFlow — Full Deployment Guide
## Mac → GitHub → Raspberry Pi 4

---

## THE ARCHITECTURE

```
┌─────────────────┐     git push      ┌──────────────┐     git pull      ┌─────────────────┐
│   Your Mac      │ ────────────────► │   GitHub     │ ────────────────► │  Raspberry Pi   │
│   (VS Code)     │                   │  (private    │                   │  (runs the app) │
│                 │                   │   repo)      │                   │                 │
└─────────────────┘                   └──────────────┘                   └─────────────────┘
                                                                                  │
                                                                                  ▼
                                                                         docker compose up
                                                                                  │
                                                                                  ▼
                                                                         Next.js on :3000
                                                                                  │
                                                                                  ▼
                                                                         Nginx → /task
                                                                                  │
                                                                                  ▼
                                                                         Tailscale Funnel
                                                                         or DNS → HTTPS
```

**Key rule:** `.env.local` is NEVER in GitHub.
It lives ONLY on the Pi. Secrets never leave the server.

---

## PART 1 — ONE-TIME SETUP ON YOUR MAC

### Step 1: Install tools (if not already installed)

```bash
# Install Homebrew if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Git (usually already on Mac, but ensure it's current)
brew install git

# Install VS Code (optional but recommended)
brew install --cask visual-studio-code

# Verify
git --version
node --version   # should be 18+ (install via https://nodejs.org if needed)
```

### Step 2: Set up the project from the zip

```bash
# 1. Unzip the project you downloaded
cd ~/Downloads
unzip taskflow.zip
mv taskflow ~/Projects/taskflow    # or wherever you keep projects
cd ~/Projects/taskflow

# 2. Open in VS Code
code .

# 3. Install dependencies (for local development)
npm install
```

### Step 3: Create the GitHub repository

```bash
# Option A: Using GitHub CLI (easiest)
brew install gh
gh auth login           # follow prompts, choose GitHub.com, HTTPS, browser auth
gh repo create taskflow --private --source=. --remote=origin --push

# Option B: Manual (if you prefer)
# 1. Go to github.com → New repository
# 2. Name it "taskflow", set Private, do NOT initialise with README
# 3. Then run:
git init
git add .
git commit -m "Initial commit — TaskFlow MVP scaffold"
git remote add origin https://github.com/YOURUSERNAME/taskflow.git
git branch -M main
git push -u origin main
```

### Step 4: Verify .gitignore is protecting your secrets

```bash
# This should show .env.local is tracked by gitignore (not in git)
git status
# .env.local should NOT appear in the output

# Double-check
cat .gitignore | grep env
# Should show: .env.local
```

---

## PART 2 — ONE-TIME SETUP ON THE RASPBERRY PI

### Step 1: Connect to your Pi

```bash
# From your Mac terminal
ssh pi@YOUR_PI_IP_ADDRESS
# e.g. ssh pi@192.168.1.100
# Default password is 'raspberry' — change it if you haven't:
# passwd
```

### Step 2: Install Docker on the Pi

```bash
# Update system first
sudo apt update && sudo apt upgrade -y

# Install Docker (official script — works on Pi OS)
curl -fsSL https://get.docker.com | sh

# Add pi user to docker group (so you don't need sudo every time)
sudo usermod -aG docker pi

# Install Docker Compose plugin
sudo apt install -y docker-compose-plugin

# IMPORTANT: Log out and back in for group change to take effect
exit
ssh pi@YOUR_PI_IP_ADDRESS

# Verify
docker --version
docker compose version
```

### Step 3: Install Nginx on the Pi

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### Step 4: Install Git on the Pi

```bash
sudo apt install -y git
```

### Step 5: Set up SSH key so Pi can pull from GitHub

```bash
# On the Pi — generate a deploy key
ssh-keygen -t ed25519 -C "taskflow-pi-deploy" -f ~/.ssh/github_deploy
# Press Enter twice for no passphrase

# Show the public key — copy this entire output
cat ~/.ssh/github_deploy.pub

# Configure SSH to use this key for GitHub
cat >> ~/.ssh/config << 'SSHEOF'
Host github.com
  IdentityFile ~/.ssh/github_deploy
  StrictHostKeyChecking no
SSHEOF
chmod 600 ~/.ssh/config
```

```
# On GitHub:
# 1. Go to your taskflow repo → Settings → Deploy keys → Add deploy key
# 2. Title: "Raspberry Pi"
# 3. Paste the public key you copied above
# 4. Leave "Allow write access" UNCHECKED (Pi only needs to read)
# 5. Click Add key
```

### Step 6: Clone the repo on the Pi

```bash
# On the Pi
mkdir -p /home/pi/apps
cd /home/pi/apps
git clone git@github.com:YOURUSERNAME/taskflow.git
cd taskflow

# Verify the files are there
ls -la
```

### Step 7: Create the .env.local on the Pi

```bash
# On the Pi — this file NEVER goes to GitHub
nano /home/pi/apps/taskflow/.env.local
```

Paste and fill in your values:

```bash
# Supabase — get from Supabase Dashboard → Settings → API
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5...

# Email — get from resend.com → API Keys
RESEND_API_KEY=re_xxxxxxxxxxxxxxxx
EMAIL_FROM=taskflow@yourcompany.com

# App URL (your Pi's public URL — via Tailscale or domain)
APP_URL=https://YOUR_DOMAIN_OR_TAILSCALE_URL

NODE_ENV=production
```

```bash
# Lock down permissions — only pi user can read this file
chmod 600 /home/pi/apps/taskflow/.env.local

# Verify it's not world-readable
ls -la /home/pi/apps/taskflow/.env.local
# Should show: -rw------- 1 pi pi ...
```

### Step 7.5: Run the Supabase SQL migrations

In your Supabase project, open SQL Editor and run these files in order:

1. `/home/pi/apps/taskflow/supabase/migrations/001_initial_schema.sql`
2. `/home/pi/apps/taskflow/supabase/migrations/002_storage.sql`

Important: the attachments bucket should be private. If you already created it as public anywhere, run this too:

```sql
UPDATE storage.buckets
SET public = false
WHERE id = 'attachments';
```

### Step 8: Set up Nginx

```bash
# Copy the Nginx config from the project
sudo cp /home/pi/apps/taskflow/nginx/taskflow.conf /etc/nginx/sites-available/taskflow
sudo cp /home/pi/apps/taskflow/nginx/proxy-params.conf /etc/nginx/snippets/proxy-params.conf

# Edit the config with your actual domain/hostname
sudo nano /etc/nginx/sites-available/taskflow
# Replace every instance of "yourdomain.com" with your actual domain
# If using Tailscale Funnel, see Tailscale section below

# Enable the site
sudo ln -s /etc/nginx/sites-available/taskflow /etc/nginx/sites-enabled/taskflow

# Remove the default Nginx page
sudo rm -f /etc/nginx/sites-enabled/default

# Test config
sudo nginx -t

# If test passes:
sudo systemctl reload nginx
```

### Step 9: First build and launch

```bash
cd /home/pi/apps/taskflow

# Build and start (first build takes 5-10 minutes on Pi 4)
docker compose up -d --build

# Watch the logs
docker compose logs -f taskflow

# Check it's running (wait for "ready" message)
docker ps
```

---

## PART 3 — TAILSCALE FUNNEL SETUP (Recommended for remote access)

Tailscale Funnel exposes your Pi to the internet without port forwarding,
without a static IP, and without Let's Encrypt complexity. Free tier is fine.

```bash
# On the Pi — install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# Log in (follow the URL it gives you)
sudo tailscale up

# Enable Funnel (makes port 443 publicly accessible)
sudo tailscale funnel 443

# Get your Tailscale hostname
tailscale status
# Your hostname will be something like: my-pi.tail1234.ts.net
```

Now update your Nginx config for Tailscale:

```bash
sudo nano /etc/nginx/sites-available/taskflow
```

Replace the SSL cert lines with the Tailscale cert:

```nginx
# Comment out or remove the Let's Encrypt lines:
# ssl_certificate /etc/letsencrypt/...
# ssl_certificate_key /etc/letsencrypt/...

# Add Tailscale cert (auto-managed):
ssl_certificate     /var/lib/tailscale/certs/YOUR-HOSTNAME.crt;
ssl_certificate_key /var/lib/tailscale/certs/YOUR-HOSTNAME.key;
```

Or even simpler — let Tailscale handle TLS entirely and point Nginx
to listen on port 80 only, with Tailscale Funnel terminating SSL:

```nginx
# Simplified Nginx for Tailscale (no SSL block needed in Nginx)
server {
    listen 80;
    server_name _;   # accept any hostname

    location /task {
        proxy_pass http://127.0.0.1:3000;
        include /etc/nginx/snippets/proxy-params.conf;
    }

    location = / {
        return 302 /task/;
    }
}
```

```bash
# Update your .env.local with the Tailscale URL
nano /home/pi/apps/taskflow/.env.local
# APP_URL=https://my-pi.tail1234.ts.net

# Reload Nginx
sudo nginx -t && sudo systemctl reload nginx

# Test
curl https://my-pi.tail1234.ts.net/task
```

---

## PART 4 — SET UP THE DATABASE (Supabase)

Do this on any browser while your Pi is being set up.

### Run migrations

```
1. Go to supabase.com → your project → SQL Editor
2. Click "New query"
3. Open: taskflow/supabase/migrations/001_initial_schema.sql
4. Copy the entire contents → paste into Supabase SQL Editor → Run
5. You should see "Success. No rows returned"

6. Click "New query" again
7. Open: taskflow/supabase/migrations/002_storage.sql
8. Copy → paste → Run
```

### Create your Super Admin account

```sql
-- Run this in Supabase SQL Editor AFTER creating your user in Auth:
-- Go to Authentication → Users → Invite user → enter your email

-- After you click the invite link and set your password, run:
UPDATE public.user_profiles
SET
  role = 'super_admin',
  full_name = 'Your Full Name',
  display_name = 'Your Name'
WHERE email = 'your@email.com';
```

### Set up Supabase Storage bucket

```
1. Supabase Dashboard → Storage → New bucket
   - Name: attachments
   - Public: ON
   - File size limit: 10MB
   The SQL migration 002_storage.sql handles the policies automatically.
```

---

## PART 5 — DAILY DEVELOPMENT WORKFLOW

This is the loop you'll use every time you make changes:

### On your Mac (writing code)

```bash
cd ~/Projects/taskflow

# Start local dev server
npm run dev
# Open http://localhost:3000/task

# Make your changes in VS Code...

# When ready to deploy:
git add .
git commit -m "describe what you changed"
git push origin main
```

### On the Pi (deploying changes)

```bash
ssh pi@YOUR_PI_IP

cd /home/pi/apps/taskflow

# Pull the latest code
git pull origin main

# Rebuild and restart (takes ~3-5 min on Pi)
docker compose up -d --build

# Watch until it's back up
docker compose logs -f taskflow
# Ctrl+C when you see "Ready"
```

### One-liner deploy (run this from your Mac)

```bash
# Add this to your Mac's ~/.zshrc or ~/.bash_profile for convenience:
alias deploy-taskflow='ssh pi@YOUR_PI_IP "cd /home/pi/apps/taskflow && git pull && docker compose up -d --build"'

# Then deploy from anywhere with:
deploy-taskflow
```

---

## PART 6 — FASTER BUILDS (Build on Mac, deploy image to Pi)

Pi builds are slow. This approach builds the Docker image on your fast Mac
and copies it to the Pi — deploy time drops from 5-10 min to ~1 min.

```bash
# On your Mac — build for Pi's ARM64 architecture
cd ~/Projects/taskflow

docker buildx build \
  --platform linux/arm64 \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY \
  -t taskflow:latest \
  --output type=docker \
  .

# Save the image to a file
docker save taskflow:latest | gzip > taskflow-image.tar.gz

# Copy to Pi (replace with your Pi's IP)
scp taskflow-image.tar.gz pi@YOUR_PI_IP:/home/pi/apps/

# Load and run on Pi (SSH in and run):
ssh pi@YOUR_PI_IP
cd /home/pi/apps
docker load < taskflow-image.tar.gz
docker compose up -d
```

Or use this helper script on your Mac:

```bash
#!/bin/bash
# ~/scripts/deploy-taskflow-fast.sh
# Usage: ./deploy-taskflow-fast.sh

PI_IP="YOUR_PI_IP"
PI_USER="pi"
APP_DIR="/home/pi/apps/taskflow"

echo "Building for ARM64..."
docker buildx build \
  --platform linux/arm64 \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=$(grep NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2) \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY .env.local | cut -d= -f2) \
  -t taskflow:latest \
  --output type=docker \
  .

echo "Saving image..."
docker save taskflow:latest | gzip > /tmp/taskflow-image.tar.gz

echo "Copying to Pi..."
scp /tmp/taskflow-image.tar.gz $PI_USER@$PI_IP:/tmp/

echo "Loading and starting on Pi..."
ssh $PI_USER@$PI_IP "docker load < /tmp/taskflow-image.tar.gz && cd $APP_DIR && docker compose up -d"

echo "Done! App is starting."
```

---

## PART 7 — USEFUL COMMANDS

### On the Pi

```bash
# View live app logs
docker compose logs -f taskflow

# Check memory/CPU usage
docker stats taskflow

# Restart the app (no rebuild)
docker compose restart taskflow

# Stop the app
docker compose down

# Check Nginx status
sudo systemctl status nginx

# View Nginx error log
sudo tail -f /var/log/nginx/error.log

# Check disk space
df -h

# Check Pi temperature (overheating causes throttling)
vcgencmd measure_temp
```

### On your Mac

```bash
# See what's deployed (SSH into Pi and check)
ssh pi@YOUR_PI_IP "docker images && docker ps"

# Quick status check
ssh pi@YOUR_PI_IP "docker compose -f /home/pi/apps/taskflow/docker-compose.yml ps"

# View Pi logs remotely
ssh pi@YOUR_PI_IP "docker compose -f /home/pi/apps/taskflow/docker-compose.yml logs --tail=50"
```

---

## PART 8 — SET UP AUTOMATIC BACKUPS

```bash
# On the Pi
# Add your Supabase DB password to .env.local:
echo "SUPABASE_DB_PASSWORD=your_db_password" >> /home/pi/apps/taskflow/.env.local

# Make backup script executable
chmod +x /home/pi/apps/taskflow/scripts/backup.sh

# Create backup directory
mkdir -p /home/pi/backups/taskflow

# Test it manually first
/home/pi/apps/taskflow/scripts/backup.sh

# Add to cron (runs at 2 AM every night)
crontab -e
# Add this line:
0 2 * * * /home/pi/apps/taskflow/scripts/backup.sh >> /var/log/taskflow-backup.log 2>&1
```

---

## PART 9 — IF THINGS GO WRONG

### App won't start

```bash
# Check logs for the actual error
docker compose logs taskflow --tail=100

# Most common causes:
# 1. Missing env var → check .env.local has all required values
# 2. Port conflict → check nothing else is on port 3000
#    sudo lsof -i :3000
# 3. Out of memory → check
#    free -h
#    docker stats
```

### Can't access /task in browser

```bash
# Check Nginx is running
sudo systemctl status nginx

# Check Nginx config is valid
sudo nginx -t

# Check app is running on 3000
curl http://localhost:3000/task

# Check Nginx is proxying correctly
sudo tail -f /var/log/nginx/error.log
```

### Pi running out of memory during build

```bash
# Add swap space (helps with builds on 2GB Pi models)
sudo dphys-swapfile swapoff
sudo nano /etc/dphys-swapfile
# Change CONF_SWAPSIZE=100 to CONF_SWAPSIZE=1024
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

### Git pull says "conflict"

```bash
cd /home/pi/apps/taskflow
# If you never edit files on the Pi (you shouldn't), this resets safely:
git fetch origin
git reset --hard origin/main
```

---

## QUICK REFERENCE CARD

| Task | Command |
|------|---------|
| Push code to GitHub | `git add . && git commit -m "msg" && git push` |
| Deploy to Pi | `ssh pi@IP "cd /home/pi/apps/taskflow && git pull && docker compose up -d --build"` |
| View Pi logs | `ssh pi@IP "docker compose -f /home/pi/apps/taskflow/docker-compose.yml logs -f"` |
| Restart app | `ssh pi@IP "docker compose -f /home/pi/apps/taskflow/docker-compose.yml restart"` |
| Check Pi health | `ssh pi@IP "docker stats --no-stream && df -h && vcgencmd measure_temp"` |
| Run backup | `ssh pi@IP "/home/pi/apps/taskflow/scripts/backup.sh"` |
