"""
Nearby Services Engine
Loads nearby police stations and hospitals from Overpass with static fallback.
"""
from __future__ import annotations

import math
import time
from datetime import datetime, timezone
from typing import Any

import httpx

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
CACHE_TTL_SECONDS = 20

_cache: dict[str, tuple[float, dict[str, Any]]] = {}

FALLBACK_HOSPITALS = [
    {
        "id": "fallback-hospital-apollo",
        "name": "Apollo Hospitals Greams Road",
        "address": "21, Greams Lane, Off Greams Road, Chennai",
        "phone": "044-28290200",
        "latitude": 13.0613,
        "longitude": 80.2518,
    },
    {
        "id": "fallback-hospital-fortis",
        "name": "Fortis Malar Hospital",
        "address": "52, 1st Main Road, Gandhi Nagar, Adyar, Chennai",
        "phone": "044-42892222",
        "latitude": 13.0068,
        "longitude": 80.2577,
    },
    {
        "id": "fallback-hospital-mmc",
        "name": "Rajiv Gandhi Government General Hospital",
        "address": "Poonamallee High Road, Park Town, Chennai",
        "phone": "044-25305000",
        "latitude": 13.0826,
        "longitude": 80.2756,
    },
    {
        "id": "fallback-hospital-kauvery",
        "name": "Kauvery Hospital Alwarpet",
        "address": "199, Luz Church Road, Alwarpet, Chennai",
        "phone": "044-40006000",
        "latitude": 13.0348,
        "longitude": 80.2659,
    },
    {
        "id": "fallback-hospital-miot",
        "name": "MIOT International",
        "address": "4/112, Mount Poonamallee Road, Manapakkam, Chennai",
        "phone": "044-42002288",
        "latitude": 13.0206,
        "longitude": 80.1847,
    },
]

STATIC_HELPLINES = [
    {"id": "women-1091", "name": "Women Helpline", "number": "1091", "type": "women"},
    {"id": "police-100", "name": "Police Emergency", "number": "100", "type": "police"},
    {"id": "emergency-112", "name": "Emergency Services", "number": "112", "type": "emergency"},
    {"id": "domestic-181", "name": "Domestic Violence Helpline", "number": "181", "type": "support"},
]


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    return 6371000 * 2 * math.asin(math.sqrt(a))


def _cache_key(lat: float, lng: float, radius_m: int, limit: int) -> str:
    return f"{round(lat, 4)}:{round(lng, 4)}:{radius_m}:{limit}"


def _pick_phone(tags: dict[str, Any]) -> str:
    return str(
        tags.get("phone")
        or tags.get("contact:phone")
        or tags.get("emergency:phone")
        or ""
    ).strip()


def _pick_address(tags: dict[str, Any]) -> str:
    if tags.get("addr:full"):
        return str(tags["addr:full"]).strip()
    parts = [
        tags.get("addr:housenumber"),
        tags.get("addr:street"),
        tags.get("addr:suburb"),
        tags.get("addr:city"),
    ]
    joined = ", ".join([str(part).strip() for part in parts if part])
    return joined or str(tags.get("name") or "").strip()


def _normalize_fallback_points(
    points: list[dict[str, Any]],
    lat: float,
    lng: float,
    source_name: str,
    limit: int,
) -> list[dict[str, Any]]:
    normalized = []
    for point in points:
        point_lat = float(point["latitude"])
        point_lng = float(point["longitude"])
        normalized.append(
            {
                "id": str(point["id"]),
                "name": str(point["name"]),
                "address": str(point.get("address") or ""),
                "phone": str(point.get("phone") or ""),
                "latitude": point_lat,
                "longitude": point_lng,
                "distance_m": round(_haversine_m(lat, lng, point_lat, point_lng), 1),
                "source": source_name,
            }
        )
    normalized.sort(key=lambda item: item["distance_m"])
    return normalized[:limit]


def _extract_osm_coordinates(element: dict[str, Any]) -> tuple[float | None, float | None]:
    lat = element.get("lat")
    lng = element.get("lon")
    if lat is not None and lng is not None:
        return float(lat), float(lng)

    center = element.get("center") or {}
    center_lat = center.get("lat")
    center_lng = center.get("lon")
    if center_lat is None or center_lng is None:
        return None, None
    return float(center_lat), float(center_lng)


