"""
Risk Prediction Router
Combines ML prediction + community intelligence, and exposes dev-only model tooling.
"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException

from models.schemas import (
    LocationRequest,
    ModelStatusResponse,
    ModelTestRequest,
    ModelTestResponse,
    ModelTrainResponse,
    RiskResponse,
)
from services.community_intel import CommunityIntelService
from services.risk_engine import RiskEngine
from services.risk_model_trainer import train_risk_model

router = APIRouter()
risk_engine = RiskEngine()
community_svc = CommunityIntelService()

BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DATASET_PATH = BASE_DIR / "data" / "tamil_nadu_women_safety_dataset.csv"
DEFAULT_MODEL_PATH = Path(os.getenv("RISK_MODEL_PATH", str(BASE_DIR / "models" / "risk_model.pkl")))
if not DEFAULT_MODEL_PATH.is_absolute():
    DEFAULT_MODEL_PATH = BASE_DIR / DEFAULT_MODEL_PATH


def _ensure_dev_mode():
    app_env = os.getenv("APP_ENV", os.getenv("ENV", "development")).lower()
    if app_env in {"production", "prod"}:
        raise HTTPException(status_code=404, detail="Not found")


@router.post("/predict", response_model=RiskResponse)
async def predict_risk(req: LocationRequest):
    """
    Hybrid risk prediction endpoint.
    Formula: final_score = 0.7 * ai_score + 0.3 * community_score
    """
    try:
        ai_result = risk_engine.predict(req.latitude, req.longitude)
        community_score = await community_svc.get_area_score(req.latitude, req.longitude)

        hybrid_raw = 0.7 * ai_result["risk_score"] + 0.3 * community_score
        final_score = round(hybrid_raw * 100, 1)

        if final_score < 35:
            zone, label = "LOW", "Generally Safe"
        elif final_score < 65:
            zone, label = "MEDIUM", "Exercise Caution"
        else:
            zone, label = "HIGH", "Avoid if Possible"

        return RiskResponse(
            risk_score=final_score,
            risk_zone=zone,
            ai_score=ai_result["risk_score"],
            community_score=community_score,
            contributing_factors=ai_result["shap_values"],
            label=label,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/heatmap")
async def get_heatmap(lat: float, lng: float, radius_km: float = 2.0):
    """
    Returns grid of risk scores for heatmap rendering.
    """
    try:
        grid = risk_engine.generate_heatmap_grid(lat, lng, radius_km)
        return {"grid": grid, "center": {"lat": lat, "lng": lng}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/model/status", response_model=ModelStatusResponse)
async def model_status():
    _ensure_dev_mode()
    return ModelStatusResponse(
        model_loaded=risk_engine.is_model_loaded(),
        model_source=risk_engine.model_source,
        model_path=risk_engine.model_path,
        feature_columns=risk_engine.feature_columns,
    )


@router.post("/model/train", response_model=ModelTrainResponse)
async def train_model():
    _ensure_dev_mode()
    try:
        result = train_risk_model(DEFAULT_DATASET_PATH, DEFAULT_MODEL_PATH)
        risk_engine.reload_model(result["model_path"])
        return ModelTrainResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/model/test", response_model=ModelTestResponse)
async def test_model(req: ModelTestRequest):
    _ensure_dev_mode()
    try:
        payload = req.model_dump(exclude_none=True)
        prediction = risk_engine.predict_from_payload(payload)
        probability = float(prediction["risk_score"])

        if probability < 0.35:
            label = "LOW"
        elif probability < 0.65:
            label = "MEDIUM"
        else:
            label = "HIGH"

        return ModelTestResponse(
            model_loaded=risk_engine.is_model_loaded(),
            model_source=prediction.get("model_source", risk_engine.model_source),
            predicted_risk_probability=round(probability, 4),
            predicted_label=label,
            contributing_factors=prediction["shap_values"],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
