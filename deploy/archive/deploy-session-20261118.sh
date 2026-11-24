#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
exec 9>/var/lock/lifehub-deploy.lock
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
live=/srv/lifehub
upload=/home/lifeadmin/lifehub-session-20261118
target="$live/frontend/src/lib/api.ts"

# Refuse to replace a different server revision or a modified upload.
python3 - "$target" "$upload" <<'PY'
import hashlib, json, pathlib, sys
target, upload = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
checks = json.loads((upload / 'checksums.json').read_text())
digest = lambda path: hashlib.sha256(path.read_text().encode()).hexdigest()
if digest(target) != checks['before']:
    raise SystemExit('Server source differs from the tested baseline. No changes made.')
if digest(upload / 'api.ts') != checks['after']:
    raise SystemExit('Uploaded source checksum mismatch. No changes made.')
print('Source baseline and upload checksums OK')
PY

dc() { docker compose -p lifehub --env-file "$live/.env.production" -f "$live/compose.production.yaml" "$@"; }
dc config --quiet
container=$(dc ps -q frontend)
[[ -n "$container" ]]
old_image=$(docker inspect -f '{{.Image}}' "$container")
image_tag=$(docker inspect -f '{{.Config.Image}}' "$container")
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="/var/backups/lifehub/session-$stamp"
install -d -m 700 "$backup"
cp -a "$target" "$backup/api.ts"
docker tag "$old_image" "lifehub-frontend:before-session-$stamp"
changed=0
recreated=0
rollback() {
  result=$?
  if (( result != 0 && changed )); then
    echo 'Deployment failed. Restoring the previous frontend source and image.' >&2
    cp -a "$backup/api.ts" "$target" || true
    docker tag "$old_image" "$image_tag" || true
    if (( recreated )); then dc up -d --no-build --no-deps --wait --wait-timeout 120 frontend || true; fi
  fi
  exit "$result"
}
trap rollback EXIT
changed=1
install -m 644 "$upload/api.ts" "$target"
dc build frontend
recreated=1
dc up -d --no-build --no-deps --wait --wait-timeout 120 frontend
python3 - <<'PY'
import re, urllib.request
base = 'https://lifehapp.online'
def fetch(path):
    with urllib.request.urlopen(base + path, timeout=30) as response:
        assert response.status == 200
        return response.read().decode()
html = fetch('/')
fetch('/health/ready')
assets = re.findall(r'src="(/assets/[^"?]+\.js)"', html)
assert assets, 'No frontend script found'
assert any('lifehub.auth.refresh' in fetch(path) for path in assets), 'New session code is not publicly served'
print('Public readiness and persistent-session frontend verified')
PY
trap - EXIT
echo "SESSION_DEPLOYMENT_OK $stamp"
echo "Rollback source: $backup/api.ts; image: lifehub-frontend:before-session-$stamp"
