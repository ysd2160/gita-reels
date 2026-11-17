#!/usr/bin/env bash
# Run ONCE on a fresh Ubuntu 24.04 EC2 instance:   bash deploy/setup-ec2.sh
# (after you copied the project to ~/automation-claude and created .env)
set -euo pipefail
APP_DIR="$HOME/automation-claude"

echo "== 1/6 system packages"
sudo apt-get update -y
sudo apt-get install -y curl ca-certificates gnupg git unzip ffmpeg nginx certbot python3-certbot-nginx \
  libnss3 libdbus-1-3 libatk1.0-0t64 libatk-bridge2.0-0t64 libasound2t64 libxrandr2 libxkbcommon-dev libxfixes3 \
  libxcomposite1 libxdamage1 libgbm-dev libcups2t64 libpango-1.0-0 libcairo2 fonts-noto-core fonts-noto-color-emoji

echo "== 2/6 Node 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "== 3/6 swap (4 GB) so a heavy render never kills the server"
if [ ! -f /swapfile ]; then
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "== 4/6 app dependencies"
cd "$APP_DIR"
npm ci
npm run build:editor
npx remotion browser ensure   # downloads the headless Chrome used for rendering

echo "== 5/6 systemd service (auto-start + auto-restart)"
sed "s|__USER__|$USER|g; s|__APP_DIR__|$APP_DIR|g" deploy/gita-reels.service | sudo tee /etc/systemd/system/gita-reels.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now gita-reels

echo "== 6/6 nginx"
sudo cp deploy/nginx.conf /etc/nginx/sites-available/gita-reels
sudo ln -sf /etc/nginx/sites-available/gita-reels /etc/nginx/sites-enabled/gita-reels
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo
echo "Done. Check:  curl http://127.0.0.1:4000/healthz   |   journalctl -u gita-reels -f"
echo "HTTPS (needs a domain pointing to this server):  sudo certbot --nginx -d reels.yourdomain.com"
