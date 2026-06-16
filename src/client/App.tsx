import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AgentClient } from "agents/client";

type Role = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
}

type PendingAction = "collect_order_number" | "clarify_faq" | "collect_email" | null;

type ServerMessage =
  | { type: "state"; messages: ChatMessage[]; pendingAction: PendingAction }
  | { type: "typing"; value: boolean }
  | { type: "message"; message: ChatMessage; pendingAction: PendingAction }
  | { type: "error"; message: string };

function getSessionId() {
  const key = "vwu-support-agent-session";
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const next = crypto.randomUUID();
  localStorage.setItem(key, next);
  return next;
}

export function App() {
  const sessionId = useMemo(getSessionId, []);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"connecting" | "ready" | "closed">("connecting");
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState("");
  const socketRef = useRef<AgentClient | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const socket = new AgentClient({
      host: window.location.host,
      protocol: window.location.protocol === "https:" ? "wss" : "ws",
      agent: "CustomerSupportAgent",
      name: sessionId,
    });
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      setStatus("ready");
      setError("");
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as ServerMessage;

      if (message.type === "state") {
        setMessages(message.messages);
        setPendingAction(message.pendingAction);
      }

      if (message.type === "message") {
        setMessages((current) => {
          if (current.some((item) => item.id === message.message.id)) return current;
          return [...current, message.message];
        });
        setPendingAction(message.pendingAction);
      }

      if (message.type === "typing") {
        setTyping(message.value);
      }

      if (message.type === "error") {
        setError(message.message);
      }
    });

    socket.addEventListener("close", () => setStatus("closed"));
    socket.addEventListener("error", () => setError("Connection failed. Refresh and try again."));

    return () => socket.close();
  }, [sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  function send(content: string) {
    const trimmed = content.trim();
    if (!trimmed || socketRef.current?.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: "chat", content: trimmed }));
    setInput("");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    send(input);
  }

  function resetChat() {
    localStorage.removeItem("vwu-support-agent-session");
    socketRef.current?.send(JSON.stringify({ type: "reset" }));
    window.location.reload();
  }

  return (
    <main className="shell">
      <section className="chat-panel" aria-label="Customer support chat">
        <header className="chat-header">
          <div>
            <p className="eyebrow">Vape Wholesale USA</p>
            <h1>Customer Support</h1>
          </div>
          <div className="header-actions">
            <span className={`status ${status}`}>{status}</span>
            <button className="ghost-button" onClick={resetChat} type="button">
              New Chat
            </button>
          </div>
        </header>

        <div className="messages">
          {messages.map((message) => (
            <article key={message.id} className={`message ${message.role}`}>
              <p>{message.content}</p>
            </article>
          ))}
          {typing && (
            <article className="message assistant">
              <p>Checking...</p>
            </article>
          )}
          <div ref={scrollRef} />
        </div>

        {error && <div className="error">{error}</div>}

        <form className="composer" onSubmit={handleSubmit}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={placeholderFor(pendingAction)}
            disabled={status !== "ready"}
          />
          <button disabled={status !== "ready" || !input.trim()} type="submit">
            Send
          </button>
        </form>
      </section>
    </main>
  );
}

function placeholderFor(pendingAction: PendingAction) {
  if (pendingAction === "collect_order_number") return "Enter your order number...";
  if (pendingAction === "clarify_faq") return "Add a little more detail...";
  if (pendingAction === "collect_email") return "Enter your email address...";
  return "Ask about an order, shipping, returns, or support...";
}
