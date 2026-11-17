#!/usr/bin/env bash
set -euo pipefail
cd "$HOME/automation-claude"
git pull --ff-only
npm ci
npm run build:editor
sudo systemctl restart gita-reels
echo "Updated and restarted"