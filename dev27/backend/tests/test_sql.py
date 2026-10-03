import asyncio
import json
import sqlite3
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from openai.types.chat import ChatCompletionMessage

from backend import agent
from backend.models import RoomState
from backend.seed import open_readonly, seed_database
from backend.sql_tools import discover_schema, execute_query


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "analytics.sqlite"
    seed_database(path)
    connection = open_readonly(path)
    yield connection
    connection.close()


def test_schema_and_generic_analytics(db):
    assert {table["name"] for table in discover_schema(db)} == {"customers", "subscriptions", "customer_monthly_metrics"}
    result = execute_query(db, "SELECT industry, count(*) AS n FROM customers WHERE segment=:segment GROUP BY industry ORDER BY industry", {"segment": "SMB"})
    assert sum(row["n"] for row in result["rows"]) == 7
    result = execute_query(db, "SELECT strftime('%Y-%m', month) AS period, avg(weekly_active_users) AS users FROM customer_monthly_metrics WHERE customer_id=:id AND month >= :start AND month < :end GROUP BY period ORDER BY period", {"id": "C001", "start": "2026-01-01", "end": "2026-04-01"})
    assert [row["users"] for row in result["rows"]] == [20, 12, 6]
    assert execute_query(db, "SELECT count(*) AS n FROM subscriptions WHERE cancelled_on>=:start AND cancelled_on<:end", {"start": "2026-05-01", "end": "2026-06-01"})["rows"] == [{"n": 1}]
    assert execute_query(db, "SELECT count(*) AS n FROM customers WHERE industry=:industry", {"industry": "' OR 1=1 --"})["rows"] == [{"n": 0}]


def test_non_analytics_tables_and_schema_are_not_exposed(db, tmp_path):
    with sqlite3.connect(tmp_path / "analytics.sqlite") as writer:
        writer.execute("CREATE TABLE config (secret TEXT DEFAULT 'private')")
        writer.execute("INSERT INTO config DEFAULT VALUES")
    assert "private" not in json.dumps(discover_schema(db))
    for sql in ["SELECT * FROM config", "SELECT sql FROM sqlite_master WHERE name='config'"]:
        with pytest.raises(sqlite3.DatabaseError):
            execute_query(db, sql, {})


@pytest.mark.parametrize("sql", [
    "DELETE FROM customers", "UPDATE customers SET segment='x'", "INSERT INTO customers VALUES ('x','x','x','x')",
    "CREATE TABLE hacked (x)", "DROP TABLE customers", "ALTER TABLE customers ADD COLUMN x", "PRAGMA table_info(customers)",
    "PRAGMA query_only=OFF", "ATTACH DATABASE ':memory:' AS extra", "DETACH DATABASE main", "VACUUM", "BEGIN",
    "SELECT load_extension('secret')", "SELECT readfile('/etc/passwd')", "SELECT randomblob(100000000)",
    "SELECT * FROM pragma_database_list", "SELECT * FROM sqlite_master", "SELECT 1; DELETE FROM customers",
])
def test_unsafe_sql_blocked(db, sql):
    with pytest.raises((sqlite3.Error, ValueError)):
        execute_query(db, sql, {})
    assert execute_query(db, "SELECT count(*) AS n FROM customers", {})["rows"] == [{"n": 20}]


def test_caps_budgets_and_error_recovery(db):
    result = execute_query(db, "SELECT * FROM customer_monthly_metrics", {}, row_cap=5)
    assert result["truncated"] and len(result["rows"]) == 5
    capped = execute_query(db, "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<600) SELECT x FROM n", {})
    assert capped["truncated"] and len(capped["rows"]) == 500
    costly = "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<100000000) SELECT sum(x) FROM n"
    for options in [{"operations": 1000}, {"seconds": 0}]:
        with pytest.raises(sqlite3.OperationalError, match="interrupted"):
            execute_query(db, costly, {}, **options)
    with pytest.raises(ValueError, match="unique aliases"):
        execute_query(db, "SELECT 1 AS n, 2 AS n", {})
    with pytest.raises(sqlite3.Error):
        execute_query(db, "SELECT nonexistent FROM customers", {})
    assert execute_query(db, "SELECT 42 AS answer WHERE 0", {})["columns"] == ["answer"]
    assert execute_query(db, "SELECT count(*) AS n FROM customers", {})["rows"][0]["n"] == 20
    with pytest.raises(ValueError, match="Non-finite"):
        execute_query(db, "SELECT 1e999 AS n", {})


class ToolClient:
    def __init__(self, calls):
        self.calls = iter(calls)
        self.messages = []
        self.chat = SimpleNamespace(completions=self)

    async def create(self, **kwargs):
        self.messages = kwargs["messages"]
        name, arguments = next(self.calls)
        message = ChatCompletionMessage(role="assistant", tool_calls=[{"id": str(uuid4()), "type": "function", "function": {"name": name, "arguments": json.dumps(arguments)}}])
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])

    async def close(self):
        pass


