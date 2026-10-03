"""Deterministic synthetic data; the serving connection is read-only."""
import sqlite3
from pathlib import Path

from backend.sql_tools import authorize


def seed_database(path: Path):
    with sqlite3.connect(path) as db:
        db.executescript("""
            DROP TABLE IF EXISTS customer_monthly_metrics;
            DROP TABLE IF EXISTS subscriptions;
            DROP TABLE IF EXISTS customers;
            CREATE TABLE customers (customer_id TEXT PRIMARY KEY, company_name TEXT NOT NULL,
                segment TEXT NOT NULL, industry TEXT NOT NULL);
            CREATE TABLE subscriptions (customer_id TEXT PRIMARY KEY REFERENCES customers,
                started_on TEXT NOT NULL, cancelled_on TEXT, monthly_revenue_usd INTEGER NOT NULL);
            CREATE TABLE customer_monthly_metrics (customer_id TEXT REFERENCES customers,
                month TEXT NOT NULL, weekly_active_users REAL NOT NULL, resolution_hours REAL NOT NULL,
                PRIMARY KEY (customer_id, month));
        """)
        names = ["Willow Fashion", "Maple Home", "Lumen Retail", "Cedar Outfitters",
                 "Birch Market", "Aspen Goods", "Oak Retail", "Atlas Electronics",
                 "Nova Stores", "Summit Commerce", "Horizon Retail", "Beacon Home",
                 "Pioneer Goods", "Vertex Fashion", "Meridian Stores", "Harbor Market",
                 "Orion Commerce", "Sterling Retail", "Evergreen Home", "Cobalt Goods"]
        cancellations = {1: "2026-04-30", 2: "2026-05-15", 3: "2026-06-15", 8: "2026-06-30"}
        for i, name in enumerate(names, 1):
            cid = f"C{i:03}"
            industry = {1: "Fashion", 2: "Home goods", 3: "Electronics", 8: "Electronics"}.get(i, "Retail")
            db.execute("INSERT INTO customers VALUES (?,?,?,?)", (cid, name, "SMB" if i <= 7 else "Enterprise", industry))
            db.execute("INSERT INTO subscriptions VALUES (?,?,?,?)", (cid, "2025-01-01", cancellations.get(i), 1000 if i <= 7 else 5000))
            for month in range(1, 7):
                users = [20, 12, 6][month - 1] if i == 1 and month <= 3 else max(3, 30 + i * 3 - month * (3 if i in cancellations else 1))
                hours = [2, 5, 9][month - 1] if i == 1 and month <= 3 else round(1 + i / 10 + month * (0.7 if i in cancellations else 0.1), 1)
                db.execute("INSERT INTO customer_monthly_metrics VALUES (?,?,?,?)", (cid, f"2026-{month:02}-01", users, hours))


def open_readonly(path: Path):
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA query_only=ON")
    db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 100_000)
    db.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 20_000)
    db.setlimit(sqlite3.SQLITE_LIMIT_COLUMN, 100)
    db.set_authorizer(authorize)
    return db
