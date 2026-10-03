"use client";

import { Download, ArrowUpRight, X } from "lucide-react";
import type { HistoryEntry, Result } from "@/lib/room-api";

export function HistoryPanel({
  history,
  results,
  onSelect,
  onClose,
}: {
  history: HistoryEntry[];
  results: Result[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <section className="history-panel" aria-label="Query history">
      <div className="history-heading">
        <div>
          <span className="eyebrow">AUDIT TRAIL</span>
          <h2>Every answer, traceable.</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close history">
          <X size={20} />
        </button>
      </div>
      {!history.length && (
        <p className="muted">
          No requests yet. Questions and their query details will appear here.
        </p>
      )}
      {[...history].reverse().map((entry) => {
        const result = results.find((r) => r.id === entry.resultId);
        return (
          <article className="history-entry" key={entry.id}>
            <div className="history-entry-meta">
              <strong>{entry.author}</strong>
              <span className={`history-status status-${entry.status}`}>
                {entry.status.replaceAll("_", " ")}
              </span>
            </div>
            <h3>{entry.question}</h3>
            <time dateTime={entry.createdAt}>
              {entry.createdAt.replace("T", " ").replace("Z", " UTC")}
            </time>
            {entry.clarifications.map((clarification, index) => (
              <p className="clarification" key={index}>
                <strong>{clarification.author} clarified:</strong> {clarification.text}
              </p>
            ))}
            <div className="history-facts">
              <span>
                Rows: <strong>{entry.rowCount ?? "Not queried"}</strong>
              </span>
              <span>
                Query: <strong>{entry.queryId ?? "None"}</strong>
              </span>
            </div>
            <details>
              <summary>Filters, SQL & parameters</summary>
              <h4>Filters</h4>
              <pre>{JSON.stringify(entry.filters, null, 2)}</pre>
              <h4>SQL</h4>
              <pre>{entry.sql ?? "No query executed."}</pre>
              <h4>Parameters</h4>
              <pre>{JSON.stringify(entry.parameters, null, 2)}</pre>
              {!!entry.executions?.length && (
                <>
                  <h4>Tool executions</h4>
                  <pre>{JSON.stringify(entry.executions, null, 2)}</pre>
                </>
              )}
            </details>
            {result && (
              <div className="history-actions">
                <button className="text-button" onClick={() => onSelect(result.id)}>
                  View stored result <ArrowUpRight size={14} />
                </button>
                <a className="text-button" href={result.downloadUrl} download>
                  <Download size={14} /> Download CSV
                </a>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
