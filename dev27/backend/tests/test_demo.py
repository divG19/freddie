import asyncio
import csv
import io
from uuid import uuid4

import httpx
import pytest

from backend.seed import seed_database, open_readonly
from backend.queries import list_churned, show_metrics, compare_segments


def test_queries(tmp_path):
    path = tmp_path / "sample.sqlite"
    seed_database(path)
    db = open_readonly(path)
    rows, _, _ = list_churned(db)
    ids = [r["customer_id"] for r in rows]
    assert len(set(ids)) == 4
    assert sum(r["monthly_revenue_usd"] for r in rows) == 8000
    metrics, _, _ = show_metrics(db, ids)
    assert len({(r["customer_id"], r["month"]) for r in metrics}) == 12
    assert [(r["weekly_active_users"], r["resolution_hours"]) for r in metrics[:3]] == [(20, 2), (12, 5), (6, 9)]
    comparison, _, _ = compare_segments(db)
    assert [(r["total_count"], r["churned_count"], r["churn_rate_pct"]) for r in comparison] == [(13, 1, 7.7), (7, 3, 42.9)]
    with pytest.raises(Exception):
        db.execute("DELETE FROM customers")
    db.close()


@pytest.mark.parametrize("kind,requested,metric,expected,expected_metric", [
    ("churned", "auto", None, "table", None),
    ("metrics", "auto", None, "line", "weekly_active_users"),
    ("comparison", "auto", None, "bar", "churn_rate_pct"),
    ("metrics", "line", "resolution_hours", "line", "resolution_hours"),
    ("comparison", "line", "resolution_hours", "bar", "churn_rate_pct"),
    ("churned", "bar", None, "bar", "monthly_revenue_usd"),
    ("metrics", "text", None, "text", None),
    ("comparison", "table", None, "table", None),
])
def test_presentation_validation(kind, requested, metric, expected, expected_metric):
    from backend.agent import Decision, presentation_for
    decision = Decision(action="list_churned", period="Q2 2026", presentation=requested, chartMetric=metric)
    assert presentation_for(decision, kind) == (expected, expected_metric)


def test_presentation_clarification_and_result_storage(tmp_path):
    from backend.main import create_app
    from backend.agent import Decision

    async def interpret(text, *args):
        if text == "chart churn":
            return Decision(action="list_churned", period=None, presentation="bar")
        if text == "metrics as text":
            return Decision(action="show_metrics", period=None, presentation="text")
        return Decision(action="list_churned", period="Q2 2026")

    async def run():
        app = create_app(tmp_path / "sample.sqlite", interpret)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            async def send(text):
                return (await client.post("/api/rooms/demo/messages", json={"clientMessageId": str(uuid4()), "author": "Priya", "text": text})).json()
            await send("chart churn")
            state = await send("Q2 2026")
            original = state["results"][0]
            assert original["presentation"] == "bar"
            assert original["chartMetric"] == "monthly_revenue_usd"
            assert "$8,000" in original["summary"]
            state = await send("metrics as text")
            assert state["results"][-1]["presentation"] == "text"
            assert state["results"][-1]["chartMetric"] is None
            assert state["results"][0] == original
            assert len(list(csv.DictReader(io.StringIO((await client.get(original["downloadUrl"])).text)))) == 4
    asyncio.run(run())


def test_boundaries(tmp_path):
    import sqlite3
    path = tmp_path / "sample.sqlite"
    seed_database(path)
    with sqlite3.connect(path) as db:
        db.execute("UPDATE subscriptions SET cancelled_on='2026-04-01' WHERE customer_id='C001'")
        db.execute("UPDATE subscriptions SET cancelled_on='2026-07-01' WHERE customer_id='C002'")
    db = open_readonly(path)
    rows, _, _ = list_churned(db)
    assert {r["customer_id"] for r in rows} == {"C001", "C003", "C008"}
    db.close()


