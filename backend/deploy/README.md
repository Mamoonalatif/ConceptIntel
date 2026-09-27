# Deploying the backend to an Oracle Cloud Always Free VM

One-time setup for hosting `backend/` on an Oracle Cloud "Always Free" Ampere
A1 instance instead of a PaaS (Railway/Render) - a real, permanent free VM
with enough RAM to comfortably run the app's ML stack (torch/easyocr/fastembed),
at the cost of doing your own systemd/nginx/TLS setup.

## 1. Create the VM (OCI Console)

1. Sign up at https://cloud.oracle.com (needs a card for identity verification
   only - the Always Free resources are never billed).
2. Compute -> Instances -> Create Instance.
3. Image: **Canonical Ubuntu 22.04** (or latest LTS).
4. Shape: **VM.Standard.A1.Flex** (Ampere/ARM, "Always Free eligible") - pick up
   to 4 OCPUs / 24GB RAM, all still free.
5. Add your SSH public key (or let OCI generate a key pair for you - download it).
6. Networking: use the default VCN, and make sure it creates a **public IP**.
7. Create. Note the public IP once it's running.

## 2. Open firewall ports

OCI's default security list only allows SSH (22) in. Go to your VCN's
**Security List** and add ingress rules for:
- TCP 80 (HTTP, for certbot's initial challenge)
- TCP 443 (HTTPS)

## 3. SSH in and install dependencies

```bash
ssh -i /path/to/your/key ubuntu@<VM_PUBLIC_IP>

sudo apt update && sudo apt upgrade -y
sudo apt install -y python3.11 python3.11-venv git nginx certbot python3-certbot-nginx

git clone https://github.com/Mamoonalatif/ConceptIntel.git
cd ConceptIntel/backend
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## 4. Configure environment

```bash
cp .env.example .env
nano .env   # fill in DATABASE_URL, JWT_SECRET, NEO4J_*, OPENROUTER_API_KEY,
            # REDIS_URL, SUPABASE_URL/KEY, FRONTEND_URL, ALLOWED_ORIGINS, etc.
```

Then run every one-off migration script once against this DATABASE_URL (same
list as the Render/Railway guide) - `scripts/add_*.py`, in the order they were
added.

## 5. Install the systemd service

```bash
sudo cp deploy/conceptintel-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now conceptintel-backend
sudo systemctl status conceptintel-backend   # should show "active (running)"
```

This binds uvicorn to `127.0.0.1:8000` only - nginx is what actually faces the
internet, next.

## 6. Install nginx + TLS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/conceptintel-backend
sudo nano /etc/nginx/sites-available/conceptintel-backend   # set server_name to your real domain
sudo ln -s /etc/nginx/sites-available/conceptintel-backend /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d api.yourdomain.com   # rewrites the config with a working HTTPS block
```

No domain yet? You can skip certbot and use `http://<VM_PUBLIC_IP>` directly,
but Vercel's frontend is served over HTTPS and most browsers block a mixed
HTTPS-page-calling-HTTP-API request - a real domain + certbot is strongly
recommended over the bare IP.

## 7. Verify

```bash
curl https://api.yourdomain.com/health
# {"status":"ok","database":"connected"}
```

Then on Vercel, set `VITE_API_URL=https://api.yourdomain.com/api` and redeploy
the frontend, and set `ALLOWED_ORIGINS`/`FRONTEND_URL` in this VM's `.env` to
your Vercel URL, then `sudo systemctl restart conceptintel-backend`.

## Re-deploying after future commits

```bash
ssh ubuntu@<VM_PUBLIC_IP>
cd ConceptIntel/backend && ./deploy/deploy.sh
```
