"""Bounded analytics on the serving database, independent of model instructions."""
import math
import sqlite3
import time

TABLES = {"customers", "subscriptions", "customer_monthly_metrics"}
FUNCTIONS = set("abs avg ceil ceiling coalesce concat concat_ws count date datetime floor format glob group_concat string_agg ifnull iif instr julianday length like lower ltrim max min nullif printf replace round rtrim strftime substr substring sum time total trim typeof unixepoch upper sqrt pow power log log10 ln exp sign mod trunc row_number rank dense_rank lag lead first_value last_value nth_value ntile percent_rank cume_dist json_extract json_array json_object json_group_array json_group_object".split())


def authorize(action, first, second, database, source):
    if action in (sqlite3.SQLITE_SELECT, sqlite3.SQLITE_RECURSIVE):
        return sqlite3.SQLITE_OK
    # SQLite omits the database for COUNT(*)'s column-free table read.
    if action == sqlite3.SQLITE_READ and database in ("main", None) and first in TABLES:
        return sqlite3.SQLITE_OK
    if action == sqlite3.SQLITE_FUNCTION and (second or "").lower() in FUNCTIONS:
        return sqlite3.SQLITE_OK
    return sqlite3.SQLITE_DENY


def discover_schema(db):
    def schema_authorizer(action, first, second, database, source):
        if action == sqlite3.SQLITE_READ and first == "sqlite_master" and database == "main":
            return sqlite3.SQLITE_OK
        return authorize(action, first, second, database, source)

    # Schema access is confined to this fixed filtered discovery query.
    db.set_authorizer(schema_authorizer)
    try:
        return [dict(row) for row in db.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('customers','subscriptions','customer_monthly_metrics') ORDER BY name"
        )]
    finally:
        db.set_authorizer(authorize)


def execute_query(db, sql, parameters, row_cap=500, seconds=0.5, operations=200_000):
    if not isinstance(sql, str) or len(sql) > 20_000:
        raise ValueError("SQL exceeds the query size limit")
    if not isinstance(parameters, dict) or any(
        not isinstance(key, str) or not isinstance(value, (str, int, float, type(None)))
        for key, value in parameters.items()
    ):
        raise ValueError("Use named scalar parameters")
    deadline = time.monotonic() + seconds
    remaining = operations

    def progress():
        nonlocal remaining
        remaining -= 100
        return remaining <= 0 or time.monotonic() >= deadline

    db.set_progress_handler(progress, 100)
    try:
        cursor = db.execute(sql, parameters)
        if cursor.description is None:
            raise ValueError("Only read queries are supported")
        columns = [column[0] for column in cursor.description]
        if len(columns) != len(set(columns)):
            raise ValueError("Use unique aliases for result columns")
        rows = [dict(row) for row in cursor.fetchmany(row_cap + 1)]
        if any(isinstance(value, bytes) for row in rows for value in row.values()):
            raise ValueError("Binary results are not supported")
        if any(isinstance(value, float) and not math.isfinite(value) for row in rows for value in row.values()):
            raise ValueError("Non-finite numeric results are not supported")
        return {"columns": columns, "rows": rows[:row_cap], "truncated": len(rows) > row_cap,
                "sql": sql, "parameters": parameters}
    finally:
        db.set_progress_handler(None, 0)
