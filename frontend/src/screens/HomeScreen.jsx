import { useState, useEffect, useRef } from "react";
import { Circle, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

import HelplineModal from "../components/HelplineModal";
import SOSCountdown from "../components/SOSCountdown";
import ChatPanel from "../components/ChatPanel";
import RoutePanel from "../components/RoutePanel";
import { api } from "../services/api";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const DEFAULT_RISK = {
  risk_score: 22,
  risk_zone: "LOW",
  ai_score: 0.18,
  community_score: 0.3,
  label: "Generally Safe",
};

const DEFAULT_POLICE = {
  name: "Nearest Police Station",
  distance_m: 800,
  phone: "100",
};

function RecenterMap({ coords }) {
  const map = useMap();
  useEffect(() => {
    map.setView([coords.lat, coords.lng], Math.max(map.getZoom(), 14));
  }, [coords, map]);
  return null;
}

function MapDestinationPicker({ enabled, onPick }) {
  useMapEvents({
    click(e) {
      if (!enabled) return;
      onPick?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function toLatLngPath(coords) {
  if (!Array.isArray(coords)) return [];
  return coords
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map((point) => [point[1], point[0]]);
}

function distanceMeters(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const aa =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
  return 6371000 * 2 * Math.asin(Math.sqrt(aa));
}

export default function HomeScreen({ user }) {
  const [showHelpline, setShowHelpline] = useState(false);
  const [showSOS, setShowSOS] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showRoute, setShowRoute] = useState(false);
  const [helplineHighlight, setHelplineHighlight] = useState(false);
  const [coords, setCoords] = useState({ lat: 13.0827, lng: 80.2707 });
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const [locationAccuracyM, setLocationAccuracyM] = useState(null);
  const [locationError, setLocationError] = useState("");
  const [locationUpdatedAt, setLocationUpdatedAt] = useState(null);
  const [riskData, setRiskData] = useState(DEFAULT_RISK);
  const [policeData, setPoliceData] = useState(DEFAULT_POLICE);
  const [routeOverlay, setRouteOverlay] = useState(null);
  const [mapPickEnabled, setMapPickEnabled] = useState(false);

  const longPressRef = useRef(null);
  const watchIdRef = useRef(null);
  const lastInsightCoordsRef = useRef(null);

  async function refreshLocationInsights(lat, lng) {
    try {
      const [risk, police] = await Promise.all([
        api.predictRisk(lat, lng),
        api.nearestPolice(lat, lng),
      ]);

      if (risk) setRiskData(risk);
      if (police) setPoliceData(police);
    } catch {
      // Keep fallback data when APIs are unavailable.
    }
  }

  function maybeRefreshInsights(nextCoords, force = false) {
    const last = lastInsightCoordsRef.current;
    if (!force && last && distanceMeters(last, nextCoords) < 120) return;

    lastInsightCoordsRef.current = nextCoords;
    refreshLocationInsights(nextCoords.lat, nextCoords.lng);
  }

  function applyGeolocationPosition(pos, forceInsights = false) {
    const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const accuracy = Number(pos.coords.accuracy);

    setCoords(next);
    setLocationConfirmed(true);
    setLocationError("");
    setLocationUpdatedAt(Date.now());
    setLocationAccuracyM(Number.isFinite(accuracy) ? Math.round(accuracy) : null);
    maybeRefreshInsights(next, forceInsights);
  }

  function requestCurrentLocation(forceInsights = true) {
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => applyGeolocationPosition(pos, forceInsights),
      (err) => setLocationError(err?.message || "Unable to fetch current location."),
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  }

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported in this browser.");
      return undefined;
    }

    requestCurrentLocation(true);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => applyGeolocationPosition(pos, false),
      (err) => setLocationError(err?.message || "Live GPS updates unavailable."),
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 5000,
      }
    );

    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSOSComplete() {
    setShowSOS(false);
    setHelplineHighlight(true);
    setTimeout(() => setHelplineHighlight(false), 8000);
    alert("SOS Sent! Emergency contacts and police notified. Tap the phone button for direct helpline.");
  }

  function handleHelplineLongPress() {
    clearTimeout(longPressRef.current);
    longPressRef.current = setTimeout(() => {
      window.location.href = "tel:112";
    }, 600);
  }

  function previewDestination(next) {
    if (next?.lat == null || next?.lng == null) return;
    setMapPickEnabled(false);
    setRouteOverlay((prev) => ({
      ...(prev || {}),
      destination: next,
      shortest: [],
      safest: [],
    }));
  }

  async function handleMapDestinationPick(clicked) {
    setMapPickEnabled(false);
    setShowRoute(true);
    try {
      const resolved = await api.reverseGeocode(clicked.lat, clicked.lng);
      previewDestination({
        lat: resolved.latitude,
        lng: resolved.longitude,
        label: resolved.display_name,
      });
    } catch {
      previewDestination({
        lat: clicked.lat,
        lng: clicked.lng,
        label: `${clicked.lat.toFixed(5)}, ${clicked.lng.toFixed(5)}`,
      });
    }
  }

  const riskScore = Number(riskData?.risk_score ?? DEFAULT_RISK.risk_score);
  const riskZone = riskData?.risk_zone || DEFAULT_RISK.risk_zone;
  const riskLabel = riskData?.label || DEFAULT_RISK.label;
  const aiScore = Number(riskData?.ai_score ?? DEFAULT_RISK.ai_score);
  const communityScore = Number(riskData?.community_score ?? DEFAULT_RISK.community_score);

  const riskColor = riskScore < 35 ? "var(--accent-teal)" : riskScore < 65 ? "var(--accent-amber)" : "var(--accent-coral)";
  const riskClass = riskScore < 35 ? "low" : riskScore < 65 ? "med" : "high";

  const shortestPath = toLatLngPath(routeOverlay?.shortest || []);
  const safestPath = toLatLngPath(routeOverlay?.safest || []);
  const destination = routeOverlay?.destination;
  const accuracyRadiusM = locationAccuracyM == null ? null : Math.max(18, Math.min(locationAccuracyM, 250));
  const gpsStatusText = locationConfirmed
    ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}${locationAccuracyM != null ? ` (+/-${locationAccuracyM}m)` : ""}`
    : "Fetching location...";
  const gpsTimestampText = locationUpdatedAt
    ? `Updated ${new Date(locationUpdatedAt).toLocaleTimeString()}`
    : "";

  const policeDistanceKm = Number(policeData?.distance_m || 0) / 1000;

  return (
    <div className="home-screen">
      {/* Header */}
      <div className="home-header">
        <div className="header-left">
          <h2>SAFE ZONE</h2>
          <p style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: locationConfirmed ? "var(--accent-teal)" : "var(--text-muted)", display: "inline-block" }} />
            {gpsStatusText}
          </p>
          {gpsTimestampText && (
            <p style={{ marginTop: 2, fontSize: "0.72rem", color: "var(--text-muted)" }}>{gpsTimestampText}</p>
          )}
          {locationError && (
            <p style={{ marginTop: 2, fontSize: "0.72rem", color: "var(--accent-coral)" }}>{locationError}</p>
          )}
        </div>
        <button
          className={`helpline-btn ${helplineHighlight ? "highlight" : ""}`}
          onMouseDown={handleHelplineLongPress}
          onMouseUp={() => clearTimeout(longPressRef.current)}
          onTouchStart={handleHelplineLongPress}
          onTouchEnd={() => clearTimeout(longPressRef.current)}
          onClick={() => {
            clearTimeout(longPressRef.current);
            setShowHelpline(true);
          }}
          title="Press to see contacts | Hold for direct call"
        >
          ??
        </button>
      </div>

      {/* Map */}
      <div className="map-section" style={{ margin: "16px 16px 0" }}>
        <div className="map-container map-live-wrap">
          <MapContainer center={[coords.lat, coords.lng]} zoom={14} className="map-live" scrollWheelZoom>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <RecenterMap coords={coords} />
            <MapDestinationPicker enabled={mapPickEnabled} onPick={handleMapDestinationPick} />

            <Marker position={[coords.lat, coords.lng]}>
              <Tooltip direction="top" offset={[0, -8]} permanent={false}>Current Location</Tooltip>
            </Marker>
            {accuracyRadiusM != null && (
              <Circle
                center={[coords.lat, coords.lng]}
                radius={accuracyRadiusM}
                pathOptions={{
                  color: "#2563eb",
                  fillColor: "#3b82f6",
                  fillOpacity: 0.18,
                  weight: 1,
                }}
              />
            )}

            {destination && (
              <Marker position={[destination.lat, destination.lng]}>
                <Tooltip direction="top" offset={[0, -8]} permanent={false}>Destination</Tooltip>
              </Marker>
            )}

            {shortestPath.length > 1 && (
              <Polyline positions={shortestPath} pathOptions={{ color: "#3b82f6", weight: 5, opacity: 0.75 }} />
            )}
            {safestPath.length > 1 && (
              <Polyline positions={safestPath} pathOptions={{ color: "#16a34a", weight: 6, opacity: 0.9 }} />
            )}
          </MapContainer>

          <div className="map-overlay-legend">
            <div className="legend-chip"><span className="line shortest" />Shortest</div>
            <div className="legend-chip"><span className="line safest" />Safest</div>
            {locationAccuracyM != null && (
              <div className="legend-chip"><span className="line gps" />GPS +/-{locationAccuracyM}m</div>
            )}
            {mapPickEnabled && (
              <div className="legend-chip">Tap map to pick destination</div>
            )}
          </div>
        </div>

        <div className="risk-legend">
          <div className="legend-item"><div className="legend-dot high" /><span className="legend-label">High Risk</span></div>
          <div className="legend-item"><div className="legend-dot med" /><span className="legend-label">Moderate</span></div>
          <div className="legend-item"><div className="legend-dot low" /><span className="legend-label">Safe Zone</span></div>
        </div>
        <div className="map-actions">
          <button className="map-btn" onClick={() => requestCurrentLocation(true)}>
            <span className="btn-icon">?</span> Use High-Accuracy GPS
          </button>
          <button className={`map-btn ${showRoute ? "active" : ""}`} onClick={() => setShowRoute(!showRoute)}>
            <span className="btn-icon">?</span> Plan Route
          </button>
        </div>
      </div>

      {/* Risk Score Card */}
      <div style={{ margin: "12px 16px 0" }}>
        <div className="risk-card">
          <div className="risk-card-header">
            <span className="risk-card-title">Current Area Risk Score</span>
            <span className={`risk-badge ${riskClass}`}>{riskZone}</span>
          </div>
          <div className="risk-score-display">
            <span className="risk-number" style={{ color: riskColor }}>{riskScore.toFixed(1)}</span>
            <span className="risk-max">/100</span>
          </div>
          <div className="risk-breakdown">
            <div className="breakdown-item">
              <span className="breakdown-label">AI Model</span>
              <span className="breakdown-value">{(aiScore * 100).toFixed(0)}%</span>
            </div>
            <div className="breakdown-item">
              <span className="breakdown-label">Community</span>
              <span className="breakdown-value">{(communityScore * 100).toFixed(0)}%</span>
            </div>
            <div className="breakdown-item">
              <span className="breakdown-label">Status</span>
              <span className="breakdown-value" style={{ color: riskColor }}>{riskLabel}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Route Panel */}
      {showRoute && (
        <RoutePanel
          origin={coords}
          onRoutesUpdate={(next) => {
            setMapPickEnabled(false);
            setRouteOverlay(next);
          }}
          onEnableMapPick={() => {
            setShowRoute(true);
            setMapPickEnabled(true);
          }}
          mapPickEnabled={mapPickEnabled}
          pickedDestination={routeOverlay?.destination || null}
          onDestinationPreview={previewDestination}
        />
      )}

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
            <span className="qb-icon">??</span>
            <span className="qb-text">
              <span className="qb-title">Police Help</span>
              <span className="qb-sub">{policeDistanceKm.toFixed(2)} km away</span>
            </span>
          </button>
          <button className="quick-btn" onClick={() => setShowChat(true)}>
            <span className="qb-icon">??</span>
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
      <div className="police-card" onClick={() => window.location.href = `tel:${policeData.phone || "100"}`}>
        <div className="police-icon">??</div>
        <div className="police-info">
          <div className="police-name">{policeData.name || "Nearest Station"}</div>
          <div className="police-sub">{policeData.phone || "100"}</div>
        </div>
        <div className="police-distance">{policeDistanceKm.toFixed(2)} km</div>
      </div>

      <div style={{ height: 20 }} />

      {/* Chat FAB */}
      {!showChat && (
        <button className="chat-fab" onClick={() => setShowChat(true)}>??</button>
      )}

      {/* Modals */}
      {showHelpline && <HelplineModal user={user} onClose={() => setShowHelpline(false)} />}
      {showSOS && <SOSCountdown user={user} coords={coords} onComplete={handleSOSComplete} onCancel={() => setShowSOS(false)} />}
      {showChat && <ChatPanel onClose={() => setShowChat(false)} />}
    </div>
  );
}
