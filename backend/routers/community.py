"""
Community Safety Intelligence Router
"""
from fastapi import APIRouter, HTTPException, Query
from models.schemas import CommunityReport, CommunityPost
from services.firebase import get_firestore
from services.community_intel import CommunityIntelService
from datetime import datetime, timezone
import uuid

router = APIRouter()
community_svc = CommunityIntelService()


def _parse_iso_to_ms(value: str | None) -> int | None:
    if not value:
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        return int(datetime.fromisoformat(normalized).timestamp() * 1000)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid ISO datetime: {value}")


def _to_ms(value) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    if hasattr(value, "timestamp"):
        try:
            return int(value.timestamp() * 1000)
        except Exception:
            pass
    if isinstance(value, str):
        try:
            normalized = value.replace("Z", "+00:00")
            return int(datetime.fromisoformat(normalized).timestamp() * 1000)
        except Exception:
            return 0
    return 0


def _to_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _extract_model_row(doc_snap):
    data = doc_snap.to_dict() or {}
    model_meta = data.get("model_meta") or {}
    location_meta = data.get("location_meta") or {}
    media = data.get("media") if isinstance(data.get("media"), list) else []

    created_at_ms = _to_ms(data.get("created_at_ms")) or _to_ms(data.get("created_at"))
    image_count = _to_int(
        model_meta.get("image_count"),
        _to_int(data.get("media_count"), len(media) if media else (1 if data.get("image_url") else 0)),
    )

    likes_count = _to_int(data.get("likes_count"))
    comments_count = _to_int(data.get("comments_count"))
    engagement_score = likes_count + (comments_count * 2)

    approx_lat = model_meta.get("approx_lat", location_meta.get("approx_lat"))
    approx_lng = model_meta.get("approx_lng", location_meta.get("approx_lng"))
    location_available = model_meta.get("location_available")
    if location_available is None:
        location_available = (location_meta.get("status") == "available")

    created_iso = ""
    if created_at_ms > 0:
        created_iso = datetime.fromtimestamp(created_at_ms / 1000, tz=timezone.utc).isoformat()

    text = str(data.get("text") or "")
    return {
        "post_id": doc_snap.id,
        "created_at_ms": created_at_ms,
        "created_at_iso": created_iso,
        "category": str(model_meta.get("category") or data.get("tag") or "alert"),
        "text_length": _to_int(model_meta.get("text_length"), len(text)),
        "image_count": image_count,
        "has_image": image_count > 0,
        "local_hour": _to_int(model_meta.get("local_hour"), -1),
        "local_day_of_week": _to_int(model_meta.get("local_day_of_week"), -1),
        "local_is_weekend": bool(model_meta.get("local_is_weekend", False)),
        "approx_lat": approx_lat,
        "approx_lng": approx_lng,
        "location_available": bool(location_available),
        "location_accuracy_bucket": str(
            model_meta.get("location_accuracy_bucket")
            or location_meta.get("accuracy_bucket")
            or "unknown"
        ),
        "likes_count": likes_count,
        "comments_count": comments_count,
        "engagement_score": engagement_score,
    }


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


@router.get("/model/export")
async def export_model_rows(
    start_iso: str | None = Query(default=None, description="Lower bound ISO datetime"),
    end_iso: str | None = Query(default=None, description="Upper bound ISO datetime"),
    limit: int = Query(default=500, ge=1, le=5000, description="Maximum posts to return"),
):
    """Return normalized, non-PII community post rows for model ingestion."""
    start_ms = _parse_iso_to_ms(start_iso)
    end_ms = _parse_iso_to_ms(end_iso)
    if start_ms is not None and end_ms is not None and start_ms > end_ms:
        raise HTTPException(status_code=400, detail="start_iso must be <= end_iso")

    db = get_firestore()
    query = db.collection("CommunityPosts").order_by("created_at_ms", direction="DESCENDING").limit(limit)
    if start_ms is not None:
        query = query.where("created_at_ms", ">=", start_ms)
    if end_ms is not None:
        query = query.where("created_at_ms", "<=", end_ms)

    rows = []
    for doc in query.stream():
        row = _extract_model_row(doc)
        created_ms = row["created_at_ms"]
        if start_ms is not None and created_ms and created_ms < start_ms:
            continue
        if end_ms is not None and created_ms and created_ms > end_ms:
            continue
        rows.append(row)

    rows.sort(key=lambda item: item.get("created_at_ms", 0), reverse=True)
    return {
        "count": len(rows),
        "rows": rows,
        "filters": {
            "start_iso": start_iso,
            "end_iso": end_iso,
            "limit": limit,
        },
    }
