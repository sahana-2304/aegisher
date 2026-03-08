// services/api.js
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

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