"""Persistent display identities, kept separate from read-only analytics data."""
import sqlite3
from contextlib import closing


def initialize(path):
    with closing(sqlite3.connect(path)) as db:
        db.execute("""CREATE TABLE IF NOT EXISTS participants (
            name TEXT COLLATE NOCASE NOT NULL,
            team TEXT COLLATE NOCASE NOT NULL,
            author TEXT NOT NULL,
            PRIMARY KEY (name, team)
        )""")
        db.executemany("INSERT OR IGNORE INTO participants VALUES (?, ?, ?)", [
            ("Priya", "Finance", "Priya"),
            ("Alex", "Product", "Alex"),
            ("Sam", "Sales", "Sam"),
        ])
        db.commit()


def list_participants(path):
    with closing(sqlite3.connect(path)) as db:
        db.row_factory = sqlite3.Row
        return [dict(row) for row in db.execute("SELECT name, team, author FROM participants ORDER BY rowid")]


def save_participant(path, name, team):
    with closing(sqlite3.connect(path)) as db:
        db.row_factory = sqlite3.Row
        db.execute("INSERT OR IGNORE INTO participants VALUES (?, ?, ?)", (name, team, f"{name} / {team}"))
        db.commit()
        return dict(db.execute("SELECT name, team, author FROM participants WHERE name = ? AND team = ?", (name, team)).fetchone())
