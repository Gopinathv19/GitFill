#!/usr/bin/env sh
# Nightly backup of GitFill's database and generated files, keeping the last 14 days.
# Cron (as root):  15 3 * * * /opt/gitfill/deploy/backup.sh >> /var/log/gitfill-backup.log 2>&1
# Copy BACKUP_DIR off the server too (rsync, rclone to object storage): a backup on the same disk
# does not survive losing the VPS.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/var/backups/gitfill}"
COMPOSE="docker compose -f $(dirname "$0")/docker-compose.yml --env-file $(dirname "$0")/.env.production"
STAMP="$(date +%Y-%m-%d)"
mkdir -p "$BACKUP_DIR"

$COMPOSE exec -T postgres pg_dump -U gitfill -d gitfill --format=custom > "$BACKUP_DIR/db-$STAMP.dump"
# Decks, PDFs, previews and uploads. Cloned repositories (repos/) are a cache and are skipped.
$COMPOSE run --rm --no-deps -T --entrypoint sh web -c "tar -C /data --exclude=./repos -czf - ." > "$BACKUP_DIR/data-$STAMP.tar.gz"

find "$BACKUP_DIR" -type f -mtime +14 -delete
echo "[$STAMP] backup done: $(du -sh "$BACKUP_DIR" | cut -f1)"
