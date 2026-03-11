"""
Nearby Services Router
Aggregates nearby police stations, hospitals, and helpline contacts.
"""
from fastapi import APIRouter, Query

from models.schemas import NearbyServicesResponse
from services.nearby_services import get_nearby_services

router = APIRouter()


@router.get("/services", response_model=NearbyServicesResponse)
async def nearby_services(
    lat: float = Query(..., description="Current latitude"),
    lng: float = Query(..., description="Current longitude"),
    radius_m: int = Query(3000, ge=500, le=10000, description="Search radius in meters"),
    limit: int = Query(10, ge=1, le=30, description="Max points to return per category"),
):
    return await get_nearby_services(lat=lat, lng=lng, radius_m=radius_m, limit=limit)
