import { useState } from "react";

export default function RoutePanel() {
  const [dest, setDest] = useState("");
  const [transport, setTransport] = useState("walking");
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);

  function findRoute() {
    if (!dest.trim()) return;
    setLoading(true);
    // Simulate API call - in production calls /api/routes/safe
    setTimeout(() => {
      setRoute({
        distance: "2.4 km",
        duration: "28 min",
        safetyScore: 82,
        avoidedZones: 2,
        segments: ["Via Anna Nagar Main Rd", "Right on 15th Cross St", "Arrive at destination"],
      });
      setLoading(false);
    }, 1500);
  }

  return (
    <div className="route-panel" style={{ margin: "12px 16px 0" }}>
      <div className="route-panel-header">
        <span>◈</span>
        <h3>SAFE ROUTE</h3>
      </div>
      <div className="route-input-wrap">
        <div className="route-input">
          <div className="route-dot origin" />
          <input value="Current Location" disabled style={{ color: "var(--text-muted)" }} />
        </div>
        <div className="route-input">
          <div className="route-dot dest" />
          <input
            placeholder="Enter destination..."
            value={dest}
            onChange={(e) => setDest(e.target.value)}
          />
        </div>
        <div className="transport-opts">
          {[
            { id: "walking", icon: "🚶", label: "Walk" },
            { id: "driving", icon: "🚗", label: "Drive" },
            { id: "cycling", icon: "🚲", label: "Cycle" },
          ].map((t) => (
            <button key={t.id} className={`transport-btn ${transport === t.id ? "selected" : ""}`}
              onClick={() => setTransport(t.id)}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        <button className="find-route-btn" onClick={findRoute} disabled={loading}>
          {loading ? "COMPUTING..." : "FIND SAFEST ROUTE"}
        </button>
      </div>

      {route && (
        <>
          <div className="route-result">
            <div className="route-stat"><div className="route-stat-value">{route.distance}</div><div className="route-stat-label">Distance</div></div>
            <div className="route-stat"><div className="route-stat-value">{route.duration}</div><div className="route-stat-label">Est. Time</div></div>
            <div className="route-stat"><div className="route-stat-value" style={{ color: "var(--accent-amber)" }}>{route.avoidedZones}</div><div className="route-stat-label">Zones Avoided</div></div>
          </div>
          <div className="route-safety-bar">
            <div className="route-safety-label">
              <span className="rsb-text">Safety Score</span>
              <span className="rsb-val">{route.safetyScore}/100</span>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${route.safetyScore}%` }} />
            </div>
          </div>
          <div style={{ padding: "0 16px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
            {route.segments.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 20, height: 20, background: "var(--bg-elevated)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", color: "var(--accent-teal)", flexShrink: 0 }}>{i + 1}</span>
                <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>{s}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}