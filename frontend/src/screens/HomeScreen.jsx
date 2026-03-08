import { useState, useEffect, useRef } from "react";
import HelplineModal from "../components/HelplineModal";
import SOSCountdown from "../components/SOSCountdown";
import ChatPanel from "../components/ChatPanel";
import RoutePanel from "../components/RoutePanel";

// Mock risk data - in production comes from backend ML engine
const MOCK_RISK = { score: 22, zone: "LOW", aiScore: 0.18, communityScore: 0.3, label: "Generally Safe" };
const MOCK_POLICE = { name: "Anna Nagar West PS", distance: "0.8 km", phone: "044-23617155" };

export default function HomeScreen({ user }) {
  const [showHelpline, setShowHelpline] = useState(false);
  const [showSOS, setShowSOS] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showRoute, setShowRoute] = useState(false);
  const [helplineHighlight, setHelplineHighlight] = useState(false);
  const [coords, setCoords] = useState({ lat: 13.0827, lng: 80.2707 });
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const longPressRef = useRef(null);
  const [riskData] = useState(MOCK_RISK);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {}
      );
    }
  }, []);

  function handleSOSComplete() {
    setShowSOS(false);
    setHelplineHighlight(true);
    setTimeout(() => setHelplineHighlight(false), 8000);
    alert("🚨 SOS Sent! Emergency contacts and police notified. Tap the phone button for direct helpline.");
  }

  function handleHelplineLongPress() {
    clearTimeout(longPressRef.current);
    longPressRef.current = setTimeout(() => {
      window.location.href = "tel:112";
    }, 600);
  }

  const riskColor = riskData.score < 35 ? "var(--accent-teal)" : riskData.score < 65 ? "var(--accent-amber)" : "var(--accent-coral)";
  const riskClass = riskData.score < 35 ? "low" : riskData.score < 65 ? "med" : "high";

  return (
    <div className="home-screen">
      {/* Header */}
      <div className="home-header">
        <div className="header-left">
          <h2>SAFE ZONE</h2>
          <p style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: locationConfirmed ? "var(--accent-teal)" : "var(--text-muted)", display: "inline-block" }} />
            {locationConfirmed ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : "Tap to confirm location"}
          </p>
        </div>
        <button
          className={`helpline-btn ${helplineHighlight ? "highlight" : ""}`}
          onMouseDown={handleHelplineLongPress}
          onMouseUp={() => clearTimeout(longPressRef.current)}
          onTouchStart={handleHelplineLongPress}
          onTouchEnd={() => clearTimeout(longPressRef.current)}
          onClick={() => { clearTimeout(longPressRef.current); setShowHelpline(true); }}
          title="Press to see contacts | Hold for direct call"
        >📞</button>
      </div>

      {/* Map */}
      <div className="map-section" style={{ margin: "16px 16px 0" }}>
        <div className="map-container">
          <div className="map-placeholder">
            <div className="map-grid" />
            <div className="map-roads" />
            <div className="map-hotspot hotspot-red" />
            <div className="map-hotspot hotspot-amber" />
            <div className="map-hotspot hotspot-green" />
            <div className="user-dot">
              <div className="user-dot-ring" />
              <div className="user-dot-inner" />
            </div>
            <div className="map-label label-coords">{coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</div>
            <div className="map-label label-zone" style={{ color: riskColor }}>{riskData.zone} RISK</div>
          </div>
        </div>
        <div className="risk-legend">
          <div className="legend-item"><div className="legend-dot high" /><span className="legend-label">High Risk</span></div>
          <div className="legend-item"><div className="legend-dot med" /><span className="legend-label">Moderate</span></div>
          <div className="legend-item"><div className="legend-dot low" /><span className="legend-label">Safe Zone</span></div>
        </div>
        <div className="map-actions">
          <button className="map-btn" onClick={() => { setLocationConfirmed(true); }}>
            <span className="btn-icon">◎</span> Confirm Location
          </button>
          <button className={`map-btn ${showRoute ? "active" : ""}`} onClick={() => setShowRoute(!showRoute)}>
            <span className="btn-icon">◈</span> Safe Route
          </button>
        </div>
      </div>

      {/* Risk Score Card */}
      <div style={{ margin: "12px 16px 0" }}>
        <div className="risk-card">
          <div className="risk-card-header">
            <span className="risk-card-title">Current Area Risk Score</span>
            <span className={`risk-badge ${riskClass}`}>{riskData.zone}</span>
          </div>
          <div className="risk-score-display">
            <span className="risk-number" style={{ color: riskColor }}>{riskData.score}</span>
            <span className="risk-max">/100</span>
          </div>
          <div className="risk-breakdown">
            <div className="breakdown-item">
              <span className="breakdown-label">AI Model</span>
              <span className="breakdown-value">{(riskData.aiScore * 100).toFixed(0)}%</span>
            </div>
            <div className="breakdown-item">
              <span className="breakdown-label">Community</span>
              <span className="breakdown-value">{(riskData.communityScore * 100).toFixed(0)}%</span>
            </div>
            <div className="breakdown-item">
              <span className="breakdown-label">Status</span>
              <span className="breakdown-value" style={{ color: riskColor }}>{riskData.label}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Route Panel */}
      {showRoute && <RoutePanel style={{ marginTop: 12 }} />}

      {/* SOS Section */}
      <div className="section-header" style={{ marginTop: 12 }}>
        <span className="section-title">Emergency Actions</span>
        <span className="section-action">Hold SOS for 3s</span>
      </div>
      <div className="sos-zone">
        <div className="sos-btn-wrap">
          <div className="sos-rings">
            <div className="sos-ring" />
            <div className="sos-ring" />
            <div className="sos-ring" />
          </div>
          <button className="sos-btn" onClick={() => setShowSOS(true)}>
            <span className="sos-label">SOS</span>
            <span className="sos-sublabel">TAP TO ALERT</span>
          </button>
        </div>
        <div className="sos-side-btns">
          <button className="quick-btn" onClick={() => {
            const url = `https://maps.google.com/?q=police+station+near+${coords.lat},${coords.lng}`;
            window.open(url, "_blank");
          }}>
            <span className="qb-icon">🚔</span>
            <span className="qb-text">
              <span className="qb-title">Police Help</span>
              <span className="qb-sub">{MOCK_POLICE.distance} away</span>
            </span>
          </button>
          <button className="quick-btn" onClick={() => setShowChat(true)}>
            <span className="qb-icon">💬</span>
            <span className="qb-text">
              <span className="qb-title">Chat Support</span>
              <span className="qb-sub">AI + Human</span>
            </span>
          </button>
        </div>
      </div>

      {/* Police Card */}
      <div className="section-header">
        <span className="section-title">Nearest Police Station</span>
      </div>
      <div className="police-card" onClick={() => window.location.href = `tel:${MOCK_POLICE.phone}`}>
        <div className="police-icon">🚔</div>
        <div className="police-info">
          <div className="police-name">{MOCK_POLICE.name}</div>
          <div className="police-sub">{MOCK_POLICE.phone}</div>
        </div>
        <div className="police-distance">{MOCK_POLICE.distance}</div>
      </div>

      <div style={{ height: 20 }} />

      {/* Chat FAB */}
      {!showChat && (
        <button className="chat-fab" onClick={() => setShowChat(true)}>💬</button>
      )}

      {/* Modals */}
      {showHelpline && <HelplineModal user={user} onClose={() => setShowHelpline(false)} />}
      {showSOS && <SOSCountdown user={user} coords={coords} onComplete={handleSOSComplete} onCancel={() => setShowSOS(false)} />}
      {showChat && <ChatPanel onClose={() => setShowChat(false)} />}
    </div>
  );
}