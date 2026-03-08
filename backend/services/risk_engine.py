"""
AegisHer Risk Engine
XGBoost-based risk prediction with SHAP explainability
"""
import numpy as np
from typing import Optional
import math

# In production: import xgboost as xgb, import shap

class RiskEngine:
    """
    Predicts location-based safety risk using XGBoost.
    Falls back to heuristic scoring when model not loaded.

    Feature vector:
      [latitude, longitude, hour_of_day, lighting_score, crowd_density,
       crime_density, distance_to_police_km, cctv_presence, past_incident_count]
    """

    def __init__(self, model_path: Optional[str] = None):
        self.model = None
        self.explainer = None
        self.feature_names = [
            "latitude", "longitude", "hour_of_day", "lighting_score",
            "crowd_density", "crime_density", "distance_to_police_km",
            "cctv_presence", "past_incident_count"
        ]
        if model_path:
            self._load_model(model_path)

    def _load_model(self, path: str):
        try:
            import xgboost as xgb
            import shap
            self.model = xgb.XGBClassifier()
            self.model.load_model(path)
            self.explainer = shap.TreeExplainer(self.model)
        except Exception as e:
            print(f"[RiskEngine] Could not load model: {e}. Using heuristic fallback.")

    def _build_features(self, lat: float, lng: float) -> np.ndarray:
        """Build feature vector from coordinates + contextual signals."""
        from datetime import datetime
        hour = datetime.utcnow().hour

        # Heuristic feature estimation (production: pull from real-time data APIs)
        lighting_score = 0.9 if 6 <= hour <= 20 else 0.3
        crowd_density = 0.7 if 7 <= hour <= 22 else 0.2
        # Simulate crime density from coordinate hash (stable mock)
        seed = int(abs(lat * 1000 + lng * 100)) % 100
        crime_density = (seed % 40) / 100.0
        dist_police = min(5.0, math.sqrt((lat - 13.05)**2 + (lng - 80.21)**2) * 100)
        cctv = 1.0 if crime_density < 0.3 else 0.4
        incidents = int(crime_density * 10)

        return np.array([[lat, lng, hour, lighting_score, crowd_density,
                          crime_density, dist_police, cctv, incidents]])

    def predict(self, lat: float, lng: float) -> dict:
        """
        Returns risk_score (0–1) and SHAP-based explanation.
        """
        features = self._build_features(lat, lng)

        if self.model:
            # Production path: XGBoost + SHAP
            proba = self.model.predict_proba(features)[0][1]
            shap_vals = self.explainer.shap_values(features)[0]
            shap_dict = {name: round(float(val), 4) for name, val in zip(self.feature_names, shap_vals)}
        else:
            # Heuristic fallback
            f = features[0]
            proba = float(np.clip(
                0.3 * f[5] +          # crime_density (strong signal)
                0.2 * (1 - f[3]) +    # low lighting
                0.15 * (1 - f[4]) +   # low crowd
                0.15 * min(f[6]/5, 1) +  # distance to police
                0.1 * (1 - f[7]) +    # no CCTV
                0.1 * f[8] / 10,      # past incidents
                0, 1
            ))
            shap_dict = {
                "crime_density": round(0.3 * f[5], 4),
                "lighting_score": round(0.2 * (1 - f[3]), 4),
                "crowd_density": round(0.15 * (1 - f[4]), 4),
                "distance_to_police_km": round(0.15 * min(f[6]/5, 1), 4),
                "cctv_presence": round(0.1 * (1 - f[7]), 4),
                "past_incident_count": round(0.1 * f[8] / 10, 4),
            }

        return {"risk_score": round(proba, 4), "shap_values": shap_dict}

    def generate_heatmap_grid(self, center_lat: float, center_lng: float, radius_km: float) -> list:
        """Generate a grid of risk scores for heatmap visualization."""
        step = radius_km / 10
        lat_step = step / 111.0
        lng_step = step / (111.0 * math.cos(math.radians(center_lat)))

        grid = []
        for i in range(-10, 11):
            for j in range(-10, 11):
                lat = center_lat + i * lat_step
                lng = center_lng + j * lng_step
                result = self.predict(lat, lng)
                grid.append({
                    "lat": round(lat, 6),
                    "lng": round(lng, 6),
                    "risk": result["risk_score"],
                })
        return grid