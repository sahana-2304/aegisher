import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";

function formatDistance(distanceM) {
  return `${(distanceM / 1000).toFixed(2)} km`;
}

function formatDuration(durationS) {
  const mins = Math.round(durationS / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function toPreviewPlace(place) {
  if (!place) return null;
  return {
    lat: Number(place.latitude),
    lng: Number(place.longitude),
    label: place.display_name,
  };
}

export default function RoutePanel({
  origin,
  onRoutesUpdate,
  onEnableMapPick,
  mapPickEnabled = false,
  pickedDestination = null,
  onDestinationPreview,
}) {
  const [dest, setDest] = useState("");
  const [transport, setTransport] = useState("walking");
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState(null);

  const searchSeqRef = useRef(0);

  useEffect(() => {
    if (!pickedDestination) return;

    const mapped = {
      latitude: Number(pickedDestination.lat),
      longitude: Number(pickedDestination.lng),
      display_name:
        pickedDestination.label ||
        `${Number(pickedDestination.lat).toFixed(5)}, ${Number(pickedDestination.lng).toFixed(5)}`,
      distance_km: null,
    };

    setSelectedPlace(mapped);
    setDest(mapped.display_name);
    setSuggestions([]);
    setShowSuggestions(false);
  }, [pickedDestination]);

  useEffect(() => {
    const query = dest.trim();
    if (!query || query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      setSearching(false);
      return undefined;
    }

    if (selectedPlace?.display_name === query) {
      setSuggestions([]);
      setShowSuggestions(false);
      setSearching(false);
      return undefined;
    }

    const seq = searchSeqRef.current + 1;
    searchSeqRef.current = seq;

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await api.searchPlaces(query, {
          proximity: { lat: origin?.lat, lng: origin?.lng },
          limit: 6,
          minChars: 2,
        });

        if (searchSeqRef.current !== seq) return;
        setSuggestions(results);
        setShowSuggestions(true);
      } catch {
        if (searchSeqRef.current !== seq) return;
        setSuggestions([]);
        setShowSuggestions(true);
      } finally {
        if (searchSeqRef.current === seq) {
          setSearching(false);
        }
      }
    }, 260);

    return () => clearTimeout(timer);
  }, [dest, origin?.lat, origin?.lng, selectedPlace]);

  function handleDestinationInput(value) {
    setDest(value);
    setSelectedPlace(null);
  }

  function chooseSuggestion(place) {
    setSelectedPlace(place);
    setDest(place.display_name);
    setShowSuggestions(false);
    setSuggestions([]);
    onDestinationPreview?.(toPreviewPlace(place));
  }

  async function findRoute() {
    setError("");
    if (!dest.trim()) {
      setError("Enter a destination");
      return;
    }
    if (!origin?.lat || !origin?.lng) {
      setError("Current location is not available");
      return;
    }

    setLoading(true);
    try {
      const geocoded = selectedPlace || (await api.geocodeAddress(dest, {
        proximity: { lat: origin.lat, lng: origin.lng },
        limit: 6,
      }));

      if (!selectedPlace) {
        setSelectedPlace(geocoded);
        setDest(geocoded.display_name);
      }

      const originCoord = { latitude: origin.lat, longitude: origin.lng };
      const destinationCoord = { latitude: geocoded.latitude, longitude: geocoded.longitude };

      const [shortest, safest] = await Promise.all([
        api.shortestRoute(originCoord, destinationCoord, transport),
        api.safeRoute(originCoord, destinationCoord, transport),
      ]);

      const next = {
        destinationLabel: geocoded.display_name,
        destinationDistanceKm: geocoded.distance_km,
        shortestDistance: shortest.distance_m,
        shortestDuration: shortest.duration_s,
        safeDistance: safest.total_distance_m,
        safeDuration: safest.estimated_duration_s,
        safetyScore: safest.overall_safety_score,
        avoidedZones: safest.avoided_high_risk_zones,
      };
      setRoute(next);

      onRoutesUpdate?.({
        destination: {
          lat: geocoded.latitude,
          lng: geocoded.longitude,
          label: geocoded.display_name,
        },
        shortest: shortest.geometry?.coordinates || [],
        safest: safest.geometry?.coordinates || [],
        stats: next,
      });
    } catch (e) {
      setError(e.message || "Unable to compute route");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="route-panel" style={{ margin: "12px 16px 0" }}>
      <div className="route-panel-header">
        <span>?</span>
        <h3>ROUTE PLANNER</h3>
      </div>
      <div className="route-input-wrap">
        <div className="route-input">
          <div className="route-dot origin" />
          <input value={`Current: ${origin?.lat?.toFixed?.(4) || "--"}, ${origin?.lng?.toFixed?.(4) || "--"}`} disabled style={{ color: "var(--text-muted)" }} />
        </div>
        <div className="route-input route-input-destination">
          <div className="route-dot dest" />
          <input
            placeholder="Search destination (address/place)..."
            value={dest}
            onChange={(e) => handleDestinationInput(e.target.value)}
            onFocus={() => setShowSuggestions(suggestions.length > 0)}
            onBlur={() => {
              setTimeout(() => setShowSuggestions(false), 150);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                findRoute();
              }
            }}
          />
        </div>

        {(showSuggestions || searching) && (
          <div className="route-suggest-box">
            {searching && <div className="route-suggest-state">Searching places...</div>}
            {!searching && suggestions.length === 0 && (
              <div className="route-suggest-state">No matching places found.</div>
            )}
            {!searching && suggestions.map((item) => (
              <button
                key={`${item.latitude}-${item.longitude}-${item.display_name}`}
                className="route-suggest-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => chooseSuggestion(item)}
              >
                <span className="route-suggest-title">{item.display_name}</span>
                {item.distance_km != null && (
                  <span className="route-suggest-sub">{item.distance_km.toFixed(1)} km from you</span>
                )}
              </button>
            ))}
          </div>
        )}

        <button
          className={`route-map-pick-btn ${mapPickEnabled ? "active" : ""}`}
          onClick={() => onEnableMapPick?.()}
          type="button"
        >
          {mapPickEnabled ? "Tap map once to set destination" : "Pick destination from map"}
        </button>

        <div className="transport-opts">
          {[
            { id: "walking", icon: "?", label: "Walk" },
            { id: "driving", icon: "?", label: "Drive" },
            { id: "cycling", icon: "?", label: "Cycle" },
          ].map((t) => (
            <button key={t.id} className={`transport-btn ${transport === t.id ? "selected" : ""}`}
              onClick={() => setTransport(t.id)}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        <button className="find-route-btn" onClick={findRoute} disabled={loading}>
          {loading ? "COMPUTING..." : "SHOW SHORTEST + SAFEST"}
        </button>

        {error && (
          <p style={{ fontSize: "0.78rem", color: "var(--accent-coral)" }}>{error}</p>
        )}
      </div>

      {route && (
        <>
          <div className="route-result" style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10 }}>
            <div className="route-stat">
              <div className="route-stat-value">{formatDistance(route.shortestDistance)}</div>
              <div className="route-stat-label">Shortest</div>
              <div className="route-stat-label">{formatDuration(route.shortestDuration)}</div>
            </div>
            <div className="route-stat">
              <div className="route-stat-value" style={{ color: "var(--accent-teal)" }}>{formatDistance(route.safeDistance)}</div>
              <div className="route-stat-label">Safest</div>
              <div className="route-stat-label">{formatDuration(route.safeDuration)}</div>
            </div>
          </div>
          <div className="route-safety-bar">
            <div className="route-safety-label">
              <span className="rsb-text">Safety Score</span>
              <span className="rsb-val">{route.safetyScore}/100</span>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${route.safetyScore}%` }} />
            </div>
            <div style={{ marginTop: 8, fontSize: "0.72rem", color: "var(--text-secondary)" }}>
              Avoided high risk zones: {route.avoidedZones}
            </div>
            <div style={{ marginTop: 6, fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
              Destination: {route.destinationLabel}
            </div>
            {route.destinationDistanceKm != null && (
              <div style={{ marginTop: 4, fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
                Destination match is approximately {route.destinationDistanceKm.toFixed(1)} km from your current location.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
