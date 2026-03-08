"""
Community Safety Intelligence Router
"""
from fastapi import APIRouter, HTTPException
from models.schemas import CommunityReport, CommunityPost
from services.firebase import get_firestore
from services.community_intel import CommunityIntelService
from datetime import datetime
import uuid

router = APIRouter()
community_svc = CommunityIntelService()


@router.post("/report")
async def submit_report(report: CommunityReport):
    """Submit a safety incident report. Updates grid-level community risk score."""
    db = get_firestore()
    doc = {
        **report.dict(),
        "report_id": str(uuid.uuid4()),
        "timestamp": report.timestamp or datetime.utcnow().isoformat(),
        "verified": False,
    }
    db.collection("CommunityReports").add(doc)

    # Trigger async community score update for this grid
    await community_svc.update_grid_score(report.latitude, report.longitude)

    return {"status": "submitted", "message": "Report received. Thank you for keeping the community safe."}


@router.post("/post")
async def create_post(post: CommunityPost):
    """Create a public community safety post."""
    db = get_firestore()
    doc = {
        **post.dict(),
        "post_id": str(uuid.uuid4()),
        "created_at": datetime.utcnow().isoformat(),
        "likes": 0,
        "comments": 0,
    }
    db.collection("CommunityPosts").add(doc)
    return {"status": "posted"}


@router.get("/posts")
async def get_posts(lat: float = None, lng: float = None, limit: int = 20):
    """Fetch recent community posts, optionally filtered by proximity."""
    db = get_firestore()
    query = db.collection("CommunityPosts").order_by("created_at", direction="DESCENDING").limit(limit)
    docs = query.stream()
    return {"posts": [d.to_dict() for d in docs]}


@router.get("/reports")
async def get_area_reports(lat: float, lng: float, radius_km: float = 1.0):
    """Get recent incident reports in an area."""
    reports = await community_svc.get_area_reports(lat, lng, radius_km)
    return {"reports": reports, "count": len(reports)}