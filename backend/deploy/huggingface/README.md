# Deploying the backend to Hugging Face Spaces (no card required)

Free CPU Basic Spaces give 2 vCPU / 16GB RAM via a Docker container - no
credit card, no billing account, just an email signup. Trade-off: a Space
sleeps after a period of inactivity and cold-starts on the next request
(same idea as Render's free tier, just no card gate).

## 1. Create the Space

1. Sign up at https://huggingface.co/join (email only).
2. Go to https://huggingface.co/new-space.
3. **Owner**: your account. **Space name**: `conceptintel-backend`.
4. **License**: whatever you like (doesn't affect functionality).
5. **Select the Space SDK**: choose **Docker** -> **Blank**.
6. **Space hardware**: leave it on the free **CPU basic** tier.
7. **Visibility**: Public or Private, your choice - private still gets a
   normal HTTPS URL, it's just not listed publicly.
8. Click **Create Space**. This gives you a new, empty git repo at
   `https://huggingface.co/spaces/<your-username>/conceptintel-backend`.

## 2. Push the backend code into it

From your own machine, in the main ConceptIntel repo:

```bash
cd backend
git init -b main /tmp/conceptintel-space   # or any scratch folder outside this repo
cp -r . /tmp/conceptintel-space/           # copies Dockerfile, app/, requirements.txt, etc.
cp deploy/huggingface/SPACE_README.md /tmp/conceptintel-space/README.md   # HF's required metadata file
rm -rf /tmp/conceptintel-space/.venv /tmp/conceptintel-space/__pycache__ /tmp/conceptintel-space/.git

cd /tmp/conceptintel-space
git init
git remote add space https://huggingface.co/spaces/<your-username>/conceptintel-backend
git add .
git commit -m "Initial backend deploy"
git push --force space main
```

You'll be prompted for HF credentials on push - use a Hugging Face **access
token** (Settings -> Access Tokens -> New token, "Write" role) as the
password, not your account password.

## 3. Set environment variables (as Space Secrets, not plain Variables)

In the Space page -> **Settings** -> **Variables and secrets** -> **New
secret**, add each of these (same list as the Render/Railway/Oracle guides):

- `DATABASE_URL` (Supabase pooler string)
- `JWT_SECRET` (generate with `openssl rand -hex 32`)
- `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`
- `OPENROUTER_API_KEY`
- `REDIS_URL` (Upstash `rediss://...`)
- `SUPABASE_URL`, `SUPABASE_KEY` (so uploads persist - the Space's own
  filesystem is ephemeral and wiped on every restart/sleep)
- `GOOGLE_CLIENT_ID`, `SMTP_EMAIL`, `SMTP_APP_PASSWORD` if you want those
  features working
- `FRONTEND_URL`, `ALLOWED_ORIGINS` - fill these in once your Vercel URL exists

Saving a secret triggers an automatic rebuild.

## 4. Run the one-off migration scripts once

From your own machine, pointed at the production database:

```bash
cd backend
DATABASE_URL="<same value as the Space secret>" .venv/Scripts/python.exe scripts/add_pending_result_column.py
```

(repeat for every script in `backend/scripts/add_*.py`, in the order they
were added - see the main deploy README for the full list)

## 5. Verify

Your Space's public URL is:
`https://<your-username>-conceptintel-backend.hf.space`

```bash
curl https://<your-username>-conceptintel-backend.hf.space/health
```

Expect `{"status":"ok","database":"connected"}`. Check the Space's **Logs**
tab if it doesn't come up - that's where uvicorn/startup errors show.

## 6. Connect the frontend

On Vercel, set `VITE_API_URL=https://<your-username>-conceptintel-backend.hf.space/api`
and redeploy. Then update this Space's `FRONTEND_URL`/`ALLOWED_ORIGINS`
secrets to your Vercel URL (triggers a rebuild automatically).

## Re-deploying after future commits

Repeat step 2's `cp -r . /tmp/conceptintel-space/` + commit + push whenever
`backend/` changes - there's no GitHub auto-sync for a Space unless you set
up a GitHub Action to mirror pushes (optional, ask if you want that wired up).
