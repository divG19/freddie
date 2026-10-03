# Q-Agent SQL Room Backend

See [SETUP.md](../SETUP.md) for startup, model configuration, safeguards and tests.
This is a single-process FastAPI application, not the separate LangGraph starter.

## API

- `GET /api/rooms/demo` returns the complete shared state.
- `POST /api/rooms/demo/messages` takes `{clientMessageId, author, text}`.
- `GET /api/rooms/demo/results/{resultId}.csv` downloads the immutable stored rows.
- `GET /api/rooms/demo/participants` returns saved `{name, team, author}` display identities.
- `POST /api/rooms/demo/participants` saves `{name, team}` (1-32 trimmed characters each) and returns the stored identity. Name/team pairs are case-insensitively unique; repeating a request reuses the entry.

Participant identities are saved in `backend/participants.sqlite3`, a persistent SQLite registry seeded with Priya / Finance, Alex / Product, and Sam / Sales. Starting a demo saves the chosen participant before entering chat. These records survive backend restart and are separate from the read-only customer dataset exposed to the agent. This remains display identity, not authentication or permission management. The registry file is excluded from version control.

Authors are trimmed display names of 1-80 characters; text is 1-4000 characters.
Concurrent sends return 409 `room_busy`. Completed message IDs are idempotent.
All responses use `Cache-Control: no-store`. A new message ID retries a failed turn.
Errors release the room lock and do not return provider error details or secrets.

## Model And Results

The real OpenAI Chat Completions function-tool loop discovers SQLite DDL and metric
coverage, executes bounded read queries, then selects a successful result to present.
The model can correct failed SQL within its eight-round tool budget. There is no
fixed-action requirement or arbitrary reporting-date restriction on natural queries.
Ambiguity is handled with a clarification recorded on the original history entry.
There is no fake-model fallback.

Production results have `kind: "query"`, dynamic `columns` and `rows`, `title`,
`summary`, `presentation` (`text`, `table`, `bar`, `line`), `chartMetric`,
`truncated`, and a stored CSV URL. Numeric metrics are checked against actual rows.
Negative or missing chart values fall back to a table. Line charts follow query
order. Query history stores SQL, named parameters and each tool execution's status.
Legacy kinds and deterministic helpers remain available to existing callers/tests.
Generic summaries are model-generated from tool output, not deterministic proofs.

Example question: `Count SMB customers by industry as a bar chart`.

```json
{
  "kind": "query",
  "columns": [
    { "key": "industry", "label": "industry" },
    { "key": "n", "label": "n" }
  ],
  "rows": [{ "industry": "Retail", "n": 4 }],
  "presentation": "bar",
  "chartMetric": "n",
  "truncated": false
}
```

## Data

20 fake customers have one subscription each and six monthly metric rows each,
January-June 2026. Four April-June cancellations represent $8000 in monthly
subscription rates, not actual cash revenue. No payment ledger exists. Metrics
include synthetic observations after cancellation and do not prove churn causes.
For Q2's entering cohort, SMB churn is 3/7 and Enterprise churn is 1/13.

The database is seeded per app instance and served read-only with an authorizer.
Messages, results, cohort and history are in memory and reset on restart. Run one
worker. The unauthenticated demo must not be connected to sensitive real data.
