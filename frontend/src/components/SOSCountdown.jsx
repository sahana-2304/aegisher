import { useEffect, useState } from "react";
import { api } from "../services/api";

const RADIUS = 54;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function SOSCountdown({ user, coords, onComplete, onCancel }) {
  const [count, setCount] = useState(3);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (count === 0) {
      setSent(true);
      api
        .triggerSOS(user?.user_id || user?.id, coords.lat, coords.lng, "0.0.0.0")
        .then(() => setTimeout(onComplete, 1500))
        .catch(() => setTimeout(onComplete, 1500));
      return;
    }

    const timer = setTimeout(() => setCount((current) => current - 1), 1000);
    return () => clearTimeout(timer);
  }, [count, coords.lat, coords.lng, onComplete, user?.id, user?.user_id]);

  const progress = (count / 3) * CIRCUMFERENCE;

  return (
    <div className="countdown-overlay">
      <div className="countdown-ring">
        <svg width="160" height="160" viewBox="0 0 160 160">
          <circle className="bg" cx="80" cy="80" r={RADIUS} />
          <circle
            className="progress"
            cx="80"
            cy="80"
            r={RADIUS}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE - progress}
          />
        </svg>
        {sent ? (
          <span style={{ fontSize: "1.2rem", zIndex: 1, letterSpacing: 1 }}>OK</span>
        ) : (
          <span className="countdown-number">{count}</span>
        )}
      </div>

      <div style={{ textAlign: "center" }}>
        <p
          className="countdown-label"
          style={{
            color: "var(--accent-coral)",
            fontSize: "1rem",
            fontFamily: "var(--font-display)",
            letterSpacing: 3,
          }}
        >
          {sent ? "MOCK SOS SENT" : "SENDING MOCK SOS"}
        </p>
        <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 8 }}>
          {sent
            ? "Simulated alert completed successfully."
            : "Simulating emergency contacts and police alert..."}
        </p>
      </div>

      {!sent && (
        <button className="countdown-cancel" onClick={onCancel}>
          CANCEL SOS
        </button>
      )}
    </div>
  );
}
