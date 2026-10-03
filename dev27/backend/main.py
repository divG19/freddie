"""Single-process shared demo room. No authentication or durable room storage."""
import asyncio
import csv
import io
import logging
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, Response
from fastapi.responses import JSONResponse

from backend import agent, participants
from backend.models import Clarification, HistoryEntry, Message, MessageRequest, Participant, ParticipantRequest, Result, RoomState
from backend.seed import open_readonly, seed_database


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def create_app(database_path=None, interpreter=None, model_timeout=25, participants_path=None):
    temporary = tempfile.TemporaryDirectory(prefix="churn-room-") if database_path is None else None
    path = Path(database_path) if database_path is not None else Path(temporary.name) / "sample.sqlite"
    seed_database(path)
    db = open_readonly(path)
    participant_path = Path(participants_path) if participants_path is not None else (
        path.with_name("participants.sqlite3") if database_path is not None else Path(__file__).with_name("participants.sqlite3")
    )
    participants.initialize(participant_path)
    room = RoomState()
    lock = asyncio.Lock()
    completed_ids = set()
    pending = None
    interpret = interpreter

    @asynccontextmanager
    async def lifespan(app):
        yield
        db.close()
        if temporary:
            temporary.cleanup()

    app = FastAPI(title="Q-Agent Churn Room", lifespan=lifespan)

    @app.middleware("http")
    async def no_cache(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/rooms/demo", response_model=RoomState)
    async def get_room():
        return room.model_copy(deep=True)

    @app.get("/api/rooms/demo/participants", response_model=list[Participant])
    async def get_participants():
        return participants.list_participants(participant_path)

    @app.post("/api/rooms/demo/participants", response_model=Participant)
    async def add_participant(body: ParticipantRequest):
        return participants.save_participant(participant_path, body.name, body.team)

    @app.post("/api/rooms/demo/messages", response_model=RoomState)
    async def post_message(body: MessageRequest):
        nonlocal pending
        if body.clientMessageId in completed_ids:
            return room.model_copy(deep=True)
        if lock.locked():
            return JSONResponse({"error": "room_busy"}, status_code=409)
        await lock.acquire()
        room.busy = True
        room.messages.append(Message(id=body.clientMessageId, author=body.author, role="user", text=body.text, createdAt=now()))
        room.revision += 1
        entry = None
        try:
            if interpret is None:
                if pending:
                    entry = next(h for h in room.history if h.id == pending["historyId"])
                else:
                    entry = HistoryEntry(id=str(uuid4()), author=body.author, question=body.text, createdAt=now(), status="awaiting_clarification")
                    room.history.append(entry)
                decision = await asyncio.wait_for(agent.interpret(body.text, room.model_copy(deep=True), dict(pending) if pending else None, db, attempts=entry.executions), timeout=model_timeout)
            else:
                decision = agent.Decision.model_validate(await asyncio.wait_for(interpret(body.text, room.model_copy(deep=True), dict(pending) if pending else None), timeout=model_timeout))
            generic = decision.action in ("query", "clarify") or interpret is None
            if generic and pending:
                entry = next(h for h in room.history if h.id == pending["historyId"])
                entry.clarifications.append(Clarification(author=body.author, text=body.text))
            elif generic and entry is not None:
                pass
            elif pending and decision.period is not None and decision.action != "unsupported":
                entry = next(h for h in room.history if h.id == pending["historyId"])
                entry.clarifications.append(Clarification(author=body.author, text=body.text))
                decision.action = pending["action"]
                if decision.presentation == "auto":
                    decision.presentation = pending.get("presentation", "auto")
                if decision.chartMetric is None:
                    decision.chartMetric = pending.get("chartMetric")
            else:
                entry = HistoryEntry(id=str(uuid4()), author=body.author, question=body.text, createdAt=now(), status="awaiting_period")
                room.history.append(entry)
                if pending:
                    next(h for h in room.history if h.id == pending["historyId"]).status = "unsupported"
                pending = None
            result_id = None
            if generic:
                entry.executions = decision.attempts
                text = decision.summary
                if decision.action == "query":
                    query = decision.query
                    rows = query["rows"]
                    numeric = [key for key in query["columns"] if any(isinstance(row.get(key), (int, float)) and not isinstance(row.get(key), bool) for row in rows)]
                    metric = decision.chartMetric if decision.chartMetric in numeric else next(iter(numeric), None)
                    presentation = decision.presentation if decision.presentation != "auto" else "table"
                    if presentation in ("bar", "line") and (not metric or any(not isinstance(row.get(metric), (int, float)) or row.get(metric, 0) < 0 for row in rows)):
                        presentation = "table"
                    if query["truncated"]:
                        text += " Result truncated to 500 rows; this is not the complete result."
                    text += " Synthetic data; monthly subscription rates are not actual cash revenue."
                    result_id = str(uuid4())
                    room.results.append(Result(id=result_id, kind="query", title=decision.title, columns=[{"key": key, "label": "Monthly subscription rate (USD)" if key == "monthly_revenue_usd" else key.replace("_", " ")} for key in query["columns"]], rows=rows, downloadUrl=f"/api/rooms/demo/results/{result_id}.csv", presentation=presentation, chartMetric=metric if presentation in ("bar", "line") else None, summary=text, truncated=query["truncated"]))
                    entry.status = "completed"
                    entry.queryId = "sql"
                    entry.sql, entry.parameters = query["sql"], query["parameters"]
                    entry.rowCount, entry.resultId = len(rows), result_id
                    if "customer_id" in query["columns"]:
                        room.customerIds = list(dict.fromkeys(row["customer_id"] for row in rows if isinstance(row.get("customer_id"), str)))
                    pending = None
                elif decision.action == "clarify":
                    entry.status = "awaiting_clarification"
                    pending = {"historyId": entry.id, "question": entry.question}
                else:
                    entry.status = "unsupported"
                    pending = None
            elif decision.action == "unsupported" or (decision.period is not None and decision.period != "Q2 2026"):
                entry.status = "unsupported"
                entry.filters = {"period": decision.period}
                pending = None
                text = "This synthetic demo supports only Q2 2026 (April 1-June 30) churn, January-March metrics for that group, and segment comparisons. No data was queried for the requested period or action."
            elif (decision.action == "list_churned" and decision.period is None) or (decision.action != "list_churned" and not room.customerIds):
                pending = {"action": "list_churned", "historyId": entry.id, "presentation": decision.presentation, "chartMetric": decision.chartMetric}
                entry.status = "awaiting_period"
                text = "Which churn reporting period should I use? This demo supports Q2 2026 (April-June). Select that period first to establish the shared customer group."
            else:
                kind, title, rows, sql, params, text = agent.dispatch(db, decision.action, list(room.customerIds))
                result_id = str(uuid4())
                presentation, metric = agent.presentation_for(decision, kind)
                result = Result(id=result_id, kind=kind, title=title, columns=[{"key": key, "label": label} for key, label in agent.COLUMNS[kind]], rows=rows, downloadUrl=f"/api/rooms/demo/results/{result_id}.csv", presentation=presentation, chartMetric=metric, summary=text)
                room.results.append(result)
                if kind == "churned":
                    room.customerIds = [r["customer_id"] for r in rows]
                    room.period = "Q2 2026"
                entry.status = "completed"
                entry.filters = {"period": "Q2 2026", "start": params["start"], "end": params["end"]}
                entry.queryId = decision.action
                entry.sql, entry.parameters = sql, params
                entry.rowCount, entry.resultId = len(rows), result_id
                pending = None
            room.messages.append(Message(id=str(uuid4()), author="Q-Agent", role="assistant", text=text, createdAt=now(), resultId=result_id))
            completed_ids.add(body.clientMessageId)
        except Exception as error:
            logging.getLogger(__name__).warning("Agent turn failed (%s)", type(error).__name__)
            if entry is None:
                entry = HistoryEntry(id=str(uuid4()), author=body.author, question=body.text, createdAt=now(), status="failed")
                room.history.append(entry)
            entry.status = "failed"
            pending = None
            room.messages.append(Message(id=str(uuid4()), author="Q-Agent", role="assistant", text="The agent could not complete this request. Check the server's model connection and try again with a new message.", createdAt=now()))
            completed_ids.add(body.clientMessageId)
        finally:
            room.busy = False
            room.revision += 1
            lock.release()
        return room.model_copy(deep=True)

    @app.get("/api/rooms/demo/results/{result_id}.csv")
    async def download_result(result_id: str):
        result = next((r for r in room.results if r.id == result_id), None)
        if result is None:
            return JSONResponse({"error": "result_not_found"}, status_code=404)
        output = io.StringIO(newline="")
        writer = csv.DictWriter(output, fieldnames=[c.key for c in result.columns])
        writer.writeheader()
        writer.writerows(result.rows)
        return Response(output.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{result.kind}-{result.id}.csv"'})

    return app


app = create_app()
