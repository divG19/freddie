"""Deterministic legacy summaries; natural-language analytics use sql_tools."""
START, END = "2026-04-01", "2026-07-01"

CHURN_SQL = """SELECT c.customer_id, c.company_name, c.segment, c.industry,
    s.cancelled_on, s.monthly_revenue_usd
    FROM customers c JOIN subscriptions s USING (customer_id)
    WHERE s.started_on < :start AND s.cancelled_on >= :start AND s.cancelled_on < :end
    ORDER BY c.customer_id"""

COMPARISON_SQL = """SELECT c.segment, COUNT(*) AS total_count,
    SUM(CASE WHEN s.cancelled_on >= :start AND s.cancelled_on < :end THEN 1 ELSE 0 END) AS churned_count,
    COUNT(*) - SUM(CASE WHEN s.cancelled_on >= :start AND s.cancelled_on < :end THEN 1 ELSE 0 END) AS retained_count,
    ROUND(100.0 * SUM(CASE WHEN s.cancelled_on >= :start AND s.cancelled_on < :end THEN 1 ELSE 0 END) / COUNT(*), 1) AS churn_rate_pct
    FROM customers c JOIN subscriptions s USING (customer_id)
    WHERE s.started_on < :start AND (s.cancelled_on IS NULL OR s.cancelled_on >= :start)
    GROUP BY c.segment ORDER BY c.segment"""


def list_churned(db, start=START, end=END):
    params = {"start": start, "end": end}
    return [dict(r) for r in db.execute(CHURN_SQL, params)], CHURN_SQL, params


def show_metrics(db, customer_ids):
    params = {"start": "2026-01-01", "end": "2026-04-01"}
    for i, cid in enumerate(customer_ids):
        params[f"customer_{i}"] = cid
    placeholders = ", ".join(f":customer_{i}" for i in range(len(customer_ids))) or "NULL"
    sql = f"""SELECT c.customer_id, c.company_name, m.month, m.weekly_active_users, m.resolution_hours
        FROM customers c JOIN customer_monthly_metrics m USING (customer_id)
        WHERE c.customer_id IN ({placeholders}) AND m.month >= :start AND m.month < :end
        ORDER BY c.customer_id, m.month"""
    return [dict(r) for r in db.execute(sql, params)], sql, params


def compare_segments(db, start=START, end=END):
    params = {"start": start, "end": end}
    return [dict(r) for r in db.execute(COMPARISON_SQL, params)], COMPARISON_SQL, params
