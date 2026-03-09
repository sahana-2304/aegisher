import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";

const INITIAL_TEST_INPUT = {
  latitude: "13.0827",
  longitude: "80.2707",
  hour: "",
  day_type: "",
  lighting_score: "",
  crowd_density: "",
  crime_density_norm: "",
  police_distance_km: "",
  cctv_presence: "",
  past_incident_count: "",
};

function toPayload(values) {
  const payload = {};
  Object.entries(values).forEach(([key, raw]) => {
    const value = String(raw ?? "").trim();
    if (!value) return;

    if (key === "day_type") {
      payload[key] = value.toLowerCase();
      return;
    }

    if (key === "cctv_presence" || key === "past_incident_count" || key === "hour") {
      payload[key] = Number.parseInt(value, 10);
      return;
    }

    payload[key] = Number.parseFloat(value);
  });
  return payload;
}

function formatProb(value) {
  const n = Number(value ?? 0);
  return `${(n * 100).toFixed(2)}%`;
}

export default function ModelTestingScreen() {
  const [status, setStatus] = useState(null);
  const [trainResult, setTrainResult] = useState(null);
  const [testInput, setTestInput] = useState(INITIAL_TEST_INPUT);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState("");
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [training, setTraining] = useState(false);
  const [testing, setTesting] = useState(false);

  const isDev = import.meta.env.DEV;

  async function refreshStatus() {
    setLoadingStatus(true);
    setError("");
    try {
      const data = await api.riskModelStatus();
      setStatus(data);
    } catch (e) {
      setError(e.message || "Unable to fetch model status.");
    } finally {
      setLoadingStatus(false);
    }
  }

  async function trainModel() {
    setTraining(true);
    setError("");
    try {
      const data = await api.trainRiskModel();
      setTrainResult(data);
      await refreshStatus();
    } catch (e) {
      setError(e.message || "Unable to train model.");
    } finally {
      setTraining(false);
    }
  }

  async function testModel() {
    setTesting(true);
    setError("");
    try {
      const payload = toPayload(testInput);
      const data = await api.testRiskModel(payload);
      setTestResult(data);
    } catch (e) {
      setError(e.message || "Unable to test model.");
    } finally {
      setTesting(false);
    }
  }

  async function useCurrentLocation() {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setTestInput((prev) => ({
          ...prev,
          latitude: String(pos.coords.latitude),
          longitude: String(pos.coords.longitude),
        }));
      },
      (err) => {
        setError(err?.message || "Unable to get current location.");
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
      }
    );
  }

  useEffect(() => {
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const testFields = useMemo(
    () => [
      { id: "latitude", label: "Latitude", placeholder: "13.0827" },
      { id: "longitude", label: "Longitude", placeholder: "80.2707" },
      { id: "hour", label: "Hour (0-23)", placeholder: "22" },
      { id: "day_type", label: "Day Type", placeholder: "weekday / weekend" },
      { id: "lighting_score", label: "Lighting (0-1)", placeholder: "0.4" },
      { id: "crowd_density", label: "Crowd (0-1)", placeholder: "0.3" },
      { id: "crime_density_norm", label: "Crime (0-1 or 0-100)", placeholder: "0.45" },
      { id: "police_distance_km", label: "Police Distance (km)", placeholder: "1.6" },
      { id: "cctv_presence", label: "CCTV (0/1)", placeholder: "1" },
      { id: "past_incident_count", label: "Past Incidents", placeholder: "4" },
    ],
    []
  );

  if (!isDev) {
    return (
      <div className="community-screen">
        <div className="community-header">
          <h2>ML TESTING</h2>
          <p>Unavailable in production.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ml-test-screen">
      <div className="community-header">
        <h2>ML TESTING</h2>
        <p>Development only: train and test the local risk model</p>
      </div>

      <div className="ml-card">
        <div className="ml-card-header">
          <h3>Model Status</h3>
          <button className="ml-btn" onClick={refreshStatus} disabled={loadingStatus}>
            {loadingStatus ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {status ? (
          <div className="ml-kv">
            <div><span>Loaded</span><strong>{status.model_loaded ? "Yes" : "No"}</strong></div>
            <div><span>Source</span><strong>{status.model_source}</strong></div>
            <div><span>Path</span><strong>{status.model_path}</strong></div>
          </div>
        ) : (
          <p className="ml-muted">No status available.</p>
        )}
      </div>

      <div className="ml-card">
        <div className="ml-card-header">
          <h3>Train Model</h3>
          <button className="ml-btn primary" onClick={trainModel} disabled={training}>
            {training ? "Training..." : "Train from Dataset"}
          </button>
        </div>
        <p className="ml-muted">Dataset: `backend/data/tamil_nadu_women_safety_dataset.csv`</p>
        {trainResult?.metrics && (
          <div className="ml-kv">
            <div><span>Accuracy</span><strong>{trainResult.metrics.accuracy}</strong></div>
            <div><span>Precision</span><strong>{trainResult.metrics.precision}</strong></div>
            <div><span>Recall</span><strong>{trainResult.metrics.recall}</strong></div>
            <div><span>F1</span><strong>{trainResult.metrics.f1}</strong></div>
            <div><span>ROC AUC</span><strong>{trainResult.metrics.roc_auc}</strong></div>
            <div><span>Samples Used</span><strong>{trainResult.samples_used}</strong></div>
          </div>
        )}
      </div>

      <div className="ml-card">
        <div className="ml-card-header">
          <h3>Test Prediction</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="ml-btn" onClick={useCurrentLocation}>Use Current Location</button>
            <button className="ml-btn primary" onClick={testModel} disabled={testing}>
              {testing ? "Testing..." : "Run Test"}
            </button>
          </div>
        </div>

        <div className="ml-grid">
          {testFields.map((field) => (
            <label key={field.id} className="ml-field">
              <span>{field.label}</span>
              <input
                value={testInput[field.id]}
                placeholder={field.placeholder}
                onChange={(e) => setTestInput((prev) => ({ ...prev, [field.id]: e.target.value }))}
              />
            </label>
          ))}
        </div>

        {testResult && (
          <div className="ml-result">
            <div className="ml-kv">
              <div><span>Model Loaded</span><strong>{testResult.model_loaded ? "Yes" : "No"}</strong></div>
              <div><span>Model Source</span><strong>{testResult.model_source}</strong></div>
              <div><span>Predicted Label</span><strong>{testResult.predicted_label}</strong></div>
              <div><span>Risk Probability</span><strong>{formatProb(testResult.predicted_risk_probability)}</strong></div>
            </div>
            <pre className="ml-json">
              {JSON.stringify(testResult.contributing_factors, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {error && <p className="ml-error">{error}</p>}
      <div style={{ height: 20 }} />
    </div>
  );
}
