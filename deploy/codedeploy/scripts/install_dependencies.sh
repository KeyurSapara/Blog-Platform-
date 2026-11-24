#!/bin/bash
set -euo pipefail
chown -R blog:blog /opt/blog/backend
cd /opt/blog/backend
sudo -u blog HOME=/opt/blog npm install --omit=dev --no-audit --no-fund
