#!/bin/bash
# Fails the deployment (and triggers auto-rollback) if the API does not come back healthy.
for _ in $(seq 1 30); do
  if curl -fs http://127.0.0.1/api/health; then
    echo
    cat /opt/blog/backend/RELEASE 2>/dev/null || true
    exit 0
  fi
  sleep 3
done
echo "API health check failed"
journalctl -u blog-api -n 50 --no-pager
exit 1
