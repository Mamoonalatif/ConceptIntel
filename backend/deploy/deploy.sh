#!/usr/bin/env bash
# Re-deploy script for the Oracle Cloud VM - run this over SSH after the initial
# setup (see backend/deploy/README.md) to pull and apply new commits.
set -euo pipefail

cd "$(dirname "$0")/.."   # backend/

git pull origin main
.venv/bin/pip install -r requirements.txt
sudo systemctl restart conceptintel-backend
sudo systemctl status conceptintel-backend --no-pager
