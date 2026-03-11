import { useEffect, useRef, useState } from "react";
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import {
  AlertTriangle,
  Bell,
  ChevronDown,
  ChevronRight,
  Heart,
  Info,
  LocateFixed,
  MapPin,
  MessageCircle,
  Minus,
  Phone,
  PhoneCall,
  Plus,
  Route as RouteIcon,
  Shield,
  ShieldAlert,
  Users,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import HelplineModal from "../components/HelplineModal";
import SOSCountdown from "../components/SOSCountdown";
import ChatPanel from "../components/ChatPanel";
import RoutePanel from "../components/RoutePanel";
import { api } from "../services/api";
import "./HomeScreen.css";

const markerBase = import.meta.env.BASE_URL || "/";
const currentLocationMarkerIcon = new L.Icon({
  iconUrl: `${markerBase}marker1.png`,
  iconRetinaUrl: `${markerBase}marker1.png`,
  iconSize: [40, 46],
  iconAnchor: [20, 44],
  popupAnchor: [0, -38],
  shadowUrl: markerShadow,
  shadowSize: [41, 41],
  shadowAnchor: [13, 41],
});

const destinationMarkerIcon = new L.Icon({
  iconUrl: `${markerBase}marker2.png`,
  iconRetinaUrl: `${markerBase}marker2.png`,
  iconSize: [40, 46],
  iconAnchor: [20, 44],
  popupAnchor: [0, -38],
  shadowUrl: markerShadow,
  shadowSize: [41, 41],
  shadowAnchor: [13, 41],
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

function MapZoomControls({ onLocate }) {
  const map = useMap();

  function run(handler) {
    return (event) => {
      event.preventDefault();
      event.stopPropagation();
      handler();
    };
  }

  return (
    <div className="hs-map-controls">
      <button type="button" className="hs-map-control-btn" onClick={run(() => onLocate?.())}>
        <LocateFixed size={18} />
      </button>
      <button type="button" className="hs-map-control-btn" onClick={run(() => map.zoomIn())}>
        <Plus size={18} />
      </button>
      <button type="button" className="hs-map-control-btn" onClick={run(() => map.zoomOut())}>
        <Minus size={18} />
      </button>
    </div>
  );
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
  const navigate = useNavigate();
  const [showHelpline, setShowHelpline] = useState(false);
  const [showSOS, setShowSOS] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showRoute, setShowRoute] = useState(false);
  const [showRiskDetails, setShowRiskDetails] = useState(true);
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
  const [clockText, setClockText] = useState(() =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  );

  const longPressRef = useRef(null);
  const watchIdRef = useRef(null);
  const lastInsightCoordsRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setClockText(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  async function refreshLocationInsights(lat, lng) {
    try {
      const [risk, police] = await Promise.all([api.predictRisk(lat, lng), api.nearestPolice(lat, lng)]);

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
      },
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
      },
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
    alert("Mock SOS sent. This is a simulated alert flow.");
  }

  function handleHelplineLongPress() {
    clearTimeout(longPressRef.current);
    longPressRef.current = setTimeout(() => {
      window.location.href = "tel:112";
    }, 600);
  }

  function clearHelplineLongPress() {
    clearTimeout(longPressRef.current);
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

  const riskColor = riskScore < 35 ? "#10b981" : riskScore < 65 ? "#f59e0b" : "#ef4444";
  const riskClass = riskScore < 35 ? "low" : riskScore < 65 ? "med" : "high";
  const boundedRiskScore = Math.max(0, Math.min(100, riskScore));
  const riskCircumference = 2 * Math.PI * 26;
  const riskStroke = (boundedRiskScore / 100) * riskCircumference;

  const shortestPath = toLatLngPath(routeOverlay?.shortest || []);
  const safestPath = toLatLngPath(routeOverlay?.safest || []);
  const destination = routeOverlay?.destination;
  const accuracyRadiusM = locationAccuracyM == null ? null : Math.max(18, Math.min(locationAccuracyM, 250));
  const policeDistanceKm = Number(policeData?.distance_m || 0) / 1000;

  return (
    <div className="hs-mobile-screen">
      <div className="hs-status-bar">
        <div className="hs-status-left">
          <span className={`hs-location-dot ${locationConfirmed ? "active" : ""}`} />
          <span>{locationConfirmed ? "GPS Active" : "Acquiring GPS..."}</span>
        </div>
        <div className="hs-status-right">
          <Bell size={14} />
          <span>{clockText}</span>
        </div>
      </div>

      <header className="hs-main-header">
        <div className="hs-brand">
          <Shield size={20} />
          <div>
            <h1>SafeZone</h1>
            <p>{locationUpdatedAt ? `Updated ${new Date(locationUpdatedAt).toLocaleTimeString()}` : "Awaiting GPS fix"}</p>
          </div>
        </div>
        <button
          type="button"
          className={`hs-icon-btn ${helplineHighlight ? "pulse" : ""}`}
          onMouseDown={handleHelplineLongPress}
          onMouseUp={clearHelplineLongPress}
          onMouseLeave={clearHelplineLongPress}
          onTouchStart={handleHelplineLongPress}
          onTouchEnd={clearHelplineLongPress}
          onTouchCancel={clearHelplineLongPress}
          onClick={() => {
            clearHelplineLongPress();
            setShowHelpline(true);
          }}
          title="Press to view helpline contacts. Hold to call 112."
        >
          <PhoneCall size={18} />
        </button>
      </header>

      <button type="button" className="hs-location-bar" onClick={() => setShowRiskDetails((prev) => !prev)}>
        <div className="hs-location-main">
          <MapPin size={16} />
          <div className="hs-location-copy">
            <span>{locationConfirmed ? `${coords.lat.toFixed(4)} N, ${coords.lng.toFixed(4)} E` : "Fetching location..."}</span>
            {locationAccuracyM != null && <small>+/-{locationAccuracyM}m accuracy</small>}
          </div>
        </div>
        <ChevronDown size={18} className={showRiskDetails ? "open" : ""} />
      </button>

      {locationError && <div className="hs-location-error">{locationError}</div>}

      {showRiskDetails && (
        <section className="hs-risk-card">
          <div className="hs-risk-head">
            <div className="hs-risk-title">
              <ShieldAlert size={16} />
              <span>Area Risk Assessment</span>
            </div>
            <span className={`hs-risk-badge ${riskClass}`}>{riskZone}</span>
          </div>
          <div className="hs-risk-body">
            <div className="hs-risk-score">
              <span style={{ color: riskColor }}>{riskScore.toFixed(0)}</span>
              <small>Risk Score</small>
            </div>
            <div className="hs-risk-ring">
              <svg width="60" height="60" viewBox="0 0 60 60" aria-hidden="true">
                <circle cx="30" cy="30" r="26" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
                <circle
                  cx="30"
                  cy="30"
                  r="26"
                  fill="none"
                  stroke={riskColor}
                  strokeWidth="4"
                  strokeDasharray={`${riskStroke} ${riskCircumference}`}
                  transform="rotate(-90 30 30)"
                />
              </svg>
            </div>
          </div>
          <div className="hs-risk-metrics">
            <div className="hs-risk-metric">
              <Users size={14} />
              <div>
                <span>Community</span>
                <strong>{(communityScore * 100).toFixed(0)}%</strong>
              </div>
            </div>
            <div className="hs-risk-metric">
              <Heart size={14} />
              <div>
                <span>AI Model</span>
                <strong>{(aiScore * 100).toFixed(0)}%</strong>
              </div>
            </div>
          </div>
          <div className="hs-risk-foot">
            <Info size={14} />
            <span>{riskLabel}</span>
          </div>
        </section>
      )}

      <section className="hs-map-section">
        <div className="hs-map-wrapper">
          <MapContainer
            center={[coords.lat, coords.lng]}
            zoom={14}
            className="hs-mobile-map"
            zoomControl={false}
            attributionControl={false}
            scrollWheelZoom
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <RecenterMap coords={coords} />
            <MapDestinationPicker enabled={mapPickEnabled} onPick={handleMapDestinationPick} />
            <MapZoomControls onLocate={() => requestCurrentLocation(true)} />

            <Marker position={[coords.lat, coords.lng]} icon={currentLocationMarkerIcon}>
              <Tooltip direction="top" offset={[0, -8]}>
                Current location
              </Tooltip>
            </Marker>

            {accuracyRadiusM != null && (
              <Circle
                center={[coords.lat, coords.lng]}
                radius={accuracyRadiusM}
                pathOptions={{
                  color: "#3b82f6",
                  fillColor: "#3b82f6",
                  fillOpacity: 0.12,
                  weight: 1,
                }}
              />
            )}

            {destination && (
              <Marker position={[destination.lat, destination.lng]} icon={destinationMarkerIcon}>
                <Tooltip direction="top" offset={[0, -8]}>
                  Destination
                </Tooltip>
              </Marker>
            )}

            {shortestPath.length > 1 && (
              <Polyline positions={shortestPath} pathOptions={{ color: "#3b82f6", weight: 4, opacity: 0.8 }} />
            )}
            {safestPath.length > 1 && (
              <Polyline positions={safestPath} pathOptions={{ color: "#10b981", weight: 5, opacity: 0.92 }} />
            )}
          </MapContainer>

          <div className="hs-map-legend">
            <span className="hs-legend-chip">
              <span className="hs-legend-dot shortest" />
              Shortest
            </span>
            <span className="hs-legend-chip">
              <span className="hs-legend-dot safest" />
              Safest
            </span>
            {mapPickEnabled && <span className="hs-legend-chip">Tap map to pick destination</span>}
          </div>
        </div>

        <div className="hs-quick-actions">
          <button type="button" className={`hs-action-btn ${showRoute ? "active" : ""}`} onClick={() => setShowRoute((prev) => !prev)}>
            <RouteIcon size={18} />
            <span>Route</span>
          </button>
          <button type="button" className="hs-action-btn" onClick={() => setShowChat(true)}>
            <MessageCircle size={18} />
            <span>Chat</span>
          </button>
          <button type="button" className="hs-action-btn danger" onClick={() => setShowSOS(true)}>
            <AlertTriangle size={18} />
            <span>SOS</span>
          </button>
        </div>
      </section>

      {showRoute && (
        <section className="hs-route-sheet">
          <div className="hs-route-head">
            <h3>Plan Your Route</h3>
            <button type="button" className="hs-close-btn" onClick={() => setShowRoute(false)}>
              <X size={18} />
            </button>
          </div>
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
        </section>
      )}

      {!showRoute && (
        <section className="hs-support-section">
          <div className="hs-support-head">
            <h3>Emergency Support</h3>
            <span>Available 24/7</span>
          </div>

          <div className="hs-support-grid">
            <button
              type="button"
              className="hs-support-card police"
              onClick={() => {
                window.location.href = `tel:${policeData.phone || "100"}`;
              }}
            >
              <Shield size={20} />
              <div className="hs-support-copy">
                <strong>{policeData.name || "Nearest Police"}</strong>
                <small>{policeDistanceKm.toFixed(2)} km away</small>
              </div>
              <ChevronRight size={16} />
            </button>

            <button
              type="button"
              className="hs-support-card helpline"
              onMouseDown={handleHelplineLongPress}
              onMouseUp={clearHelplineLongPress}
              onMouseLeave={clearHelplineLongPress}
              onTouchStart={handleHelplineLongPress}
              onTouchEnd={clearHelplineLongPress}
              onTouchCancel={clearHelplineLongPress}
              onClick={() => {
                clearHelplineLongPress();
                setShowHelpline(true);
              }}
            >
              <Phone size={20} />
              <div className="hs-support-copy">
                <strong>Helpline</strong>
                <small>Tap for contacts, hold to call 112</small>
              </div>
              <ChevronRight size={16} />
            </button>

            <button
              type="button"
              className="hs-support-card hospital"
              onClick={() => navigate("/map")}
            >
              <Heart size={20} />
              <div className="hs-support-copy">
                <strong>Nearby Hospital</strong>
                <small>View hospitals on full safety map</small>
              </div>
              <ChevronRight size={16} />
            </button>
          </div>
        </section>
      )}

      {showHelpline && <HelplineModal user={user} onClose={() => setShowHelpline(false)} />}
      {showSOS && (
        <SOSCountdown
          user={user}
          coords={coords}
          onComplete={handleSOSComplete}
          onCancel={() => setShowSOS(false)}
        />
      )}
      {showChat && <ChatPanel onClose={() => setShowChat(false)} />}
    </div>
  );
}