def test_conversation(tmp_path):
    from backend.main import create_app
    from backend.agent import Decision

    async def interpret(text, room, pending):
        if text == "fail":
            raise RuntimeError("secret provider failure")
        action = "show_metrics" if "doing" in text else "compare_segments" if "Compare" in text else "list_churned"
        period = "Q1 2026" if "Q1" in text else "Q2 2026" if "Q2" in text else None
        return Decision(action=action, period=period)

    async def run():
        app = create_app(tmp_path / "sample.sqlite", interpret)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            async def send(text, author="Priya", mid=None):
                return await client.post("/api/rooms/demo/messages", json={"clientMessageId": mid or str(uuid4()), "author": author, "text": text})
            assert (await send(" ")).status_code == 422
            first = (await send("Which customers churned?")).json()
            assert first["history"][0]["status"] == "awaiting_period"
            mid = str(uuid4())
            state = (await send("Q2 2026", mid=mid)).json()
            assert len(state["customerIds"]) == 4
            assert len(state["history"]) == 1
            assert state["history"][0]["clarifications"] == [{"author": "Priya", "text": "Q2 2026"}]
            assert "$8,000" in state["messages"][-1]["text"]
            assert (await send("Q2 2026", mid=mid)).json() == state
            original = state["results"][0]
            state = (await send("How were those customers doing?", "Alex")).json()
            assert len(state["results"][-1]["rows"]) == 12
            state = (await send("Compare them with customers who stayed", "Sam")).json()
            assert len(state["results"][-1]["rows"]) == 2
            assert (await client.get("/api/rooms/demo")).json() == state
            download = await client.get(original["downloadUrl"])
            parsed = list(csv.DictReader(io.StringIO(download.text)))
            assert parsed == [{k: str(v) for k, v in r.items()} for r in original["rows"]]
            assert download.headers["content-type"].startswith("text/csv")
            assert "attachment" in download.headers["content-disposition"]
            assert (await client.get("/api/rooms/demo/results/missing.csv")).status_code == 404
            state = (await send("Q1 2026")).json()
            assert state["history"][-1]["status"] == "unsupported"
            state = (await send("fail")).json()
            assert not state["busy"] and state["history"][-1]["status"] == "failed"
            assert "secret" not in state["messages"][-1]["text"]
            assert (await send("Q2 2026")).json()["history"][-1]["status"] == "completed"
    asyncio.run(run())


def test_timeout_and_unselected_followup(tmp_path):
    from backend.main import create_app
    from backend.agent import Decision

    async def interpret(text, *args):
        if text == "slow":
            await asyncio.sleep(1)
        return Decision(action="show_metrics", period=None)

    async def run():
        app = create_app(tmp_path / "sample.sqlite", interpret, model_timeout=0.01)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            async def send(text):
                return (await client.post("/api/rooms/demo/messages", json={"clientMessageId": str(uuid4()), "author": "Alex", "text": text})).json()
            state = await send("slow")
            assert not state["busy"] and state["history"][-1]["status"] == "failed"
            state = await send("show metrics")
            assert state["history"][-1]["status"] == "awaiting_period"
            assert state["customerIds"] == [] and state["results"] == []
            assert state["history"][-1]["sql"] is None
    asyncio.run(run())


def test_csv_escaping(tmp_path):
    from backend.main import create_app
    from backend.agent import Decision
    import sqlite3

    async def interpret(*args):
        return Decision(action="list_churned", period="Q2 2026")

    async def run():
        path = tmp_path / "sample.sqlite"
        app = create_app(path, interpret)
        with sqlite3.connect(path) as db:
            db.execute("UPDATE customers SET company_name=? WHERE customer_id='C001'", ('Willow, "Fashion"',))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            state = (await client.post("/api/rooms/demo/messages", json={"clientMessageId": str(uuid4()), "author": "Priya", "text": "Q2 2026"})).json()
            result = state["results"][0]
            response = await client.get(result["downloadUrl"])
            assert list(csv.DictReader(io.StringIO(response.text)))[0]["company_name"] == 'Willow, "Fashion"'
    asyncio.run(run())


def test_concurrency(tmp_path):
    from backend.main import create_app
    from backend.agent import Decision

    async def run():
        started, release = asyncio.Event(), asyncio.Event()
        async def interpret(*args):
            started.set()
            await release.wait()
            return Decision(action="list_churned", period="Q2 2026")
        app = create_app(tmp_path / "sample.sqlite", interpret)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            body = {"clientMessageId": str(uuid4()), "author": "Priya", "text": "Q2 churn"}
            first = asyncio.create_task(client.post("/api/rooms/demo/messages", json=body))
            await started.wait()
            assert (await client.get("/api/rooms/demo")).json()["busy"]
            other = await client.post("/api/rooms/demo/messages", json={**body, "clientMessageId": str(uuid4())})
            assert other.status_code == 409 and other.json() == {"error": "room_busy"}
            release.set()
            assert not (await first).json()["busy"]
    asyncio.run(run())


def test_custom_participant(tmp_path):
    from backend.main import create_app
    from backend.agent import Decision

    calls = []

    async def interpret(text, *args):
        calls.append(text)
        return Decision(action="show_metrics" if text == "metrics" else "list_churned", period="Q2 2026")

    async def run():
        app = create_app(tmp_path / "sample.sqlite", interpret)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            async def send(author, text="Q2 churn"):
                return await client.post("/api/rooms/demo/messages", json={"clientMessageId": str(uuid4()), "author": author, "text": text})

            for invalid in ["", "   ", "x" * 81]:
                assert (await send(invalid)).status_code == 422
            assert calls == []
            original = (await send("Priya")).json()
            response = await send("  Div / Marketing  ", "metrics")
            assert response.status_code == 200
            shared = response.json()
            assert shared["messages"][-2]["author"] == "Div / Marketing"
            assert shared["history"][-1]["author"] == "Div / Marketing"
            assert shared["customerIds"] == original["customerIds"]
            assert len(shared["results"][-1]["rows"]) == 12
            assert shared["results"][0] == original["results"][0]
            assert (await client.get("/api/rooms/demo")).json() == shared

    asyncio.run(run())
