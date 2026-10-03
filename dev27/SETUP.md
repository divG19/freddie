# Shared SQL Analytics Room

The Next.js frontend proxies `/api/rooms/*` to the FastAPI room on port 8000.
The older LangGraph starter on port 2024 is separate from this room API.

From the project root:

```sh
npm install
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
```

Set `OPENAI_API_KEY` in the ignored `backend/.env.local`. Optionally set
`OPENAI_MODEL` (default `gpt-4.1-mini`) to a model available to your account
that supports Chat Completions function tools. There is no simulated fallback.

```sh
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1
npm run dev -- --hostname 0.0.0.0 --port 3000
```

Open http://localhost:3000. One process owns the shared in-memory messages,
results, cohort and history. Restart resets the room and reseeds its database.
There is no authentication or durable storage. Do not expose it or use secrets
or real customer data.

## Analytics

The model discovers the actual SQLite table definitions and calls a bounded
SQL execution tool. Natural questions are not limited to three actions or Q2.
Try customer counts by industry, monthly usage for a customer, May cancellations,
or segment churn rates with explicit date boundaries. Ambiguous requests should
produce a clarification. Relative dates use today's UTC date.

Data is synthetic: 20 customers, subscriptions started in 2025, cancellations
in April-June 2026, and monthly metrics for January-June 2026. Metrics even include
fake post-cancellation observations. `weekly_active_users` is a monthly average
of weekly counts. `monthly_revenue_usd` is a monthly subscription rate, NOT actual
cash or recognized revenue; there is no payment ledger.

SQLite's authorizer denies writes, DDL, PRAGMA, attach/detach, transactions,
unapproved functions, and reads outside the analytics tables/schema. Each query
has a 500-row cap, 0.5-second/200000-VM-operation budget, and SQL/cell size limits.
An eight-round model tool budget and 25-second turn timeout bound requests.
Expensive queries can therefore be rejected even when logically read-only.
Tables, dynamic numeric bar/line charts, CSV snapshots and query history remain
available. SQL and bound parameters plus successful/failed tool attempts are stored.
Line charts follow SQL row order and plot at most 100 points.

Legacy deterministic query/summary helpers remain available for existing callers;
production natural-language turns use the generic tools.

## Verification

```sh
LANGSMITH_TEST_TRACKING=false .venv/bin/python -m pytest backend/tests -q
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Disabling LangSmith test tracking avoids the unrelated starter integration test's
external tracing authentication requirement. Model availability and SQL safety
are separate: deterministic tests do not need OpenAI, live tool-calling does.
