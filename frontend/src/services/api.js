// services/api.js
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const OSRM_BASE = "https://router.project-osrm.org/route/v1";

const OSRM_MODE = {
  walking: "walking",
  driving: "driving",
  cycling: "cycling",
};

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function toRankedPlaces(items, options = {}) {
  return (Array.isArray(items) ? items : [])
    .map((item, idx) => {
      const latitude = Number(item.lat);
      const longitude = Number(item.lon);
      if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;

      let distanceKm = null;
      if (options?.proximity?.lat != null && options?.proximity?.lng != null) {
        distanceKm = haversineKm(
          Number(options.proximity.lat),
          Number(options.proximity.lng),
          latitude,
          longitude
        );
      }

      const baseRank = idx * 1.5;
      const distancePenalty = distanceKm == null ? 0 : Math.min(distanceKm / 30, 8);
      const importanceBoost = -Number(item.importance || 0) * 2;

      return {
        latitude,
        longitude,
        display_name: item.display_name,
        importance: Number(item.importance || 0),
        distance_km: distanceKm,
        _score: baseRank + distancePenalty + importanceBoost,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a._score - b._score)
    .map(({ _score, ...rest }) => rest);
}

async function request(path, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export const api = {
  // Risk prediction
  predictRisk: (lat, lng) =>
    request("/api/risk/predict", {
      method: "POST",
      body: JSON.stringify({ latitude: lat, longitude: lng, timestamp: new Date().toISOString() }),
    }),

  // Safe route
  safeRoute: (origin, destination, mode) =>
    request("/api/routes/safe", {
      method: "POST",
      body: JSON.stringify({ origin, destination, transport_mode: mode }),
    }),

  searchPlaces: async (query, options = {}) => {
    const q = (query || "").trim();
    if (!q) return [];
    const minChars = Number(options.minChars ?? 2);
    if (q.length < minChars) return [];

    const limit = Math.max(1, Math.min(Number(options.limit || 6), 12));
    const params = new URLSearchParams({
      format: "json",
      limit: String(limit),
      addressdetails: "1",
      dedupe: "1",
      q,
    });

    if (options?.proximity?.lat != null && options?.proximity?.lng != null) {
      params.set("lat", String(options.proximity.lat));
      params.set("lon", String(options.proximity.lng));
    }

    const url = `${NOMINATIM_BASE}/search?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        "Accept-Language": "en",
      },
    });
    if (!res.ok) throw new Error("Failed to geocode destination");

    const data = await res.json();
    return toRankedPlaces(data, options);
  },

  geocodeAddress: async (query, options = {}) => {
    const candidates = await api.searchPlaces(query, {
      ...options,
      minChars: 1,
    });
    if (!candidates.length) throw new Error("Destination not found");

    const best = candidates[0];

    return {
      latitude: best.latitude,
      longitude: best.longitude,
      display_name: best.display_name,
      distance_km: best.distance_km,
      candidates,
    };
  },

  reverseGeocode: async (lat, lng) => {
    const params = new URLSearchParams({
      format: "json",
      lat: String(lat),
      lon: String(lng),
      zoom: "18",
    });

    const url = `${NOMINATIM_BASE}/reverse?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        "Accept-Language": "en",
      },
    });
    if (!res.ok) throw new Error("Failed to resolve map location");

    const data = await res.json();
    return {
      latitude: Number(lat),
      longitude: Number(lng),
      display_name: data?.display_name || `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`,
    };
  },

  shortestRoute: async (origin, destination, mode) => {
    const profile = OSRM_MODE[mode] || "walking";
    const coords = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
    const url = `${OSRM_BASE}/${profile}/${coords}?overview=full&alternatives=false&steps=false&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch shortest route");

    const data = await res.json();
    if (!data?.routes?.length) throw new Error("No shortest route found");

    const route = data.routes[0];
    return {
      distance_m: route.distance,
      duration_s: route.duration,
      geometry: route.geometry,
    };
  },

  // Dev-only model tooling
  riskModelStatus: () => request("/api/risk/model/status"),

  trainRiskModel: () =>
    request("/api/risk/model/train", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  testRiskModel: (payload) =>
    request("/api/risk/model/test", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // SOS
  triggerSOS: (userId, lat, lng, ip) =>
    request("/api/sos/trigger", {
      method: "POST",
      body: JSON.stringify({ user_id: userId, latitude: lat, longitude: lng, device_ip: ip, timestamp: new Date().toISOString() }),
    }),

  // Police
  nearestPolice: (lat, lng) =>
    request(`/api/police/nearest?lat=${lat}&lng=${lng}`),

  // Community
  submitReport: (data) =>
    request("/api/community/report", { method: "POST", body: JSON.stringify(data) }),

  getPosts: () => request("/api/community/posts"),

  // Route feedback
  submitFeedback: (data) =>
    request("/api/routes/feedback", { method: "POST", body: JSON.stringify(data) }),

  // Chat
  chatMessage: (message, sessionId) =>
    request("/api/chat/message", {
      method: "POST",
      body: JSON.stringify({ message, session_id: sessionId }),
    }),
};
