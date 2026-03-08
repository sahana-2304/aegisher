import { useState, useRef, useEffect } from "react";

const BOT_RESPONSES = [
  "I'm here to help. Are you safe right now? If you're in immediate danger, please press the SOS button or call 112.",
  "I understand. Can you tell me more about your current situation? I'm listening.",
  "Your safety is the priority. Would you like me to connect you with a human helpline operator or help you find the nearest police station?",
  "I'm escalating this to a human operator now. Please stay on the line. Do you need me to initiate a call to the helpline?",
  "Help is on the way. You can also directly call 1091 (Women Helpline) or 112 for immediate assistance.",
];

export default function ChatPanel({ onClose }) {
  const [messages, setMessages] = useState([
    { role: "bot", text: "Hi, I'm your AegisHer safety assistant. How can I help you right now?", time: now() },
  ]);
  const [input, setInput] = useState("");
  const [botIdx, setBotIdx] = useState(0);
  const [isHuman, setIsHuman] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function now() { return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

  function send() {
    if (!input.trim()) return;
    const userMsg = { role: "user", text: input, time: now() };
    setMessages((m) => [...m, userMsg]);
    setInput("");

    const needsHuman = /help|danger|scared|unsafe|emergency|hurt|attack/i.test(input);
    setTimeout(() => {
      const botReply = needsHuman
        ? "I'm connecting you with a human helpline operator right away. You're not alone. Do you want to initiate a direct call with the helpline?"
        : BOT_RESPONSES[botIdx % BOT_RESPONSES.length];
      if (needsHuman) setIsHuman(true);
      setBotIdx((i) => i + 1);
      setMessages((m) => [...m, { role: "bot", text: botReply, time: now(), operator: needsHuman }]);
    }, 800);
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div className="chat-header-info">
          <div className="chat-avatar">{isHuman ? "👩" : "🛡️"}</div>
          <div className="chat-header-text">
            <h4>{isHuman ? "Safety Operator" : "AegisHer Assistant"}</h4>
            <p>{isHuman ? "Human Support • Online" : "AI Powered • Always Available"}</p>
          </div>
        </div>
        <button className="chat-close" onClick={onClose}>✕</button>
      </div>

      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="message-bubble">
              {msg.operator && <span style={{ display: "block", fontSize: "0.7rem", color: "var(--accent-teal)", marginBottom: 4 }}>👩 Human Operator</span>}
              {msg.text}
            </div>
            <span className="message-time">{msg.time}</span>
          </div>
        ))}
        {isHuman && (
          <div style={{ display: "flex", gap: 8, margin: "4px 0" }}>
            <button onClick={() => window.location.href = "tel:1091"} style={{
              background: "rgba(0,212,180,0.1)", border: "1px solid var(--border-accent)",
              borderRadius: 8, padding: "8px 14px", cursor: "pointer",
              color: "var(--accent-teal)", fontSize: "0.78rem", fontFamily: "var(--font-body)"
            }}>📞 Call 1091</button>
            <button onClick={() => window.location.href = "tel:112"} style={{
              background: "rgba(255,91,107,0.1)", border: "1px solid rgba(255,91,107,0.3)",
              borderRadius: 8, padding: "8px 14px", cursor: "pointer",
              color: "var(--accent-coral)", fontSize: "0.78rem", fontFamily: "var(--font-body)"
            }}>🚨 Call 112</button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <input
          className="chat-input"
          placeholder="Type your message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="chat-send" onClick={send}>➤</button>
      </div>
    </div>
  );
}