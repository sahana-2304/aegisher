"""
Police Assistance Router
"""
from fastapi import APIRouter, HTTPException
from models.schemas import PoliceStation
import math

router = APIRouter()

# Static police station database (production: use Google Places API or govt. open data)
STATIONS = [
    {"name": "Anna Nagar West PS", "address": "100 Feet Rd, Anna Nagar West, Chennai", "phone": "044-23617155", "lat": 13.0895, "lng": 80.2102},
    {"name": "Adyar PS", "address": "Gandhi Nagar, Adyar, Chennai", "phone": "044-24413180", "lat": 13.0012, "lng": 80.2565},
    {"name": "T. Nagar PS", "address": "Usman Rd, T. Nagar, Chennai", "phone": "044-24342950", "lat": 13.0418, "lng": 80.2341},
    {"name": "Mylapore PS", "address": "Luz Church Rd, Mylapore", "phone": "044-24993919", "lat": 13.0336, "lng": 80.2681},
    {"name": "Koyambedu PS", "address": "Jawaharlal Nehru Salai, Koyambedu", "phone": "044-23766111", "lat": 13.0694, "lng": 80.1948},
]


def haversine_km(lat1, lng1, lat2, lng2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
    return R * 2 * math.asin(math.sqrt(a))


@router.get("/nearest", response_model=PoliceStation)
def nearest_police(lat: float, lng: float):
    """Find the nearest police station to given coordinates."""
    nearest = min(STATIONS, key=lambda s: haversine_km(lat, lng, s["lat"], s["lng"]))
    dist_km = haversine_km(lat, lng, nearest["lat"], nearest["lng"])
    return PoliceStation(
        name=nearest["name"],
        address=nearest["address"],
        phone=nearest["phone"],
        distance_m=round(dist_km * 1000),
        latitude=nearest["lat"],
        longitude=nearest["lng"],
    )


@router.get("/all")
def all_stations():
    return {"stations": STATIONS}