async def _fetch_overpass_places(
    amenity: str,
    lat: float,
    lng: float,
    radius_m: int,
    limit: int,
) -> list[dict[str, Any]]:
    query = f"""
    [out:json][timeout:12];
    (
      node["amenity"="{amenity}"](around:{radius_m},{lat},{lng});
      way["amenity"="{amenity}"](around:{radius_m},{lat},{lng});
      relation["amenity"="{amenity}"](around:{radius_m},{lat},{lng});
    );
    out tags center;
    """

    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(OVERPASS_URL, data={"data": query})
        response.raise_for_status()
        payload = response.json()

    elements = payload.get("elements") or []
    places = []
    for element in elements:
        point_lat, point_lng = _extract_osm_coordinates(element)
        if point_lat is None or point_lng is None:
            continue

        tags = element.get("tags") or {}
        name = str(tags.get("name") or f"{amenity.title()} Service").strip()
        places.append(
            {
                "id": f"osm-{amenity}-{element.get('type', 'entity')}-{element.get('id', '0')}",
                "name": name,
                "address": _pick_address(tags),
                "phone": _pick_phone(tags),
                "latitude": point_lat,
                "longitude": point_lng,
                "distance_m": round(_haversine_m(lat, lng, point_lat, point_lng), 1),
                "source": "overpass",
            }
        )

    places.sort(key=lambda item: item["distance_m"])
    return places[:limit]


async def _fetch_with_expanding_radius(
    amenity: str,
    lat: float,
    lng: float,
    radius_m: int,
    limit: int,
) -> list[dict[str, Any]]:
    attempts = [radius_m, min(10000, radius_m * 2), 10000]
    seen = set()
    for attempt_radius in attempts:
        if attempt_radius in seen:
            continue
        seen.add(attempt_radius)
        try:
            places = await _fetch_overpass_places(
                amenity=amenity,
                lat=lat,
                lng=lng,
                radius_m=attempt_radius,
                limit=limit,
            )
            if places:
                return places
        except Exception:
            continue
    return []


def _fallback_police_points() -> list[dict[str, Any]]:
    from routers.police import STATIONS

    fallback = []
    for station in STATIONS:
        fallback.append(
            {
                "id": f"fallback-police-{station['name'].lower().replace(' ', '-')}",
                "name": station["name"],
                "address": station["address"],
                "phone": station["phone"],
                "latitude": float(station["lat"]),
                "longitude": float(station["lng"]),
            }
        )
    return fallback


async def get_nearby_services(lat: float, lng: float, radius_m: int = 3000, limit: int = 10) -> dict[str, Any]:
    radius_m = max(500, min(int(radius_m), 10000))
    limit = max(1, min(int(limit), 30))

    key = _cache_key(lat, lng, radius_m, limit)
    now = time.time()
    cached = _cache.get(key)
    if cached and cached[0] > now:
        return cached[1]

    used_fallback_police = False
    used_fallback_hospitals = False

    police_points: list[dict[str, Any]] = []
    hospital_points: list[dict[str, Any]] = []

    police_points = await _fetch_with_expanding_radius(
        amenity="police",
        lat=lat,
        lng=lng,
        radius_m=radius_m,
        limit=limit,
    )
    hospital_points = await _fetch_with_expanding_radius(
        amenity="hospital",
        lat=lat,
        lng=lng,
        radius_m=radius_m,
        limit=limit,
    )

    if not police_points:
        used_fallback_police = True
        police_points = _normalize_fallback_points(
            _fallback_police_points(),
            lat,
            lng,
            source_name="fallback",
            limit=limit,
        )

    if not hospital_points:
        used_fallback_hospitals = True
        hospital_points = _normalize_fallback_points(
            FALLBACK_HOSPITALS,
            lat,
            lng,
            source_name="fallback",
            limit=limit,
        )

    response = {
        "police": police_points,
        "hospitals": hospital_points,
        "helplines": STATIC_HELPLINES,
        "meta": {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "used_fallback_police": used_fallback_police,
            "used_fallback_hospitals": used_fallback_hospitals,
        },
    }

    _cache[key] = (now + CACHE_TTL_SECONDS, response)
    return response
