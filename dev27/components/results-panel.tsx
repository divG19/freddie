"use client";

import { useState } from "react";
import { Download, ArrowUpRight, BarChart3 } from "lucide-react";
import type { Cell, HistoryEntry, Result } from "@/lib/room-api";

export function displayCell(key: string, value: Cell | undefined): string {
  if (value == null) return "\u2014";
  if (key === "monthly_revenue_usd" && typeof value === "number") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  }
  if (key === "churn_rate_pct" && typeof value === "number") return `${value}%`;
  return String(value);
}

export function ResultsPanel({
  result,
  historyEntry,
  isLatest,
  onLatest,
}: {
  result: Result | undefined;
  historyEntry?: HistoryEntry;
  isLatest: boolean;
  onLatest: () => void;
}) {
  return (
    <section className="evidence-panel" aria-label="Investigation results">
      <div className="panel-heading">
        <span className="eyebrow">02 / EVIDENCE</span>
        <button className="text-button" onClick={onLatest} disabled={isLatest}>
          Latest result <ArrowUpRight size={14} />
        </button>
      </div>
      {!result ? (
        <div className="result-empty">
          <BarChart3 size={34} strokeWidth={1.3} />
          <h2>The evidence lands here.</h2>
          <p>
            Ask Q-Agent a question. Tables, trends, and the data behind each answer stay available
            to everyone.
          </p>
          <div className="empty-facts">
            <span>20 synthetic customers</span>
            <span>Jan–Jun 2026</span>
            <span>Read-only SQL analytics</span>
          </div>
        </div>
      ) : (
        <>
          <div className="result-heading">
            <div>
              <span className="result-kind">
                {result.kind === "metrics"
                  ? "PRE-CHURN OBSERVATION"
                  : result.kind === "comparison"
                    ? "SEGMENT COMPARISON"
                    : result.kind === "query"
                      ? "SQL ANALYTICS"
                      : "CUSTOMER COHORT"}
              </span>
              <h2>{result.title}</h2>
            </div>
            <a className="download-button" href={result.downloadUrl} download>
              <Download size={15} /> CSV
            </a>
          </div>
          <div className="result-meta">
            <span>{result.rows.length} stored rows</span>
            <span>{isLatest ? "Latest result" : "Viewing an earlier result"}</span>
            <span>Agent selected: {result.presentation}</span>
            {result.truncated && <span>Truncated to 500 rows</span>}
          </div>
          {result.presentation === "text" && (
            <div className="chart-card result-summary">
              <p>{result.summary}</p>
            </div>
          )}
          {(result.presentation === "line" || result.presentation === "bar") &&
            (result.kind === "metrics" ? (
              <MetricChart key={`chart-${result.id}`} result={result} />
            ) : result.presentation === "line" ? (
              <QueryLineChart result={result} />
            ) : (
              <BarChart result={result} />
            ))}
          <details
            className="source-table"
            key={`table-${result.id}`}
            open={result.presentation === "table"}
          >
            <summary>
              {result.presentation === "table" ? "Result table" : "Inspect source table"} (
              {result.rows.length} rows)
            </summary>
            <div
              className="table-scroll"
              tabIndex={0}
              aria-label="Result table, scroll horizontally for all columns"
            >
              <table>
                <thead>
                  <tr>
                    {result.columns.map((column) => (
                      <th key={column.key}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, index) => (
                    <tr key={`${row.customer_id ?? row.segment ?? "row"}-${row.month ?? index}`}>
                      {result.columns.map((column) => (
                        <td key={column.key}>{displayCell(column.key, row[column.key])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {historyEntry?.sql && (
            <section className="result-query" aria-label="Executed SQL">
              <h3>Executed SQL</h3>
              <p>
                {historyEntry.queryId ?? "Read-only query"} /{" "}
                {historyEntry.rowCount ?? result.rows.length} rows
              </p>
              <pre>
                <code>{historyEntry.sql}</code>
              </pre>
              <h4>Bound parameters</h4>
              <pre>
                <code>{JSON.stringify(historyEntry.parameters, null, 2)}</code>
              </pre>
              {!!historyEntry.executions?.length && (
                <details>
                  <summary>SQL execution log ({historyEntry.executions.length})</summary>
                  {historyEntry.executions.map((execution, index) => (
                    <div key={index}>
                      <h4>
                        Attempt {index + 1}: {execution.status}
                      </h4>
                      <pre>
                        <code>{execution.sql}</code>
                      </pre>
                      <pre>
                        <code>{JSON.stringify(execution.parameters, null, 2)}</code>
                      </pre>
                    </div>
                  ))}
                </details>
              )}
            </section>
          )}
          <p className="result-note">
            Synthetic data. Subscription rates are not cash revenue. Observed patterns do not
            establish why a customer cancelled.
          </p>
        </>
      )}
    </section>
  );
}

function MetricChart({ result }: { result: Result }) {
  const customers = Array.from(
    new Map(
      result.rows.map((row) => [String(row.customer_id), String(row.company_name)]),
    ).entries(),
  );
  const [customer, setCustomer] = useState(
    customers.find(([id]) => id === "C001")?.[0] ?? customers[0]?.[0] ?? "",
  );
  const [metric, setMetric] = useState(result.chartMetric ?? "weekly_active_users");
  const rows = result.rows
    .filter((row) => row.customer_id === customer)
    .toSorted((a, b) => String(a.month).localeCompare(String(b.month)));
  const numeric = rows.map((row) =>
    typeof row[metric] === "number" && Number.isFinite(row[metric])
      ? (row[metric] as number)
      : null,
  );
  const maximum = Math.max(1, ...numeric.filter((value): value is number => value !== null));
  const point = (i: number, value: number) => ({
    x: 44 + i * (432 / Math.max(1, rows.length - 1)),
    y: 134 - (value / maximum) * 98,
  });
  const units = metric === "weekly_active_users" ? "users (monthly average)" : "hours";
  return (
    <div className="chart-card">
      <div className="chart-controls">
        <label>
          Customer
          <select value={customer} onChange={(e) => setCustomer(e.target.value)}>
            {customers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Metric
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            <option value="weekly_active_users">Weekly active users</option>
            <option value="resolution_hours">Resolution time</option>
          </select>
        </label>
      </div>
      <span className="chart-unit">{units}</span>
      <svg
        viewBox="0 0 520 180"
        role="img"
        aria-label={`${customers.find(([id]) => id === customer)?.[1]}: ${metric.replaceAll("_", " ")} in ${units}. ${rows.map((row, i) => `${row.month}: ${numeric[i] ?? "missing"}`).join(", ")}`}
      >
        {[0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1="44"
              x2="476"
              y1={134 - fraction * 98}
              y2={134 - fraction * 98}
              stroke="#dce4dd"
            />
            <text x="30" y={138 - fraction * 98} textAnchor="end" fill="#66776b" fontSize="10">
              {Math.round(maximum * fraction * 10) / 10}
            </text>
          </g>
        ))}
        {numeric.map((value, i) => {
          const previous = numeric[i - 1];
          if (result.presentation === "bar" || value === null || previous == null) return null;
          const p = point(i, value);
          const before = point(i - 1, previous);
          return (
            <line
              key={`line-${i}`}
              x1={before.x}
              y1={before.y}
              x2={p.x}
              y2={p.y}
              stroke="#23644c"
              strokeWidth="2.5"
            />
          );
        })}
        {rows.map((row, i) => {
          const value = numeric[i];
          const p = value === null ? null : point(i, value);
          return (
            <g key={String(row.month)}>
              {p && (
                <>
                  {result.presentation === "bar" ? (
                    <rect
                      x={p.x - 18}
                      y={p.y}
                      width="36"
                      height={134 - p.y}
                      fill="#23644c"
                      rx="3"
                    />
                  ) : (
                    <circle cx={p.x} cy={p.y} r="4" fill="#23644c" />
                  )}
                  <text x={p.x} y={p.y - 12} textAnchor="middle" fontSize="12" fill="#1a3a2b">
                    {value}
                  </text>
                </>
              )}
              <text
                x={44 + i * (432 / Math.max(1, rows.length - 1))}
                y="160"
                textAnchor="middle"
                fontSize="11"
                fill="#66776b"
              >
                {String(row.month)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function QueryLineChart({ result }: { result: Result }) {
  const metric = result.chartMetric ?? "";
  const category = result.columns.find((column) => column.key !== metric);
  const rows = result.rows.slice(0, 100);
  const maximum = Math.max(1, ...rows.map((row) => Number(row[metric]) || 0));
  const points = rows.map((row, index) => ({
    x: 44 + index * (432 / Math.max(1, rows.length - 1)),
    y: 134 - (Number(row[metric]) / maximum) * 98,
    label: String(category ? row[category.key] : index),
  }));
  return (
    <div className="chart-card">
      <strong>{result.columns.find((column) => column.key === metric)?.label ?? metric}</strong>
      <svg
        viewBox="0 0 520 180"
        role="img"
        aria-label={`${result.title}: ${rows.map((row, index) => `${points[index].label}: ${row[metric]}`).join(", ")}`}
      >
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke="#23644c"
          strokeWidth="2.5"
        />
        {points.map((point, index) => (
          <g key={index}>
            <circle cx={point.x} cy={point.y} r="4" fill="#23644c" />
            <title>{`${point.label}: ${String(rows[index][metric])}`}</title>
            {points.length <= 12 && (
              <text x={point.x} y="160" textAnchor="middle" fontSize="10">
                {point.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <span className="chart-unit">
        Scale: 0 to {maximum}.{" "}
        {result.rows.length > 100
          ? "First 100 rows plotted; inspect the table for all stored rows."
          : "Points follow query order."}
      </span>
    </div>
  );
}

function BarChart({ result }: { result: Result }) {
  const metric =
    result.chartMetric ?? (result.kind === "comparison" ? "churn_rate_pct" : "monthly_revenue_usd");
  const label = result.columns.find((column) => column.key === metric)?.label ?? metric;
  const maximum =
    metric === "churn_rate_pct"
      ? 100
      : Math.max(
          1,
          ...result.rows.map((row) =>
            typeof row[metric] === "number" ? (row[metric] as number) : 0,
          ),
        );
  return (
    <div className="chart-card" role="figure" aria-label={`${result.title}: ${label}`}>
      <strong className="bar-chart-title">{label}</strong>
      {result.rows.map((row, index) => {
        const value = typeof row[metric] === "number" ? (row[metric] as number) : 0;
        const category = result.columns.find((column) => column.key !== metric);
        const name = String(
          row.company_name ?? row.segment ?? (category ? row[category.key] : index),
        );
        return (
          <div className="bar-chart-row" key={`${name}-${index}`}>
            <div className="bar-chart-label">
              <span>{name}</span>
              <strong>{displayCell(metric, value)}</strong>
            </div>
            <div className="bar-chart-track">
              <div style={{ width: `${Math.max(0, Math.min(100, (value / maximum) * 100))}%` }} />
            </div>
          </div>
        );
      })}
      <span className="chart-unit">Scale: 0 to {displayCell(metric, maximum)}</span>
    </div>
  );
}
