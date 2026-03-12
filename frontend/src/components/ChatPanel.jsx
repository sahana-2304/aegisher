import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../services/api";

function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function createSessionId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // ignore and fallback below
  }
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const QUICK_PROMPTS = [
  "I need help right now.",
  "Show nearest police station.",
  "What helpline numbers can I call?",
  "I feel unsafe on my route.",
];

export default function ChatPanel({ onClose, user }) {
  const sessionId = useMemo(() => createSessionId(), []);
  const bottomRef = useRef(null);

  const [messages, setMessages] = useState([
    {
      role: "bot",
      text: "Hi, I am your AegisHer support assistant. Tell me what is happening, and I will help step by step.",
      time: now(),
      operator: false,
    },
  ]);
  const [input, setInput] = useState("");
  const [isHuman, setIsHuman] = useState(false);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  async function send(customText) {
    if (isSending) return;

    const text = String(customText ?? input ?? "").trim();
    if (!text) return;

    const userMsg = { role: "user", text, time: now() };
    const historyForApi = messages
      .filter((msg) => msg.role === "user" || msg.role === "bot")
      .slice(-8)
      .map((msg) => ({
        role: msg.role === "bot" ? "assistant" : "user",
        text: msg.text,
      }));

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsSending(true);

    try {
      const response = await api.chatMessage({
        message: text,
        sessionId,
        userId: user?.uid || user?.user_id || user?.id || null,
        history: historyForApi,
      });

      const escalated = Boolean(response?.escalated || response?.suggest_call);
      if (escalated) setIsHuman(true);

      setMessages((prev) => [
        ...prev,
        {
          role: "bot",
          text:
            response?.reply ||
            "I am here with you. If this is urgent, call 112 now.",
          time: now(),
          operator: escalated,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "bot",
          text:
            "Support server is temporarily unavailable. If this is urgent, call 112 now. You can also call Women Helpline 1091.",
          time: now(),
          operator: true,
        },
      ]);
      setIsHuman(true);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div className="chat-header-info">
          <div className="chat-avatar">{isHuman ? "OP" : "AI"}</div>
          <div className="chat-header-text">
            <h4>{isHuman ? "Safety Operator Mode" : "AegisHer Assistant"}</h4>
            <p>{isHuman ? "Emergency Support Active" : "AI Support Online"}</p>
          </div>
        </div>
        <button type="button" className="chat-close" onClick={onClose}>
          x
        </button>
      </div>

      <div className="chat-messages">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => send(prompt)}
              disabled={isSending}
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: 999,
                padding: "5px 10px",
                color: "var(--text-secondary)",
                fontSize: "0.68rem",
                cursor: isSending ? "not-allowed" : "pointer",
              }}
            >
              {prompt}
            </button>
          ))}
        </div>

        {messages.map((msg, index) => (
          <div key={`${msg.time}-${index}`} className={`message ${msg.role}`}>
            <div className="message-bubble">
              {msg.operator && (
                <span
                  style={{
                    display: "block",
                    fontSize: "0.7rem",
                    color: "var(--accent-teal)",
                    marginBottom: 4,
                  }}
                >
                  Human support priority
                </span>
              )}
              {msg.text}
            </div>
            <span className="message-time">{msg.time}</span>
          </div>
        ))}

        {isSending && (
          <div className="message bot">
            <div className="message-bubble">Typing...</div>
            <span className="message-time">{now()}</span>
          </div>
        )}

        {isHuman && (
          <div style={{ display: "flex", gap: 8, margin: "4px 0" }}>
            <button
              type="button"
              onClick={() => {
                window.location.href = "tel:1091";
              }}
              style={{
                background: "rgba(179,0,179,0.14)",
                border: "1px solid var(--border-accent)",
                borderRadius: 8,
                padding: "8px 14px",
                cursor: "pointer",
                color: "var(--accent-teal)",
                fontSize: "0.78rem",
                fontFamily: "var(--font-body)",
              }}
            >
              Call 1091
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = "tel:112";
              }}
              style={{
                background: "rgba(217,0,217,0.12)",
                border: "1px solid rgba(217,0,217,0.35)",
                borderRadius: 8,
                padding: "8px 14px",
                cursor: "pointer",
                color: "var(--accent-coral)",
                fontSize: "0.78rem",
                fontFamily: "var(--font-body)",
              }}
            >
              Call 112
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <input
          className="chat-input"
          placeholder="Type your message..."
          value={input}
          disabled={isSending}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              send();
            }
          }}
        />
        <button type="button" className="chat-send" onClick={() => send()} disabled={isSending}>
          {isSending ? "..." : ">"}
        </button>
      </div>
    </div>
  );
}
