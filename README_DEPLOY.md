# Explain This backend update: Contracts + Pro Legal route

## What changed
- Added JSON contract schemas:
  - `GET /contract/standard_v2`
  - `GET /contract/legal_v1`
  - Files live in `backend/contracts/`
- Added **new** Pro Legal endpoint (does NOT modify `/explain_v2`):
  - `POST /explain_legal_v1`

## Local run
```bash
cd backend
npm install
node server.cjs
```

## Test
```bash
curl -X POST http://localhost:3000/explain_legal_v1 \
  -H "Content-Type: application/json" \
  -d '{"text":"Dit is een testbrief...","context":"","legal_type":"bezwaar","tone":"neutral","output_language":"nl"}'
```

## Deploy to Render (Git connected)
From your backend repo folder:
```bash
git status
git add server.cjs contracts PROMPT_LEGAL.md
git commit -m "Add contracts + Pro Legal endpoint /explain_legal_v1"
git push
```
Render will auto-deploy if it is connected to your Git repo.

If you deploy via Render dashboard manual deploy, click **Manual Deploy → Deploy latest commit**.
