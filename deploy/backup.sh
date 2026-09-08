#!/bin/sh
set -eu
umask 077
cd /srv/lifehub
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="/var/backups/lifehub/postgres-${stamp}.dump"
docker compose --env-file .env.production -f compose.production.yaml exec -T db pg_dump -U lifehub -d lifehub -Fc > "${file}.tmp"
test -s "${file}.tmp"
mv "${file}.tmp" "$file"
# Keep every backup until an off-server copy and retention policy are agreed.
