# Deploying GitFill on a VPS

One host, next to an app that is already running there, behind the host's nginx.

```
internet ──443──▶ nginx (host) ──▶ 127.0.0.1:3100 ──▶ web (Next.js)
                     │                                   │
                     └── other app (unchanged)           ├── postgres (compose network only)
                                                         └── worker × N (jobs, Chromium)
                                       volumes: gitfill-data (/data), gitfill-pg
```

## Budget on a 10-core / 32 GB / 400 GB host

| Service | Memory limit | CPUs | Notes |
|---|---|---|---|
| web | 4 GB | 3 | chat, API, pages |
| worker × 2 | 6 GB each | 3 each | one job each; decks and videos run Chromium |
| postgres | 3 GB | 2 | |
| **GitFill total** | **19 GB** | | leaves ~13 GB and the spare cores for the other app and the OS |

Limits cap the worst case; idle usage is far lower. Watch `docker stats` for a week and adjust.
Disk: cloned repositories are capped by `GIT_STORE_MAX_GB` (40 GB here); generated decks, PDFs and
uploads grow with use; keep 20% of the disk free for Docker images and logs.

## First deploy

```bash
# 1. Docker, firewall (Docker-published ports bypass ufw, which is why compose binds to 127.0.0.1)
curl -fsSL https://get.docker.com | sh
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
sudo ss -tlnp            # check GITFILL_PORT (3100) is free; change it if the other app uses it

# 2. Code
sudo mkdir -p /opt/gitfill && sudo chown $USER /opt/gitfill
git clone <your GitFill repo> /opt/gitfill && cd /opt/gitfill

# 3. Configuration
cp deploy/env.production.example deploy/.env.production && chmod 600 deploy/.env.production
#    fill it in; GitHub OAuth app callback: https://<domain>/api/auth/github/callback

# 4. Start (builds the image, runs migrations, then web + workers)
docker compose -f deploy/docker-compose.yml --env-file deploy/.env.production up -d --build
docker compose -f deploy/docker-compose.yml --env-file deploy/.env.production ps
curl -s http://127.0.0.1:3100/api/health

# 5. nginx + TLS (its own server block; the other app's config is not touched)
sudo cp deploy/nginx/gitfill.conf /etc/nginx/sites-available/gitfill.conf   # set server_name
sudo ln -s /etc/nginx/sites-available/gitfill.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d gitfill.example.com

# 6. Backups
chmod +x deploy/backup.sh
echo "15 3 * * * root /opt/gitfill/deploy/backup.sh >> /var/log/gitfill-backup.log 2>&1" | sudo tee /etc/cron.d/gitfill-backup
```

Point the domain's DNS A record at the VPS before step 5.

## Everyday operations

```bash
alias gf='docker compose -f /opt/gitfill/deploy/docker-compose.yml --env-file /opt/gitfill/deploy/.env.production'

gf logs -f web worker          # logs
gf ps; docker stats            # health and resource use

# Update: pull, rebuild, migrate, restart. Workers finish their current job first (5 min grace).
cd /opt/gitfill && git pull && gf up -d --build

gf up -d --scale worker=3      # more parallel jobs (each needs up to 6 GB)
```

**Rollback:** `git checkout <previous tag> && gf up -d --build`. Migrations only add, so the older
code runs on the newer schema; restore the nightly dump only if a migration damaged data.

**Restore:** `gf exec -T postgres pg_restore -U gitfill -d gitfill --clean < db-YYYY-MM-DD.dump`, and
untar `data-YYYY-MM-DD.tar.gz` into the `gitfill-data` volume.

## Checklist before going live

- `AUTH_MODE=github`, and `AUTH_SECRET` / `TOKEN_ENCRYPTION_KEY` set to separate random values
- `APP_BASE_URL` is the https URL, matching the GitHub OAuth callback
- `/api/health` reports database, model and worker as ok
- One deck generated end to end (exercises Chromium in the worker)
- Backups copied off the server
