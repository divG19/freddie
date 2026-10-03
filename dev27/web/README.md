# Q-Agent Churn Room Frontend

The existing Next.js frontend is reused at the project root (`dev27/`), rather than duplicated into `web/`. Backend API ownership and fields are unchanged. This folder contains frontend handoff notes only.

## Run

From `dev27/`, run `npm run dev -- --hostname 0.0.0.0 --port 3000`. Open the Coshell preview for port 3000. The backend must be running on port 8000; Next.js proxies `/api/rooms/*` to `http://127.0.0.1:8000/api/rooms/*`. Browser requests are same-origin. No frontend API key is needed.

`npm run build` checks the production build. `npx tsc --noEmit` checks TypeScript. Frontend files are `app/page.tsx`, `app/layout.tsx`, `components/churn-room.{tsx,css}`, `components/results-panel.tsx`, `components/history-panel.tsx`, `lib/room-api.ts`, `lib/demo-fixtures.ts`, and `next.config.ts`.

## Behavior

assistant-ui ExternalStoreRuntime renders the backend-owned messages. Only the display name is stored locally. Polling waits one second after each GET settles; revisions guard against stale responses. A failed submission retains the draft and its UUID for an intentional retry of the same author/text. Editing the text creates a new request. Draft edits made while a request is running are not cleared by its success.

Results come directly from stored backend rows. History and result selection are browser-local; downloads target each immutable result URL. The SVG chart skips missing points rather than treating them as zero. Fixtures are typed examples only and are never used by the live route.

## Rehearsal Checklist

- Open two independent browser contexts at the same URL, join as Priya and Alex.
- Ask which customers churned; receive the reporting-period clarification.
- Answer Q2 2026; confirm four customer rows and the agent's $8,000 summary.
- Ask for pre-churn metrics as Alex; confirm twelve rows and Willow's 20 / 12 / 6 user trend.
- Compare segments as Sam; confirm 42.9% SMB and 7.7% Enterprise.
- Refresh; confirm messages, results, and history reload from the server.
- Select the original result in history; download its four-row CSV after later results.
- Race two sends; confirm the rejected browser retains its draft and Retry reuses the UUID.
- Stop the backend; confirm the last result remains visible and reconnecting is shown.
- Try narrow mobile widths and a long message. Check history details and horizontal table scrolling.

Room history resets on backend restart. Reload the page after restarting a backend to establish its new revision baseline.

## Verified Handoff

The landing page asks for a name and team using separate dropdowns. Each offers an option to add a new value; defaults are Priya and Finance. Dropdown names come from `GET /api/rooms/demo/participants`, not a hardcoded frontend roster or chat messages. "Start demo" saves the selected name/team through `POST /api/rooms/demo/participants` before opening chat. A save failure preserves form values and keeps the user on onboarding for retry. New names appear in other browsers' dropdowns without requiring a chat message.

The persistent registry is `backend/participants.sqlite3`, initially seeded with Priya / Finance, Alex / Product, and Sam / Sales. New entries such as Div / Marketing survive backend restarts. Name/team pairs are case-insensitively unique. This registry is separate from the read-only synthetic customer dataset.

Chat, results, and history are hidden before starting. "Change participant" returns to the landing form without changing the shared room. Refresh restores the saved display identity and returns to the chat. The backend supplies the existing author field, for example `Div / Marketing`; preset pairs retain their original author names. This is not authentication, scheduling, membership management, or a separate customer dataset. Backend authors accept 1-80 trimmed characters; messages accept 1-4,000 characters.

Users can phrase questions naturally for the supported Q2 churn list, January-March metrics, and segment comparison actions. The backend chooses a table, bar chart, line chart, or text presentation. Other questions receive a scope explanation; the frontend does not introduce an additional model caller or arbitrary data tools.

"About demo data" explains the common source: `backend/seed.py` seeds 20 fictional customers, 20 subscriptions, and 120 January-June 2026 monthly metrics into a temporary SQLite database opened read-only. Participants query this same source, with one shared selected cohort. Changing identity does not change data.

Production build and TypeScript checks pass. Targeted frontend oxlint checks pass. `web/tests/churn-room.cjs` uses Playwright and typed fixture responses shared across independent browser contexts; it covers the happy UI flow, revision ordering, busy drafts, retry UUIDs, preserving new drafts during a send, null chart values, prior CSV URLs, refresh, and mobile layout. It is not proof of a working model call.

For this workspace, test dependencies are installed outside the app in `/tmp/opencode`. Run `NODE_PATH=/tmp/opencode/node_modules node web/tests/churn-room.cjs` from `dev27/`. The external installation needs `playwright` and TypeScript 5; Chromium and its Linux dependencies must also be installed. Screenshots are saved to `/tmp/opencode/churn-room-desktop.png` and `/tmp/opencode/churn-room-mobile.png`.

The real Next.js-to-FastAPI GET and POST proxy was verified in two independent browser contexts, including remote message delivery and refresh recovery. The backend model connection is now configured. Real-agent result rendering, a follow-up POST, cross-browser updates, history selection, metric selection, and the original four-row CSV download were verified against the production frontend. The live route does not fall back to fixtures.

Custom-participant verification also passed against the real model in two browser contexts: Priya selected four churned customers, Div / Marketing received twelve metrics for those same IDs and appeared in shared history, refresh restored Div's identity, and Sam received two segment rows. The original four-row CSV stayed unchanged. Seven backend tests pass, including blank/overlong author rejection before a model call.

The new onboarding gate, separate selectors, adding both a name and a team, returning to onboarding, and identity restoration pass browser tests. Real-model testing verified Priya's four-row churn result, Div / Marketing's twelve-row metrics for the same IDs, and a readable unsupported-question response. Distinct React keys for chart and source table prevent duplicate chart nodes during polling. Onboarding screenshots are `/tmp/opencode/churn-onboarding-desktop.png` and `/tmp/opencode/churn-onboarding-mobile.png`.

Persistent-participant verification: Div / Marketing was saved through the real browser UI, appeared in another browser before sending any message, and remained after an actual backend restart. The chat was left empty. `backend/tests/test_participants.py` verifies default seeding, restart persistence, case-insensitive duplicates, input validation, and no room-state changes. The 43 top-level backend tests pass; the unrelated original LangSmith integration test requires a valid token and returns 401 in this environment.

The preview now runs the production server on port 3000 to avoid the preview proxy's failing development HMR connection. Start it with `npm run build` followed by `npm run start -- --hostname 0.0.0.0 --port 3000`. Production logs are in `/tmp/opencode/churn-frontend-production.log`. After frontend changes, rebuild and restart this server; hot reload is intentionally not used for the demo.

Preview: https://021c41945dfe57bc96683a654df4377d--3000.coshell.ai/
