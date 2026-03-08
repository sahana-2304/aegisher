"""
Risk Prediction Router
Combines XGBoost ML prediction + community intelligence
"""
from fastapi import APIRouter, HTTPException
from models.schemas import LocationRequest, RiskResponse
from services.risk_engine import RiskEngine
from services.community_intel import CommunityIntelService

router = APIRouter()
risk_engine = RiskEngine()
community_svc = CommunityIntelService()


@router.post("/predict", response_model=RiskResponse)
async def predict_risk(req: LocationRequest):
    """
    Hybrid risk prediction endpoint.
    Formula: final_score = 0.7 * ai_score + 0.3 * community_score
    """
    try:
        # 1. Get AI model prediction
        ai_result = risk_engine.predict(req.latitude, req.longitude)

        # 2. Get community intelligence score
        community_score = await community_svc.get_area_score(req.latitude, req.longitude)

        # 3. Compute hybrid score (0–100)
        hybrid_raw = 0.7 * ai_result["risk_score"] + 0.3 * community_score
        final_score = round(hybrid_raw * 100, 1)

        # 4. Determine zone
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