import { useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import {
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  Shield,
  X,
} from "lucide-react";

import RoutePanel from "../components/RoutePanel";
import { api } from "../services/api";
import "./MapScreen.css";

const REFRESH_INTERVAL_MS = 20000;
const REFRESH_DISTANCE_M = 100;
const DEFAULT_COORDS = { lat: 13.0827, lng: 80.2707 };

const DEFAULT_HELPLINES = [
  { id: "women-1091", name: "Women Helpline", number: "1091", type: "women" },
  { id: "police-100", name: "Police Emergency", number: "100", type: "police" },
  { id: "emergency-112", name: "Emergency Services", number: "112", type: "emergency" },
];

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

const policeMarkerIcon = L.divIcon({
  className: "ms-service-icon-wrap",
  html: '<div class="ms-service-icon ms-service-police">P</div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const hospitalMarkerIcon = L.divIcon({
  className: "ms-service-icon-wrap",
  html: '<div class="ms-service-icon ms-service-hospital">H</div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function RecenterMap({ coords }) {
  const map = useMap();
  useEffect(() => {
    map.setView([coords.lat, coords.lng], Math.max(map.getZoom(), 14));
  }, [coords, map]);
  return null;
}

function MapDestinationPicker({ enabled, onPick }) {
  useMapEvents({
    click(event) {
      if (!enabled) return;
      onPick?.({ lat: event.latlng.lat, lng: event.latlng.lng });
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

function normalizeNearbyServices(payload) {
  const normalize = (items, type) =>
    (Array.isArray(items) ? items : [])
      .map((item, index) => {
        const latitude = Number(item.latitude);
        const longitude = Number(item.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
        return {
          id: item.id || `${type}-${index}-${latitude}-${longitude}`,
          type,
          name: item.name || (type === "police" ? "Police Station" : "Hospital"),
          address: item.address || "",
          phone: item.phone || "",
          latitude,
          longitude,
          distance_m: Number(item.distance_m || 0),
          source: item.source || "unknown",
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance_m - b.distance_m);

  return {
    police: normalize(payload?.police, "police"),
    hospitals: normalize(payload?.hospitals, "hospital"),
    helplines: Array.isArray(payload?.helplines) && payload.helplines.length
      ? payload.helplines.map((item, index) => ({
          id: item.id || `helpline-${index}`,
          name: item.name || "Helpline",
          number: item.number || "",
          type: item.type || "support",
        }))
      : DEFAULT_HELPLINES,
    meta: payload?.meta || null,
  };
}

function toTelNumber(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}

export default function MapScreen({ user }) {
  const [coords, setCoords] = useState(DEFAULT_COORDS);
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [locationAccuracyM, setLocationAccuracyM] = useState(null);
  const [services, setServices] = useState({
    police: [],
    hospitals: [],
    helplines: DEFAULT_HELPLINES,
    meta: null,
  });
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [routeOverlay, setRouteOverlay] = useState(null);
  const [showRoute, setShowRoute] = useState(false);
  const [mapPickEnabled, setMapPickEnabled] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const watchIdRef = useRef(null);
  const fetchAbortRef = useRef(null);
  const intervalIdRef = useRef(null);
  const currentCoordsRef = useRef(DEFAULT_COORDS);
  const lastFetchAtRef = useRef(0);
  const lastFetchCoordsRef = useRef(null);

  const allServices = useMemo(
    () => [...services.police, ...services.hospitals],
    [services.hospitals, services.police],
  );

  const helplineContacts = useMemo(() => {
    const result = [];
    if (user?.emergency1) {
      result.push({
        id: "user-emergency-1",
        name: "Emergency Contact 1",
        number: user.emergency1,
        type: "personal",
      });
    }
    if (user?.emergency2) {
      result.push({
        id: "user-emergency-2",
        name: "Emergency Contact 2",
        number: user.emergency2,
        type: "personal",
      });
    }

    const seen = new Set(result.map((item) => item.number));
    for (const item of services.helplines) {
      if (!item.number || seen.has(item.number)) continue;
      seen.add(item.number);
      result.push(item);
    }
    return result;
  }, [services.helplines, user?.emergency1, user?.emergency2]);

  const shortestPath = toLatLngPath(routeOverlay?.shortest || []);
  const safestPath = toLatLngPath(routeOverlay?.safest || []);
  const destination = routeOverlay?.destination;
  const accuracyRadiusM =
    locationAccuracyM == null ? null : Math.max(18, Math.min(locationAccuracyM, 250));

  function shouldRefresh(nextCoords, force = false) {
    if (force) return true;
    const elapsedMs = Date.now() - lastFetchAtRef.current;
    if (elapsedMs >= REFRESH_INTERVAL_MS) return true;
    if (!lastFetchCoordsRef.current) return true;
    return distanceMeters(lastFetchCoordsRef.current, nextCoords) >= REFRESH_DISTANCE_M;
  }

  async function refreshNearbyServices(nextCoords, force = false) {
    if (!nextCoords || !shouldRefresh(nextCoords, force)) return;

    lastFetchAtRef.current = Date.now();
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    setIsRefreshing(true);

    try {
      const response = await api.getNearbyServices(nextCoords.lat, nextCoords.lng, {
        radiusM: 3000,
        limit: 10,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      const normalized = normalizeNearbyServices(response);
      setServices(normalized);
      setRefreshError("");
      setLastUpdatedAt(Date.now());
      lastFetchCoordsRef.current = { ...nextCoords };
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") return;
      setRefreshError(error?.message || "Could not refresh nearby services.");
    } finally {
      if (fetchAbortRef.current === controller) {
        fetchAbortRef.current = null;
      }
      setIsRefreshing(false);
    }
  }

  function applyGeolocationPosition(position) {
    const next = {
      lat: Number(position.coords.latitude),
      lng: Number(position.coords.longitude),
    };
    const accuracy = Number(position.coords.accuracy);

    currentCoordsRef.current = next;
    setCoords(next);
    setLocationConfirmed(true);
    setLocationError("");
    setLocationAccuracyM(Number.isFinite(accuracy) ? Math.round(accuracy) : null);
    refreshNearbyServices(next, false);
  }

  function requestCurrentLocation(forceRefresh = true) {
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported in this browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        applyGeolocationPosition(position);
        if (forceRefresh) {
          refreshNearbyServices(
            {
              lat: Number(position.coords.latitude),
              lng: Number(position.coords.longitude),
            },
            true,
          );
        }
      },
      (error) => {
        setLocationError(error?.message || "Unable to fetch current location.");
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );
  }

  useEffect(() => {
    refreshNearbyServices(DEFAULT_COORDS, true);
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported in this browser.");
      return undefined;
    }

    requestCurrentLocation(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => applyGeolocationPosition(position),
      (error) => setLocationError(error?.message || "Live GPS updates unavailable."),
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 5000,
      },
    );

    intervalIdRef.current = window.setInterval(() => {
      refreshNearbyServices(currentCoordsRef.current, false);
    }, REFRESH_INTERVAL_MS);

    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (intervalIdRef.current != null) {
        window.clearInterval(intervalIdRef.current);
      }
      fetchAbortRef.current?.abort();
    };
  }, []);

  function previewDestination(next) {
    if (next?.lat == null || next?.lng == null) return;
    setRouteOverlay((previous) => ({
      ...(previous || {}),
      destination: next,
      shortest: [],
      safest: [],
    }));
  }

  function selectServiceDestination(service) {
    if (!service) return;
    setSelectedServiceId(service.id);
    setMapPickEnabled(false);
    setShowRoute(true);
    previewDestination({
      lat: service.latitude,
      lng: service.longitude,
      label: service.name,
    });
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

  return (
    <div className="ms-screen">
      <div className="ms-topbar">
        <div className="ms-topbar-title">
          <MapPin size={18} />
          <div>
            <strong>Safety Map</strong>
            <small>
              {lastUpdatedAt
                ? `Updated ${new Date(lastUpdatedAt).toLocaleTimeString()}`
                : "Waiting for first sync"}
            </small>
          </div>
        </div>

        <div className="ms-topbar-actions">
          <button
            type="button"
            className="ms-icon-btn"
            onClick={() => refreshNearbyServices(currentCoordsRef.current, true)}
            title="Refresh nearby services"
          >
            <RefreshCw size={16} className={isRefreshing ? "ms-spin" : ""} />
          </button>
          <button
            type="button"
            className="ms-icon-btn"
            onClick={() => requestCurrentLocation(true)}
            title="Use my current GPS location"
          >
            <Navigation size={16} />
          </button>
        </div>
      </div>

      <div className="ms-map-wrap">
        <MapContainer
          center={[coords.lat, coords.lng]}
          zoom={14}
          className="ms-map"
          zoomControl
          attributionControl
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <RecenterMap coords={coords} />
          <MapDestinationPicker enabled={mapPickEnabled} onPick={handleMapDestinationPick} />

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
                fillColor: "#60a5fa",
                fillOpacity: 0.14,
                weight: 1,
              }}
            />
          )}

          {allServices.map((service) => (
            <Marker
              key={service.id}
              position={[service.latitude, service.longitude]}
              icon={service.type === "police" ? policeMarkerIcon : hospitalMarkerIcon}
            >
              <Tooltip direction="top" offset={[0, -10]}>
                {service.name}
              </Tooltip>
              <Popup>
                <div className="ms-popup">
                  <div className={`ms-popup-type ${service.type}`}>{service.type.toUpperCase()}</div>
                  <strong>{service.name}</strong>
                  <p>{service.address || "Address unavailable"}</p>
                  <p>{Math.round(service.distance_m)} m away</p>
                  <div className="ms-popup-actions">
                    {service.phone ? (
                      <a className="ms-popup-btn" href={`tel:${toTelNumber(service.phone)}`}>
                        <Phone size={14} />
                        Call
                      </a>
                    ) : (
                      <span className="ms-popup-btn disabled">
                        <Phone size={14} />
                        No number
                      </span>
                    )}
                    <button
                      type="button"
                      className="ms-popup-btn"
                      onClick={() => selectServiceDestination(service)}
                    >
                      Set as destination
                    </button>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}

          {destination && (
            <Marker position={[destination.lat, destination.lng]} icon={destinationMarkerIcon}>
              <Tooltip direction="top" offset={[0, -8]}>
                Destination
              </Tooltip>
            </Marker>
          )}
          {shortestPath.length > 1 && (
            <Polyline positions={shortestPath} pathOptions={{ color: "#3b82f6", weight: 4, opacity: 0.82 }} />
          )}
          {safestPath.length > 1 && (
            <Polyline positions={safestPath} pathOptions={{ color: "#16a34a", weight: 5, opacity: 0.92 }} />
          )}
        </MapContainer>

        <div className="ms-legend">
          <span className="ms-legend-item">
            <span className="ms-legend-dot police">P</span>
            Police
          </span>
          <span className="ms-legend-item">
            <span className="ms-legend-dot hospital">H</span>
            Hospital
          </span>
          <span className="ms-legend-item">
            <span className="ms-legend-line shortest" />
            Shortest
          </span>
          <span className="ms-legend-item">
            <span className="ms-legend-line safest" />
            Safest
          </span>
          {mapPickEnabled && <span className="ms-legend-item">Tap map to pick destination</span>}
        </div>

        <aside className="ms-helpline-panel">
          <div className="ms-helpline-head">
            <Shield size={16} />
            <span>Helpline Contacts</span>
          </div>
          <div className="ms-helpline-list">
            {helplineContacts.map((contact) => (
              <a
                key={contact.id}
                className="ms-helpline-item"
                href={`tel:${toTelNumber(contact.number)}`}
              >
                <div>
                  <strong>{contact.name}</strong>
                  <small>{contact.number}</small>
                </div>
                <Phone size={14} />
              </a>
            ))}
          </div>
        </aside>
      </div>

      <div className="ms-status-row">
        <div className="ms-status-chip">
          {locationConfirmed
            ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
            : "Location pending"}
        </div>
        <div className="ms-status-chip">
          {services.police.length} police, {services.hospitals.length} hospitals
        </div>
        {refreshError && <div className="ms-status-chip ms-status-error">{refreshError}</div>}
        {locationError && <div className="ms-status-chip ms-status-error">{locationError}</div>}
      </div>

      {showRoute && (
        <div className="ms-route-sheet">
          <div className="ms-route-head">
            <div>
              <strong>Route Planner</strong>
              {selectedServiceId && (
                <small>
                  Selected: {allServices.find((item) => item.id === selectedServiceId)?.name || "Custom destination"}
                </small>
              )}
            </div>
            <button type="button" className="ms-icon-btn" onClick={() => setShowRoute(false)}>
              <X size={16} />
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
        </div>
      )}
    </div>
  );
}
