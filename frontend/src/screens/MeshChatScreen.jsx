import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Copy, MessageSquare, RefreshCw, Send, Shield, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import "./MeshChatScreen.css";

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function encodeDesc(desc) {
  return btoa(JSON.stringify(desc));
}

function decodeDesc(code) {
  return JSON.parse(atob(code.trim()));
}

function waitForIceComplete(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    function check() {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    }
    pc.addEventListener("icegatheringstatechange", check);
  });
}

function createMessage(id, sender, text) {
  return { id, sender, text, time: nowTime() };
}

export default function MeshChatScreen({ user }) {
  const navigate = useNavigate();
  const peerRef = useRef(null);
  const channelRef = useRef(null);
  const scrollRef = useRef(null);
  const msgCounterRef = useRef(0);

  const [role, setRole] = useState("host"); // host | join
  const [status, setStatus] = useState("Disconnected");
  const [offerCode, setOfferCode] = useState("");
  const [replyCode, setReplyCode] = useState("");
  const [hostCodeInput, setHostCodeInput] = useState("");
  const [replyCodeInput, setReplyCodeInput] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [messages, setMessages] = useState([
    createMessage("sys-boot", "system", "Mesh chat ready. Choose Host or Join, then exchange one code each."),
  ]);

  const emergencyTemplates = useMemo(
    () => [
      "I need immediate help.",
      "Share your location now.",
      "I am safe right now.",
      "Call emergency services now.",
    ],
    [],
  );

  useEffect(() => {
    return () => {
      try {
        channelRef.current?.close();
      } catch {
        // noop
      }
      try {
        peerRef.current?.close();
      } catch {
        // noop
      }
      channelRef.current = null;
      peerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  function nextMessageId() {
    msgCounterRef.current += 1;
    return `msg-${msgCounterRef.current}`;
  }

  function pushSystem(textValue) {
    setMessages((prev) => [...prev, createMessage(nextMessageId(), "system", textValue)]);
  }

  function pushPeer(textValue) {
    setMessages((prev) => [...prev, createMessage(nextMessageId(), "peer", textValue)]);
  }

  function pushMine(textValue) {
    setMessages((prev) => [...prev, createMessage(nextMessageId(), "me", textValue)]);
  }

  function resetSession() {
    setError("");
    setStatus("Disconnected");
    setOfferCode("");
    setReplyCode("");
    setHostCodeInput("");
    setReplyCodeInput("");
    setText("");

    try {
      channelRef.current?.close();
    } catch {
      // noop
    }
    try {
      peerRef.current?.close();
    } catch {
      // noop
    }
    channelRef.current = null;
    peerRef.current = null;
    pushSystem("Session reset. Start again.");
  }

  function bindPeerConnection(pc) {
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState || "new";
      if (state === "connected") setStatus("Connected");
      else if (state === "connecting") setStatus("Connecting...");
      else if (state === "failed") setStatus("Connection failed");
      else if (state === "disconnected") setStatus("Disconnected");
      else if (state === "closed") setStatus("Closed");
      else setStatus("Disconnected");
    };
  }

  function bindDataChannel(channel) {
    channelRef.current = channel;
    channel.onopen = () => {
      setStatus("Connected");
      pushSystem("Secure P2P channel connected.");
    };
    channel.onclose = () => {
      setStatus("Disconnected");
      pushSystem("Peer channel closed.");
    };
    channel.onerror = () => {
      setStatus("Channel error");
      setError("Data channel error.");
    };
    channel.onmessage = (event) => {
      pushPeer(String(event.data || ""));
    };
  }

  async function startAsHost() {
    setError("");
    resetSession();
    setRole("host");

    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      peerRef.current = pc;
      bindPeerConnection(pc);

      const channel = pc.createDataChannel("aegisher-mesh-1v1", { ordered: true });
      bindDataChannel(channel);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceComplete(pc);
      setOfferCode(encodeDesc(pc.localDescription));
      setStatus("Host code ready");
      pushSystem("Host code created. Share it with your friend.");
    } catch (e) {
      setError(e?.message || "Failed to create host session.");
    }
  }

  async function applyReply() {
    setError("");
    const pc = peerRef.current;
    if (!pc) {
      setError("Create host code first.");
      return;
    }
    if (!replyCodeInput.trim()) {
      setError("Paste reply code first.");
      return;
    }
    try {
      const answer = decodeDesc(replyCodeInput);
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      setStatus("Connecting...");
      pushSystem("Reply code accepted. Connecting...");
    } catch (e) {
      setError(e?.message || "Invalid reply code.");
    }
  }

  async function startAsJoiner() {
    setError("");
    resetSession();
    setRole("join");

    if (!hostCodeInput.trim()) {
      setError("Paste host code first.");
      return;
    }

    try {
      const remoteOffer = decodeDesc(hostCodeInput);
      const pc = new RTCPeerConnection({ iceServers: [] });
      peerRef.current = pc;
      bindPeerConnection(pc);

      pc.ondatachannel = (event) => {
        bindDataChannel(event.channel);
      };

      await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceComplete(pc);
      setReplyCode(encodeDesc(pc.localDescription));
      setStatus("Reply code ready");
      pushSystem("Reply code created. Send it back to host.");
    } catch (e) {
      setError(e?.message || "Invalid host code.");
    }
  }

  function sendMessage(value) {
    const next = String(value || "").trim();
    if (!next) return;

    const channel = channelRef.current;
    if (!channel || channel.readyState !== "open") {
      setError("Peer channel is not connected yet.");
      return;
    }

    try {
      channel.send(next);
      pushMine(next);
      setText("");
      setError("");
    } catch (e) {
      setError(e?.message || "Failed to send message.");
    }
  }

  async function copyToClipboard(value, label) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      pushSystem(`${label} copied.`);
    } catch {
      setError(`Could not copy ${label.toLowerCase()}.`);
    }
  }

  const canSend = channelRef.current?.readyState === "open";

  return (
    <div className="mesh-screen">
      <header className="mesh-header">
        <button type="button" className="mesh-back" onClick={() => navigate(-1)}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1>Mesh Chat</h1>
          <p>Simple 1:1 offline-friendly emergency chat</p>
        </div>
      </header>

      <section className="mesh-status">
        <div className="mesh-badge">
          <Shield size={14} />
          <span>{status}</span>
        </div>
        <button type="button" className="mesh-reset" onClick={resetSession}>
          <RefreshCw size={14} />
          Start Over
        </button>
      </section>

      {error && <div className="mesh-error">{error}</div>}

      <section className="mesh-card">
        <h3>How To Connect</h3>
        <ol className="mesh-steps">
          <li>One person taps <strong>Host</strong> and shares the host code.</li>
          <li>Other person pastes host code, taps <strong>Join</strong>, then shares reply code.</li>
          <li>Host pastes reply code and taps <strong>Connect</strong>.</li>
        </ol>

        <div className="mesh-role-tabs">
          <button
            type="button"
            className={role === "host" ? "active" : ""}
            onClick={() => setRole("host")}
          >
            <Shield size={16} />
            Host
          </button>
          <button
            type="button"
            className={role === "join" ? "active" : ""}
            onClick={() => setRole("join")}
          >
            <User size={16} />
            Join
          </button>
        </div>
        {role === "host" ? (
          <div className="mesh-role-panel">
            <div className="mesh-field">
              <label>1. Create Host Code</label>
              <button type="button" onClick={startAsHost}>
                Create Host Code
              </button>
              <textarea value={offerCode} readOnly placeholder="Host code appears here" />
              <button
                type="button"
                onClick={() => copyToClipboard(offerCode, "Host code")}
                disabled={!offerCode}
              >
                <Copy size={14} />
                Copy Host Code
              </button>
            </div>
            <div className="mesh-field">
              <label>2. Paste Reply Code</label>
              <textarea
                value={replyCodeInput}
                onChange={(e) => setReplyCodeInput(e.target.value)}
                placeholder="Paste reply code from joiner"
              />
              <button type="button" onClick={applyReply} disabled={!replyCodeInput.trim()}>
                Connect
              </button>
            </div>
          </div>
        ) : (
          <div className="mesh-role-panel">
            <div className="mesh-field">
              <label>1. Paste Host Code</label>
              <textarea
                value={hostCodeInput}
                onChange={(e) => setHostCodeInput(e.target.value)}
                placeholder="Paste host code here"
              />
            </div>
            <div className="mesh-field">
              <label>2. Create Reply Code</label>
              <button type="button" onClick={startAsJoiner} disabled={!hostCodeInput.trim()}>
                Create Reply Code
              </button>
              <textarea value={replyCode} readOnly placeholder="Reply code appears here" />
              <button
                type="button"
                onClick={() => copyToClipboard(replyCode, "Reply code")}
                disabled={!replyCode}
              >
                <Copy size={14} />
                Copy Reply Code
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="mesh-card mesh-chat">
        <h3>
          <MessageSquare size={16} />
          Messages
        </h3>

        <div className="mesh-template-row">
          {emergencyTemplates.map((tpl) => (
            <button key={tpl} type="button" onClick={() => sendMessage(tpl)} disabled={!canSend}>
              {tpl}
            </button>
          ))}
        </div>

        <div className="mesh-log" ref={scrollRef}>
          {messages.map((msg) => (
            <div key={msg.id} className={`mesh-msg ${msg.sender}`}>
              <div className="mesh-msg-bubble">{msg.text}</div>
              <small>{msg.time}</small>
            </div>
          ))}
        </div>

        <div className="mesh-compose">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                sendMessage(text);
              }
            }}
            placeholder="Type emergency message..."
          />
          <button type="button" onClick={() => sendMessage(text)} disabled={!canSend || !text.trim()}>
            <Send size={16} />
          </button>
        </div>
      </section>

      <section className="mesh-notes">
        <p>
          User: <strong>{user?.name || "Unknown"}</strong>
        </p>
        <p>
          Route is hidden from navbar intentionally. Open <code>/mesh-chat</code> directly.
        </p>
      </section>
    </div>
  );
}
