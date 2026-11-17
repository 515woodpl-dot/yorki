# Faster deploys

GitHub builds the Docker image (`.github/workflows/docker-image.yml`, runs on every push to `main`)
and stores it in GitHub's registry. The server only downloads it.

## One-time setup on the server

The repository is private, so the server needs permission to download the image:

1. GitHub → Settings → Developer settings → Personal access tokens → create a token with only
   the **read:packages** permission.
2. On the server: `echo YOUR_TOKEN | docker login ghcr.io -u 515woodpl-dot --password-stdin`

## Every deploy

```bash
cd /path/to/yorki            # the folder with docker-compose.yml
git pull origin main         # picks up compose / nginx / script changes
docker compose pull          # downloads the image GitHub built (about 30 seconds)
docker compose up -d         # restarts with it
curl -s http://127.0.0.1:3000/api/health
```

Wait for the green "Build image" check on the commit in GitHub before pulling; until it finishes,
`pull` gives you the previous version.

## Building on the server instead (slow path)

`docker compose up -d --build` still works. Add swap first on small servers:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
```

## Notes

- The image is built for `linux/amd64` (normal cloud servers). A Raspberry Pi needs `linux/arm64`
  added to `platforms:` in the workflow.
- The checks workflow (`verify.yml`) now runs the quick checks and the browser test in parallel and
  caches the Next.js build and the Playwright browser.
