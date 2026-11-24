#!/bin/sh
# Auto-deploy (run every 2 minutes by nosorry-deploy.timer): pull the images GitHub built from main and restart only
# what changed. Public images, no credentials. Logs: journalctl -u nosorry-deploy
set -eu
cd /opt/nosorry
PROFILES=""; [ -s secrets/tailscale-authkey.txt ] && PROFILES="--profile public"
before=$(docker compose images -q web worker 2>/dev/null | sort | tr '\n' ' ')
docker compose $PROFILES pull -q web worker
docker compose $PROFILES up -d --remove-orphans
after=$(docker compose images -q web worker 2>/dev/null | sort | tr '\n' ' ')
if [ "$before" != "$after" ]; then
  echo "deployed: $(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' nosorry-web-1 2>/dev/null)"
  # Remove only old nosorry images, never another project's.
  docker image prune -f --filter "label=org.opencontainers.image.source=https://github.com/nosorry-maths/nosorry" >/dev/null
fi