def test_tool_loop_recovers_and_grounds_result(db):
    client = ToolClient([
        ("execute_query", {"sql": "SELECT 1", "parameters": {}}),
        ("discover_schema", {}),
        ("execute_query", {"sql": "DELETE FROM customers", "parameters": {}}),
        ("execute_query", {"sql": "SELECT segment, count(*) AS customer_count FROM customers GROUP BY segment", "parameters": {}}),
        ("finish", {"action": "query", "query_index": 0, "summary": "20 synthetic customers", "presentation": "bar", "chartMetric": "customer_count"}),
    ])
    result = asyncio.run(agent.interpret("Count customers by segment", RoomState(), None, db, client))
    assert result.action == "query" and len(result.query["rows"]) == 2
    assert [attempt["status"] for attempt in result.attempts] == ["failed", "completed"]
    assert "Today's UTC date" in client.messages[0]["content"]
    assert "not payments, cash revenue" in client.messages[0]["content"]
    assert "secret" not in json.dumps([message for message in client.messages if message["role"] == "tool"])


def test_generic_room_history_csv_and_clarification(tmp_path):
    from backend.main import create_app

    async def interpret(text, room, pending):
        if text == "ambiguous":
            return agent.Decision(action="clarify", summary="Which observation period?")
        return agent.Decision(action="query", summary="Synthetic customer counts.", presentation="bar", chartMetric="n", query={"sql": "SELECT industry, count(*) AS n FROM customers GROUP BY industry", "parameters": {}, "columns": ["industry", "n"], "rows": [{"industry": "Retail", "n": 16}], "truncated": False})

    async def run():
        app = create_app(tmp_path / "sample.sqlite", interpret)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            async def send(text):
                return (await client.post("/api/rooms/demo/messages", json={"clientMessageId": str(uuid4()), "author": "Aryan", "text": text})).json()
            state = await send("ambiguous")
            assert state["history"][0]["status"] == "awaiting_clarification"
            state = await send("all customers")
            assert len(state["history"]) == 1 and state["history"][0]["clarifications"]
            result = state["results"][0]
            assert result["kind"] == "query" and result["columns"][1]["key"] == "n"
            assert state["history"][0]["sql"].startswith("SELECT industry")
            assert "industry,n" in (await client.get(result["downloadUrl"])).text
            assert not state["busy"]
    asyncio.run(run())


def test_production_tools_capture_history_and_recover_provider_failure(tmp_path, monkeypatch):
    from backend.main import create_app

    sql = "SELECT count(*) AS customer_total FROM customers WHERE segment=:segment"
    clients = iter([
        ToolClient([("discover_schema", {}), ("execute_query", {"sql": "DELETE FROM customers", "parameters": {}}),
                    ("execute_query", {"sql": sql, "parameters": {"segment": "SMB"}})]),
        ToolClient([("discover_schema", {}), ("execute_query", {"sql": sql, "parameters": {"segment": "SMB"}}),
                    ("finish", {"action": "query", "query_index": 0, "summary": "7 synthetic SMB customers", "presentation": "bar", "chartMetric": "not_a_column"})]),
    ])
    monkeypatch.setattr(agent, "AsyncOpenAI", lambda **kwargs: next(clients))

    async def run():
        app = create_app(tmp_path / "sample.sqlite")
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            async def send():
                return (await client.post("/api/rooms/demo/messages", json={"clientMessageId": str(uuid4()), "author": "Aryan", "text": "Count SMB customers"})).json()
            failed = await send()
            assert failed["history"][-1]["status"] == "failed" and not failed["busy"]
            assert [item["status"] for item in failed["history"][-1]["executions"]] == ["failed", "completed"]
            state = await send()
            entry = state["history"][-1]
            assert entry["sql"] == sql and entry["parameters"] == {"segment": "SMB"}
            assert entry["status"] == "completed" and entry["rowCount"] == 1
            result = state["results"][-1]
            assert result["rows"] == [{"customer_total": 7}] and result["chartMetric"] == "customer_total"
            assert "customer_total\r\n7" in (await client.get(result["downloadUrl"])).text
    asyncio.run(run())


@pytest.mark.parametrize("action", ["clarify", "unsupported"])
def test_tool_finishes_without_query(db, action):
    client = ToolClient([("finish", {"action": action, "summary": "Actual cash revenue requires a payment ledger."})])
    answer = asyncio.run(agent.interpret("Actual revenue?", RoomState(), None, db, client))
    assert answer.action == action and answer.query is None and answer.attempts == []
