#!/usr/bin/env bash
# One-time setup of the Kinnest VM (Ubuntu 24.04 ARM64). Run as root through `aws ssm start-session`. Safe to run again.
#   sudo bash ec2-setup.sh
# After this, releases arrive from the GitHub deploy workflow (see deploy/AWS_SETUP.md); no commands are run by hand.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }

# 2 GB swap: Postgres, the API and the worker share 2 GB of RAM
if ! swapon --show | grep -q /swapfile; then
  [ -f /swapfile ] || { fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile; }
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update -y
apt-get install -y unattended-upgrades curl unzip ca-certificates

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

if ! command -v aws >/dev/null 2>&1; then
  tmp=$(mktemp -d)
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o "$tmp/awscli.zip"
  unzip -q "$tmp/awscli.zip" -d "$tmp"
  "$tmp/aws/install"
fi

install -d -m 700 /opt/kinnest /opt/kinnest/releases

cat <<'MSG'
Next, by hand:
  1. docker login ghcr.io -u <github user>     (classic token with read:packages only)
  2. create /opt/kinnest/.env with mode 600    (see deploy/AWS_SETUP.md)
MSG
