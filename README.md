# Q-Agent Churn Room

A shared, synthetic-data customer churn investigation for Finance, Product, Sales, and custom participants. The application source is in `dev27/`.

## Start Locally Or On A Linux VM

From `dev27/`:

```bash
npm ci
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
```

Set `OPENAI_API_KEY` in the server environment, or create a git-ignored `backend/.env.local` containing the key. Keep credentials server-side. The frontend requires no API key. Use Node.js 22 or later, Python 3.12, and Bash.

```bash
npm run build
npm run demo:start
```

The startup script runs Next.js on port 3000 and FastAPI on internal port 8000, stopping both if either exits. Publish only port 3000. Next.js proxies browser API calls to FastAPI on the same machine.

## Demo

Select or add a name/team, start the demo, and ask questions about the synthetic customer data. Multiple browsers share one conversation and selected customers. Results include tables/charts, executed SQL, parameters, history, and CSV downloads.

There are 20 fictional customers with January-June 2026 metrics. Q2 churn is four customers and $8,000 in lost monthly subscription rates: SMB 3/7 (42.9%), Enterprise 1/13 (7.7%). Subscription rates are not actual cash revenue. Observations do not establish why customers left.

Participant names persist in `backend/participants.sqlite3`; conversation and query results reset on backend restart. Runtime data and credentials are not committed. No authentication or permissions are implemented; do not connect real or sensitive data.

## Freestyle Demo VM

Freestyle supports a temporary hackathon demo on a full Linux VM. It is not a production hosting platform with autoscaling/CDN guarantees. A valid `FREESTYLE_API_KEY` is required; the API key is separate from `OPENAI_API_KEY`.

Install the app and its server-side model key on the VM, run the commands above, and configure Freestyle TLS ingress for the VM's port 3000. An unused `*.style.dev` hostname can be public and does not require Coshell preview authentication. Use the current [Freestyle CLI docs](https://www.freestyle.sh/docs/cli) and [domain routing docs](https://www.freestyle.sh/docs/vms/domains-cli).

See [backend instructions](dev27/backend/README.md), [frontend instructions](dev27/web/README.md), and [project setup](dev27/SETUP.md) for details.
