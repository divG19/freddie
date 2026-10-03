"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { ArrowUp, ArrowUpRight, History, Users, Sparkles } from "lucide-react";
import {
  getParticipants,
  saveParticipant,
  useRoom,
  type Message,
  type Participant,
  type RoomState,
} from "@/lib/room-api";
import { ResultsPanel } from "./results-panel";
import { HistoryPanel } from "./history-panel";
import "./churn-room.css";

const MessageContext = createContext<{ messages: Message[]; onSelect: (id: string) => void }>({
  messages: [],
  onSelect: () => {},
});
const convertMessage = (message: Message): ThreadMessageLike => ({
  id: message.id,
  role: message.role,
  content: [{ type: "text", text: message.text }],
  createdAt: new Date(message.createdAt),
});
const prompts = [
  "Which customers churned?",
  "How were those customers doing before they churned?",
  "Compare them with customers who stayed.",
];

function NamedMessage() {
  const id = useAuiState((s) => s.message.id);
  const { messages, onSelect } = useContext(MessageContext);
  const message = messages.find((m) => m.id === id);
  if (!message) return null;
  return (
    <MessagePrimitive.Root className={`chat-message message-${message.role}`}>
      <div className="message-avatar">
        {message.role === "assistant" ? (
          <Sparkles size={15} />
        ) : (
          message.author.slice(0, 2).toUpperCase()
        )}
      </div>
      <div className="message-body">
        <div className="message-heading">
          <strong>{message.role === "assistant" ? "Q-Agent" : message.author}</strong>
          <time dateTime={message.createdAt}>
            {new Date(message.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
          {message.role === "assistant" && <span className="agent-tag">AGENT</span>}
        </div>
        <div className="message-text">
          <MessagePrimitive.Parts />
        </div>
        {message.resultId && (
          <button className="result-link" onClick={() => onSelect(message.resultId!)}>
            Open evidence <ArrowUpRight size={14} />
          </button>
        )}
      </div>
    </MessagePrimitive.Root>
  );
}

export function ChurnRoom() {
  const [name, setName] = useState("Priya");
  const [joined, setJoined] = useState(false);
  const [personName, setPersonName] = useState("");
  const [personTeam, setPersonTeam] = useState("");
  const [selectedName, setSelectedName] = useState("Priya");
  const [selectedTeam, setSelectedTeam] = useState("Finance");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantLoadError, setParticipantLoadError] = useState<string | null>(null);
  const [participantSaveError, setParticipantSaveError] = useState<string | null>(null);
  const [savingParticipant, setSavingParticipant] = useState(false);
  const [draft, setDraft] = useState("");
  const [selection, setSelection] = useState<{ id: string; latestId: string | undefined } | null>(
    null,
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const { room, connection, sending, sendError, failedRequest, send } = useRoom(joined);
  const nameOptions = Array.from(new Set(participants.map((participant) => participant.name)));
  const teamOptions = Array.from(
    new Set([...participants.map((participant) => participant.team), "Marketing"]),
  );
  const currentParticipant = participants.find((participant) => participant.author === name);
  const chosenName = (selectedName === "__new__" ? personName : selectedName).trim();
  const chosenTeam = (selectedTeam === "__new__" ? personTeam : selectedTeam).trim();
  const latestId = room?.results.at(-1)?.id;
  const displayedId = selection && selection.latestId === latestId ? selection.id : latestId;
  const displayed = room?.results.find((r) => r.id === displayedId);
  const retryingDraft =
    !!failedRequest && failedRequest.text === draft && failedRequest.author === name;

  useEffect(() => {
    const stored = localStorage.getItem("q-agent-display-name");
    if (stored?.trim() && stored.length <= 80) {
      setName(stored);
      setJoined(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const next = await getParticipants(controller.signal);
        if (!cancelled) {
          setParticipants((current) =>
            Array.from(
              new Map(
                [...current, ...next].map((participant) => [
                  JSON.stringify([participant.name, participant.team]),
                  participant,
                ]),
              ).values(),
            ),
          );
          setParticipantLoadError(null);
        }
      } catch {
        if (!cancelled)
          setParticipantLoadError("Unable to load saved participants. Reconnecting...");
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
  }, []);

  const runtime = useExternalStoreRuntime({
    messages: room?.messages ?? [],
    convertMessage,
    isRunning: sending || !!room?.busy,
    onNew: async (message) => {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      if (await send(name, text)) setDraft((current) => (current === text ? "" : current));
    },
  });

  async function join() {
    if (savingParticipant || !participants.length || !chosenName || !chosenTeam) return;
    setSavingParticipant(true);
    setParticipantSaveError(null);
    try {
      const participant = await saveParticipant(chosenName, chosenTeam);
      setParticipants((current) =>
        current.some((value) => value.name === participant.name && value.team === participant.team)
          ? current
          : [...current, participant],
      );
      setName(participant.author);
      localStorage.setItem("q-agent-display-name", participant.author);
      setJoined(true);
    } catch (error) {
      setParticipantSaveError(
        error instanceof Error ? error.message : "Unable to save participant. Please retry.",
      );
    } finally {
      setSavingParticipant(false);
    }
  }
  function select(id: string) {
    setSelection({ id, latestId });
  }

  return (
    <main className="churn-room">
      <header className="room-header">
        <a href="/" className="wordmark">
          <span className="brand-icon">Q</span>
          <span>
            Q-Agent<span className="wordmark-divider"> / </span>
            <span className="wordmark-room">Churn Room</span>
          </span>
        </a>
        <div className="header-tags">
          <span className="synthetic-tag">SYNTHETIC DATA</span>
          <span className={`connection-status ${connection}`}>
            <i />
            {!joined
              ? "Room: demo"
              : connection === "live"
                ? "Shared room live"
                : connection === "reconnecting"
                  ? "Reconnecting"
                  : "Connecting"}
          </span>
        </div>
      </header>
      <div className="room-intro">
        <div>
          <span className="eyebrow">ONE AGENT / EVERY TEAM</span>
          <h1>
            {joined
              ? "One question. A shared investigation."
              : "Your team. Your questions. One shared agent."}
          </h1>
          <p>
            {joined
              ? "Follow the same customers from lost revenue to product signals."
              : "Choose your name and team, then start a hands-on demo with Q-Agent."}
          </p>
        </div>
        {joined && (
          <button
            className={`history-toggle ${historyOpen ? "active" : ""}`}
            onClick={() => setHistoryOpen(!historyOpen)}
            aria-expanded={historyOpen}
          >
            <History size={17} /> History <span>{room?.history.length ?? 0}</span>
          </button>
        )}
      </div>
      {joined ? (
        <div className="join-bar">
          <Users size={17} />
          <span>Chatting as</span>
          <strong className="current-participant">
            {currentParticipant ? `${currentParticipant.name} / ${currentParticipant.team}` : name}
          </strong>
          <button
            type="button"
            className="text-button"
            disabled={sending}
            onClick={(event) => {
              event.preventDefault();
              const baseName = currentParticipant?.name ?? name.split(" / ")[0];
              const team = currentParticipant?.team ?? name.slice(name.indexOf(" / ") + 3);
              setSelectedName(nameOptions.includes(baseName) ? baseName : "__new__");
              setPersonName(baseName);
              setSelectedTeam(teamOptions.includes(team) ? team : "__new__");
              setPersonTeam(team);
              setJoined(false);
              localStorage.removeItem("q-agent-display-name");
            }}
          >
            Change participant
          </button>
          <span className="join-caption">One room. Every browser sees the same conversation.</span>
        </div>
      ) : (
        <section className="demo-onboarding" aria-label="Start your demo">
          <form
            className="onboarding-form"
            onSubmit={(event) => {
              event.preventDefault();
              join();
            }}
          >
            <span className="eyebrow">01 / INTRODUCE YOURSELF</span>
            <h2>Take a seat at the table.</h2>
            <p>
              Select an existing identity or add your own. No signup, scheduling, or real data
              needed.
            </p>
            <label>
              Your name
              <select
                aria-label="Your name"
                value={selectedName}
                disabled={savingParticipant}
                onChange={(event) => {
                  setSelectedName(event.target.value);
                  const participant = participants.find(
                    (value) => value.name === event.target.value,
                  );
                  if (participant) setSelectedTeam(participant.team);
                }}
              >
                {nameOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                <option value="__new__">+ Add a new name</option>
              </select>
            </label>
            {selectedName === "__new__" && (
              <label>
                New name
                <input
                  value={personName}
                  onChange={(event) => setPersonName(event.target.value)}
                  placeholder="e.g. Div"
                  maxLength={32}
                  disabled={savingParticipant}
                  required
                />
              </label>
            )}
            <label>
              Your team
              <select
                aria-label="Your team"
                value={selectedTeam}
                disabled={savingParticipant}
                onChange={(event) => setSelectedTeam(event.target.value)}
              >
                {teamOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                <option value="__new__">+ Add a new team</option>
              </select>
            </label>
            {selectedTeam === "__new__" && (
              <label>
                New team
                <input
                  value={personTeam}
                  onChange={(event) => setPersonTeam(event.target.value)}
                  placeholder="e.g. Customer Success"
                  maxLength={32}
                  disabled={savingParticipant}
                  required
                />
              </label>
            )}
            <button
              className="start-demo-button"
              type="submit"
              disabled={savingParticipant || !participants.length || !chosenName || !chosenTeam}
            >
              {savingParticipant ? "Saving participant..." : "Start demo"}{" "}
              <ArrowUpRight size={17} />
            </button>
            {!participants.length && !participantLoadError && (
              <p role="status">Loading saved participants...</p>
            )}
            {participantLoadError && (
              <p className="send-error" role="status">
                {participantLoadError}
              </p>
            )}
            {participantSaveError && (
              <p className="send-error" role="alert">
                {participantSaveError}
              </p>
            )}
            <span className="onboarding-note">
              Saves your name and team for everyone, then opens the chatbot. Your identity is a
              display label, not an authenticated account.
            </span>
          </form>
          <div className="onboarding-story">
            <span className="welcome-icon">
              <Sparkles size={26} strokeWidth={1.5} />
            </span>
            <span className="eyebrow">02 / ASK Q-AGENT</span>
            <h2>A conversation grounded in data.</h2>
            <p>
              Ask about the same 20 fictional customers with your teammates. The agent reads the
              actual SQLite schema and generates bounded, read-only analytics queries.
            </p>
            <ol>
              <li>
                <span>01</span>Find the customers who churned in Q2 2026.
              </li>
              <li>
                <span>02</span>Explore their January-March usage and support metrics.
              </li>
              <li>
                <span>03</span>Compare churned and retained customer segments.
              </li>
            </ol>
            <p>
              These are starting points, not the only actions. Ask for filters, aggregates, customer
              metrics, or date comparisons. Ambiguous requests need clarification; unavailable data
              receives an explanation rather than an invented answer.
            </p>
            <div className="empty-facts">
              <span>20 synthetic customers</span>
              <span>One shared room</span>
              <span>CSV + query history</span>
            </div>
          </div>
        </section>
      )}
      <div className="room-explainers">
        <details className="room-explainer">
          <summary>About demo data</summary>
          <p>
            All teams query the same synthetic dataset: 20 fictional online retailers, one
            subscription each, and 120 monthly usage and support records from January through June
            2026.
          </p>
          <p>
            Source: <code>backend/seed.py</code>, loaded into a temporary, read-only SQLite
            database. No uploaded customer records or real company data are used.
          </p>
          <p>
            Q2 cancellations: Willow Fashion, Maple Home, Lumen Retail, and Atlas Electronics. Their
            subscriptions total $8,000 per month. SMB churn is 3 of 7 (42.9%); Enterprise churn is 1
            of 13 (7.7%). Subscription rates are not actual cash revenue. Monthly metrics are
            synthetic and include observations after cancellation.
          </p>
          <p>
            Changing your name or team does not change the dataset or selected customers. Sending a
            new query changes the shared result; choosing an older result changes only your preview.
            Backend restart resets the conversation and regenerates the same sample data.
          </p>
        </details>
      </div>
      {joined && (
        <div className={`workspace ${historyOpen ? "with-history" : ""}`}>
          <section className="chat-panel" aria-label="Shared conversation">
            <div className="panel-heading">
              <span className="eyebrow">01 / CONVERSATION</span>
              <span className="room-label"># demo</span>
            </div>
            <AssistantRuntimeProvider runtime={runtime}>
              <MessageContext.Provider value={{ messages: room?.messages ?? [], onSelect: select }}>
                <ThreadPrimitive.Root className="chat-thread">
                  <ThreadPrimitive.Viewport className="chat-viewport">
                    {!room?.messages.length && <Welcome room={room} joined={joined} />}
                    <ThreadPrimitive.Messages
                      components={{ UserMessage: NamedMessage, AssistantMessage: NamedMessage }}
                    />
                    {(sending || room?.busy) && (
                      <div className="busy-indicator" role="status">
                        <span className="busy-dot" /> Q-Agent is investigating...
                      </div>
                    )}
                  </ThreadPrimitive.Viewport>
                  <div className="composer-area">
                    <div className="prompt-chips">
                      {prompts.map((prompt, i) => (
                        <button
                          key={prompt}
                          title={prompt}
                          onClick={() => setDraft(prompt)}
                          disabled={sending}
                        >
                          {
                            [
                              "Find churned customers",
                              "Explore pre-churn metrics",
                              "Compare segments",
                            ][i]
                          }
                        </button>
                      ))}
                    </div>
                    {sendError && (
                      <div className="send-error" role="alert">
                        <p>
                          {sendError} Press Retry with the unchanged draft to reuse its request ID.
                        </p>
                        {failedRequest && !retryingDraft && (
                          <>
                            <p className="failed-text">
                              Unconfirmed message from {failedRequest.author}: {failedRequest.text}
                            </p>
                            <button
                              className="text-button"
                              disabled={!joined || sending || !!room?.busy}
                              onClick={async () => {
                                if (
                                  await send(
                                    failedRequest.author,
                                    failedRequest.text,
                                    failedRequest,
                                  )
                                )
                                  setDraft((current) =>
                                    current === failedRequest.text ? "" : current,
                                  );
                              }}
                            >
                              Retry original message
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {joined && connection === "reconnecting" && (
                      <p className="connection-warning" role="status">
                        Reconnecting to the backend. Your last evidence and draft remain here.
                      </p>
                    )}
                    <form
                      className="composer"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (joined && draft.trim() && !sending && !room?.busy && room)
                          runtime.thread.append({
                            role: "user",
                            content: [{ type: "text", text: draft }],
                          });
                      }}
                    >
                      <textarea
                        aria-label="Message Q-Agent"
                        placeholder={
                          joined
                            ? "Ask a question about customer churn..."
                            : "Enter your name above to join the conversation"
                        }
                        value={draft}
                        disabled={!joined}
                        rows={3}
                        maxLength={4000}
                        onChange={(e) => setDraft(e.target.value)}
                      />
                      <button
                        className="send-button"
                        type="submit"
                        disabled={!joined || !draft.trim() || sending || !!room?.busy || !room}
                        aria-label={retryingDraft ? "Retry message" : "Send message"}
                      >
                        {retryingDraft ? "Retry" : <ArrowUp size={20} />}
                      </button>
                    </form>
                    <p className="composer-note">
                      Enter a question, then send. Your draft stays local until accepted.
                    </p>
                  </div>
                </ThreadPrimitive.Root>
              </MessageContext.Provider>
            </AssistantRuntimeProvider>
          </section>
          <ResultsPanel
            result={displayed}
            historyEntry={room?.history.find((entry) => entry.resultId === displayed?.id)}
            isLatest={displayedId === latestId}
            onLatest={() => setSelection(null)}
          />
          {historyOpen && (
            <HistoryPanel
              history={room?.history ?? []}
              results={room?.results ?? []}
              onSelect={select}
              onClose={() => setHistoryOpen(false)}
            />
          )}
        </div>
      )}
      <footer className="room-footer">
        <span>DEMO / Q2 2026</span>
        <p>Read-only queries. No causal claims. Room history resets when the backend restarts.</p>
        <span>Built together, investigated together.</span>
      </footer>
    </main>
  );
}

function Welcome({ room, joined }: { room: RoomState | null; joined: boolean }) {
  return (
    <div className="chat-welcome">
      <span className="welcome-icon">
        <Sparkles size={24} strokeWidth={1.5} />
      </span>
      <h2>Meet around the evidence.</h2>
      <p>
        Finance starts with who left. Product explores how they were doing. Sales compares who
        stayed.
      </p>
      <ol>
        <li>
          <span>01</span>Ask which customers churned.
        </li>
        <li>
          <span>02</span>Choose Q2 2026 when asked.
        </li>
        <li>
          <span>03</span>Follow up as a teammate.
        </li>
      </ol>
      <p className="welcome-caption">
        {!joined
          ? "Add your name to begin. Invite teammates to this same URL."
          : !room
            ? "Connecting to the shared room..."
            : "The room is ready. Start the investigation below."}
      </p>
    </div>
  );
}
