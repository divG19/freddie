import type { Result, RoomState } from "./room-api";

export const emptyRoom: RoomState = {
  roomId: "demo",
  revision: 0,
  busy: false,
  period: null,
  customerIds: [],
  messages: [],
  results: [],
  history: [],
};
const timestamp = "2026-07-01T10:00:00Z";
const customers = [
  ["C001", "Willow Fashion", "SMB", "Fashion", "2026-04-30", 1000],
  ["C002", "Maple Home", "SMB", "Home goods", "2026-05-15", 1000],
  ["C003", "Lumen Retail", "SMB", "Electronics", "2026-06-15", 1000],
  ["C008", "Atlas Electronics", "Enterprise", "Electronics", "2026-06-30", 5000],
] as const;
function result(
  id: string,
  kind: Result["kind"],
  title: string,
  columns: Result["columns"],
  rows: Result["rows"],
): Result {
  return {
    id,
    kind,
    title,
    columns,
    rows,
    downloadUrl: `/api/rooms/demo/results/${id}.csv`,
    presentation: kind === "metrics" ? "line" : kind === "comparison" ? "bar" : "table",
    chartMetric:
      kind === "metrics" ? "weekly_active_users" : kind === "comparison" ? "churn_rate_pct" : null,
    summary: title,
  };
}
export const churnedFixture = result(
  "fixture-churned",
  "churned",
  "Customers who churned in Q2 2026",
  [
    { key: "customer_id", label: "Customer ID" },
    { key: "company_name", label: "Company" },
    { key: "segment", label: "Segment" },
    { key: "industry", label: "Industry" },
    { key: "cancelled_on", label: "Cancelled on" },
    { key: "monthly_revenue_usd", label: "Monthly subscription rate (USD)" },
  ],
  customers.map(
    ([customer_id, company_name, segment, industry, cancelled_on, monthly_revenue_usd]) => ({
      customer_id,
      company_name,
      segment,
      industry,
      cancelled_on,
      monthly_revenue_usd,
    }),
  ),
);
export const metricsFixture = result(
  "fixture-metrics",
  "metrics",
  "January–March customer metrics",
  [
    { key: "customer_id", label: "Customer ID" },
    { key: "company_name", label: "Company" },
    { key: "month", label: "Month" },
    { key: "weekly_active_users", label: "Weekly active users" },
    { key: "resolution_hours", label: "Resolution time (hours)" },
  ],
  customers.flatMap(([customer_id, company_name], index) =>
    ["2026-01", "2026-02", "2026-03"].map((month, i) => ({
      customer_id,
      company_name,
      month,
      weekly_active_users: index === 0 ? [20, 12, 6][i] : [30, 23, 15][i],
      resolution_hours: index === 0 ? [2, 5, 9][i] : [3, 6, 8][i],
    })),
  ),
);
export const comparisonFixture = result(
  "fixture-comparison",
  "comparison",
  "Q2 churn by customer segment",
  [
    { key: "segment", label: "Segment" },
    { key: "total_count", label: "Entering Q2" },
    { key: "churned_count", label: "Churned" },
    { key: "retained_count", label: "Retained" },
    { key: "churn_rate_pct", label: "Churn rate (%)" },
  ],
  [
    { segment: "SMB", total_count: 7, churned_count: 3, retained_count: 4, churn_rate_pct: 42.9 },
    {
      segment: "Enterprise",
      total_count: 13,
      churned_count: 1,
      retained_count: 12,
      churn_rate_pct: 7.7,
    },
  ],
);
export const clarificationRoom: RoomState = {
  ...emptyRoom,
  revision: 1,
  messages: [
    {
      id: "fixture-q",
      author: "Priya",
      role: "user",
      text: "Which customers churned?",
      createdAt: timestamp,
      resultId: null,
    },
    {
      id: "fixture-clarify",
      author: "Q-Agent",
      role: "assistant",
      text: "Which reporting period should I use? The synthetic cancellations are in April-June 2026.",
      createdAt: timestamp,
      resultId: null,
    },
  ],
  history: [
    {
      id: "fixture-history",
      author: "Priya",
      question: "Which customers churned?",
      clarifications: [],
      createdAt: timestamp,
      status: "awaiting_period",
      filters: {},
      queryId: null,
      sql: null,
      parameters: {},
      rowCount: null,
      resultId: null,
    },
  ],
};
export const completedRoom: RoomState = {
  ...clarificationRoom,
  revision: 4,
  period: "Q2 2026",
  customerIds: customers.map((c) => c[0]),
  results: [churnedFixture, metricsFixture, comparisonFixture],
  messages: [
    ...clarificationRoom.messages,
    {
      id: "fixture-a",
      author: "Q-Agent",
      role: "assistant",
      text: "Four customers churned, representing $8,000 in lost monthly subscription revenue.",
      createdAt: timestamp,
      resultId: churnedFixture.id,
    },
  ],
};
