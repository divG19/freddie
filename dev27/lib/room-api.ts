"use client";

import { useEffect, useRef, useState } from "react";

export type Cell = string | number | boolean | null;
export type Message = {
  id: string;
  author: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  resultId: string | null;
};
export type Result = {
  id: string;
  kind: "churned" | "metrics" | "comparison" | "query";
  title: string;
  columns: { key: string; label: string }[];
  rows: Record<string, Cell>[];
  downloadUrl: string;
  presentation: "text" | "table" | "bar" | "line";
  chartMetric: string | null;
  summary: string;
  truncated?: boolean;
};
export type HistoryEntry = {
  id: string;
  author: string;
  question: string;
  clarifications: { author: string; text: string }[];
  createdAt: string;
  status: "awaiting_period" | "awaiting_clarification" | "completed" | "unsupported" | "failed";
  filters: Record<string, Cell>;
  queryId: string | null;
  sql: string | null;
  parameters: Record<string, Cell>;
  rowCount: number | null;
  resultId: string | null;
  executions?: { sql: string; parameters: Record<string, Cell>; status: string }[];
};
export type RoomState = {
  roomId: "demo";
  revision: number;
  busy: boolean;
  period: string | null;
  customerIds: string[];
  messages: Message[];
  results: Result[];
  history: HistoryEntry[];
};
export type SendRequest = { clientMessageId: string; author: string; text: string };
export type Participant = { name: string; team: string; author: string };

export async function getParticipants(signal?: AbortSignal): Promise<Participant[]> {
  const response = await fetch("/api/rooms/demo/participants", {
    cache: "no-store",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
      : AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Unable to load saved participants. Reconnecting...");
  return response.json();
}

export async function saveParticipant(name: string, team: string): Promise<Participant> {
  const response = await fetch("/api/rooms/demo/participants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, team }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 422
        ? "Use a name and team of 1-32 characters each."
        : "Your participant could not be saved. Your name and team are preserved; please retry.",
    );
  return response.json();
}

export class RoomApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getRoom(signal?: AbortSignal): Promise<RoomState> {
  const response = await fetch("/api/rooms/demo", {
    cache: "no-store",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
      : AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new RoomApiError(response.status, "Cannot connect to the shared room.");
  return response.json();
}

export async function postMessage(request: SendRequest): Promise<RoomState> {
  const response = await fetch("/api/rooms/demo/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    cache: "no-store",
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) {
    throw new RoomApiError(
      response.status,
      response.status === 409
        ? "Q-Agent is answering another message. Try again when it finishes."
        : response.status === 400 || response.status === 422
          ? "Use a display name of 1-80 characters and a message of 1-4,000 characters. Check your name and message."
          : "Your message could not be confirmed. Your draft is safe; retry to check or send it.",
    );
  }
  return response.json();
}

export function useRoom(joined: boolean) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [connection, setConnection] = useState<"connecting" | "live" | "reconnecting">(
    "connecting",
  );
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [failedRequest, setFailedRequest] = useState<SendRequest | null>(null);
  const pending = useRef<SendRequest | null>(null);
  const inFlight = useRef(false);

  function accept(next: RoomState) {
    setRoom((current) => (!current || next.revision >= current.revision ? next : current));
  }

  useEffect(() => {
    if (!joined) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const next = await getRoom(controller.signal);
        if (!cancelled) {
          accept(next);
          setConnection("live");
        }
      } catch {
        if (!cancelled) setConnection("reconnecting");
      } finally {
        if (!cancelled) timer = setTimeout(poll, 1000);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [joined]);

  async function send(author: string, text: string, retry?: SendRequest): Promise<boolean> {
    if (inFlight.current || !text.trim()) return false;
    const previous = pending.current;
    const request =
      retry ??
      (previous?.author === author && previous.text === text
        ? previous
        : { clientMessageId: crypto.randomUUID(), author, text });
    pending.current = request;
    inFlight.current = true;
    setSending(true);
    setSendError(null);
    try {
      accept(await postMessage(request));
      pending.current = null;
      setFailedRequest(null);
      setConnection("live");
      return true;
    } catch (error) {
      setFailedRequest(request);
      setSendError(
        error instanceof Error ? error.message : "Connection failed. Your draft is safe.",
      );
      if (!(error instanceof RoomApiError)) setConnection("reconnecting");
      return false;
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return { room, connection, sending, sendError, failedRequest, send };
}
