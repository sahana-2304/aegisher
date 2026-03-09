"""
AegisHer Risk Engine
Supports a trained ML artifact with heuristic fallback.
"""
from __future__ import annotations

import math
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import joblib
import numpy as np


DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "risk_model.pkl"


class RiskEngine:
    """
    Predicts location-based safety risk using a trained model when available.
    Falls back to heuristic scoring if model is missing/unloadable.
    """

    def __init__(self, model_path: Optional[str] = None):
        resolved_path = Path(model_path or os.getenv("RISK_MODEL_PATH") or str(DEFAULT_MODEL_PATH))
        if not resolved_path.is_absolute():
            resolved_path = Path(__file__).resolve().parents[1] / resolved_path
        self.model_path = str(resolved_path)
        self.model = None
        self.feature_columns = [
            "latitude",
            "longitude",
            "hour",
            "day_type_flag",
            "lighting_score",
            "crowd_density",
            "crime_density",
            "police_distance_km",
            "cctv_presence",
            "past_incident_count",
        ]
        self.feature_medians: dict[str, float] = {}
        self.model_source = "heuristic"
        self._load_model(self.model_path)

    def _load_model(self, path: str):
        try:
            artifact = joblib.load(path)
            if isinstance(artifact, dict) and "model" in artifact:
                self.model = artifact["model"]
                self.feature_columns = artifact.get("feature_columns", self.feature_columns)
                self.feature_medians = artifact.get("feature_medians", {})
                self.model_source = "artifact"
                return

            # Backward compatibility if joblib stores model directly.
            self.model = artifact
            self.model_source = "artifact"
        except Exception as e:
            self.model = None
            self.model_source = f"heuristic ({e})"

    def reload_model(self, path: Optional[str] = None):
        if path:
            self.model_path = path
        self._load_model(self.model_path)

    def is_model_loaded(self) -> bool:
        return self.model is not None

    @staticmethod
    def _clip(value: float, low: float, high: float) -> float:
        return max(low, min(high, value))

    def _build_feature_map(self, lat: float, lng: float, context: Optional[dict[str, Any]] = None) -> dict[str, float]:
        context = context or {}
        now = datetime.utcnow()

        hour = int(context.get("hour", now.hour))
        hour = int(self._clip(hour, 0, 23))

        day_type_raw = str(context.get("day_type", "")).strip().lower()
        if day_type_raw in {"weekday", "weekend"}:
            day_type_flag = 1 if day_type_raw == "weekend" else 0
        else:
            day_type_flag = 1 if now.weekday() >= 5 else 0

        lighting_score = float(context.get("lighting_score", 0.9 if 6 <= hour <= 20 else 0.3))
        lighting_score = self._clip(lighting_score, 0.0, 1.0)

        crowd_density = float(context.get("crowd_density", 0.7 if 7 <= hour <= 22 else 0.2))
        crowd_density = self._clip(crowd_density, 0.0, 1.0)

        seed = int(abs(lat * 1000 + lng * 100)) % 100
        crime_density = float(context.get("crime_density_norm", context.get("crime_density", (seed % 40) / 100.0)))
        if crime_density > 1.0:
            crime_density = crime_density / 100.0
        crime_density = self._clip(crime_density, 0.0, 1.0)

        default_police_distance = min(5.0, math.sqrt((lat - 13.05) ** 2 + (lng - 80.21) ** 2) * 100)
        police_distance_km = float(context.get("police_distance_km", default_police_distance))
        police_distance_km = self._clip(police_distance_km, 0.0, 20.0)

        cctv_presence = int(context.get("cctv_presence", 1 if crime_density < 0.3 else 0))
        cctv_presence = int(self._clip(cctv_presence, 0, 1))

        past_incident_count = int(context.get("past_incident_count", int(crime_density * 10)))
        past_incident_count = int(self._clip(past_incident_count, 0, 50))

        return {
            "latitude": float(lat),
            "longitude": float(lng),
            "hour": float(hour),
            "day_type_flag": float(day_type_flag),
            "lighting_score": float(lighting_score),
            "crowd_density": float(crowd_density),
            "crime_density": float(crime_density),
            "police_distance_km": float(police_distance_km),
            "cctv_presence": float(cctv_presence),
            "past_incident_count": float(past_incident_count),
        }

    def _predict_with_model(self, feature_map: dict[str, float]) -> tuple[float, dict[str, float]]:
        row = []
        for col in self.feature_columns:
            val = feature_map.get(col)
            if val is None:
                val = self.feature_medians.get(col, 0.0)
            row.append(float(val))
        # Preserve feature names for sklearn models trained on DataFrames.
        import pandas as pd
        features = pd.DataFrame([row], columns=self.feature_columns)

        if hasattr(self.model, "predict_proba"):
            proba = float(self.model.predict_proba(features)[0][1])
        else:
            pred = self.model.predict(features)[0]
            proba = float(pred)

        importances = getattr(self.model, "feature_importances_", None)
        if importances is not None and len(importances) == len(self.feature_columns):
            contrib = {
                name: round(float(importances[i]) * float(row[i]), 4)
                for i, name in enumerate(self.feature_columns)
            }
        else:
            contrib = {
                "crime_density": round(feature_map["crime_density"], 4),
                "lighting_score": round(1 - feature_map["lighting_score"], 4),
                "crowd_density": round(1 - feature_map["crowd_density"], 4),
                "police_distance_km": round(min(feature_map["police_distance_km"] / 5.0, 1.0), 4),
                "cctv_presence": round(1 - feature_map["cctv_presence"], 4),
                "past_incident_count": round(min(feature_map["past_incident_count"] / 10.0, 1.0), 4),
            }

        return float(self._clip(proba, 0.0, 1.0)), contrib

    def _predict_heuristic(self, feature_map: dict[str, float]) -> tuple[float, dict[str, float]]:
        proba = float(np.clip(
            0.3 * feature_map["crime_density"] +
            0.2 * (1 - feature_map["lighting_score"]) +
            0.15 * (1 - feature_map["crowd_density"]) +
            0.15 * min(feature_map["police_distance_km"] / 5, 1) +
            0.1 * (1 - feature_map["cctv_presence"]) +
            0.1 * min(feature_map["past_incident_count"] / 10, 1),
            0,
            1,
        ))
        shap_dict = {
            "crime_density": round(0.3 * feature_map["crime_density"], 4),
            "lighting_score": round(0.2 * (1 - feature_map["lighting_score"]), 4),
            "crowd_density": round(0.15 * (1 - feature_map["crowd_density"]), 4),
            "police_distance_km": round(0.15 * min(feature_map["police_distance_km"] / 5, 1), 4),
            "cctv_presence": round(0.1 * (1 - feature_map["cctv_presence"]), 4),
            "past_incident_count": round(0.1 * min(feature_map["past_incident_count"] / 10, 1), 4),
        }
        return proba, shap_dict

    def predict(self, lat: float, lng: float, context: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        """
        Returns risk_score (0-1) and explanation dict.
        """
        feature_map = self._build_feature_map(lat, lng, context=context)

        if self.model is not None:
            try:
                proba, shap_dict = self._predict_with_model(feature_map)
                return {
                    "risk_score": round(proba, 4),
                    "shap_values": shap_dict,
                    "model_source": self.model_source,
                }
            except Exception:
                # If model inference fails unexpectedly, fallback safely.
                pass

        proba, shap_dict = self._predict_heuristic(feature_map)
        return {
            "risk_score": round(proba, 4),
            "shap_values": shap_dict,
            "model_source": "heuristic",
        }

    def predict_from_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        lat = float(payload["latitude"])
        lng = float(payload["longitude"])
        return self.predict(lat, lng, context=payload)

    def generate_heatmap_grid(self, center_lat: float, center_lng: float, radius_km: float) -> list[dict[str, float]]:
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
