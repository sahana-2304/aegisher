"""
Safe Routing Router
Integrates OpenRouteService + AI risk scoring to find safest route
"""
from fastapi import APIRouter, HTTPException
from models.schemas import RouteRequest, RouteResponse, RouteSegment, RouteFeedback
from services.routing_engine import RoutingEngine
from services.firebase import get_firestore
from datetime import datetime
import uuid

router = APIRouter()
routing_engine = RoutingEngine()


@router.post("/safe", response_model=RouteResponse)
async def get_safe_route(req: RouteRequest):
    """
    Computes the safest route (not just shortest).
    Evaluates multiple route candidates and selects by risk-weighted score.
    route_score = 0.4 * normalized_distance + 0.6 * avg_risk_score
    """
    try:
        result = await routing_engine.compute_safe_route(
            origin=req.origin,
            destination=req.destination,
            mode=req.transport_mode,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/feedback")
async def submit_route_feedback(feedback: RouteFeedback):
    """Stores route feedback to improve future recommendations."""
    db = get_firestore()
    doc = {
        **feedback.dict(),
        "feedback_id": str(uuid.uuid4()),
        "submitted_at": datetime.utcnow().isoformat(),
    }
    db.collection("RouteFeedback").add(doc)
    return {"status": "received", "message": "Thank you for improving safety for everyone!"}