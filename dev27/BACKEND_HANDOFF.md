# Backend Handoff

## Current SQL Update

The historical notes below describe the earlier fixed-action implementation.
Production natural-language turns now use real schema-discovery and read-only
SQL execution tools with `gpt-4.1-mini` by default (or `OPENAI_MODEL`). Results have
dynamic columns and `kind: query`; history records SQL, parameters and execution
attempts. Q1 and other dates are not automatically rejected. No actual cash
revenue can be inferred from subscription rates. Frontend types and rendering
have been updated. See `SETUP.md` and `backend/README.md` for the current contract,
limits and verification commands. No running server restart is implied by edits.

## Historical Notes

Person 1 implementation is in `backend/`. The existing Next.js project remains
at the project root; Person 2 owns its frontend files. No frontend files were edited.

The FastAPI server is running on **127.0.0.1:8000** with one worker. Proxy
`/api/rooms/demo`, `/api/rooms/demo/messages`, and
`/api/rooms/demo/results/{resultId}.csv` from Next.js to that address. The
pre-existing LangGraph service on 2024 is not this room API.

From `/home/ubuntu/freddie/dev27`, start or restart with:

```sh
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Verified HTTP response:

```json
{
  "roomId": "demo",
  "revision": 0,
  "busy": false,
  "period": null,
  "customerIds": [],
  "messages": [],
  "results": [],
  "history": []
}
```

The exact shared response fields and column keys are implemented. Examples of
each result kind and model configuration are in `backend/README.md`. Expected
full result row counts are 4 churned, 12 metrics, and 2 comparison.

Author values are `Priya`, `Alex`, and `Sam`. Duplicate finished client IDs
return current state. Busy sends return 409 with `{"error":"room_busy"}`;
preserve the draft. All API responses use `Cache-Control: no-store`.

Sixteen deterministic tests pass, including concurrent POSTs, responsive GET during
a turn, model failure/timeout recovery, date boundaries, and immutable CSV rows.
`pip check` passes in the existing `.venv`.

**Model verified:** the standalone OpenAI adapter uses `gpt-6-luna` with the
server-side key in `backend/.env.local`. The backend was restarted to load it.
The real-model four-turn rehearsal passed: clarification, four churned customers
and $8,000, twelve pre-Q2 metric records, and two correct segment rows. GET state
recovery and the original four-row CSV after later results also passed.
`Last quarter` resolved to Q3 2026, not Q2. Explicit April-June 2026 normalized
to Q2 2026; Q1 2026 remained unsupported. No fake-model fallback is enabled.
The running room currently contains the adaptive-presentation rehearsal transcript and results.

## Presentation Contract Update

Approved by Divyanshi: Result adds `presentation` (`text`, `table`, `bar`, `line`),
`chartMetric` (numeric column key or null), and `summary` (query-derived text).
The agent chooses these from the question. Both backend and frontend are updated;
the production frontend was rebuilt and restarted on 3000. Source tables stay
expandable and CSV downloads do not change. A browser-submitted comparison
question produced a bar chart; text, tables, metric lines, and mobile layout were
also verified. No extra model framework or second inference call was added.

Room state survives browser refresh but resets on backend restart. The demo
has no authentication and must use synthetic data only.
