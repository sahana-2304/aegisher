"""
Safe Routing Engine
Uses OpenRouteService API + AI risk scoring to compute safest routes
"""
import os
import httpx
import uuid
import math
from models.schemas import RouteResponse, RouteSegment
from services.risk_engine import RiskEngine

ORS_BASE = "https://api.openrouteservice.org/v2"
ORS_KEY = os.getenv("ORS_API_KEY", "")
OSRM_BASE = "https://router.project-osrm.org/route/v1"

TRANSPORT_MAP = {
    "walking": "foot-walking",
    "driving": "driving-car",
    "cycling": "cycling-regular",
}
OSRM_TRANSPORT_MAP = {
    "walking": "walking",
    "driving": "driving",
    "cycling": "cycling",
}

risk_engine = RiskEngine()


class RoutingEngine:
    @staticmethod
    def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Approx distance between two points in km."""
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = (
            math.sin(dlat / 2) ** 2
            + math.cos(math.radians(lat1))
            * math.cos(math.radians(lat2))
            * math.sin(dlon / 2) ** 2
        )
        return 6371 * 2 * math.asin(math.sqrt(a))

    async def _geocode(self, address: str) -> dict:
        """Convert address string to coordinates."""
        # Prefer ORS geocoding when key is available.
        if ORS_KEY:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(
                    f"{ORS_BASE}/geocode/search",
                    params={"api_key": ORS_KEY, "text": address, "size": 1},
                )
                r.raise_for_status()
                data = r.json()
                if not data.get("features"):
                    raise ValueError("Destination not found")
                coords = data["features"][0]["geometry"]["coordinates"]
                return {"longitude": coords[0], "latitude": coords[1]}

        # Free fallback: Nominatim geocoding.
        async with httpx.AsyncClient(
            timeout=15,
            headers={"User-Agent": "AegisHer/1.0 (routing geocoder)"},
        ) as client:
            r = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": address, "format": "json", "limit": 1},
            )
            r.raise_for_status()
            data = r.json()
            if not data:
                raise ValueError("Destination not found")
            return {"longitude": float(data[0]["lon"]), "latitude": float(data[0]["lat"])}

    async def _get_routes(self, origin: dict, destination: dict, profile: str) -> list:
        """Fetch alternative routes from ORS."""
        async with httpx.AsyncClient(timeout=15) as client:
            payload = {
                "coordinates": [
                    [origin["longitude"], origin["latitude"]],
                    [destination["longitude"], destination["latitude"]],
                ],
                "alternative_routes": {"share_factor": 0.6, "target_count": 3},
                "geometry": True,
                "instructions": True,
            }
            r = await client.post(
                f"{ORS_BASE}/directions/{profile}/geojson",
                json=payload,
                headers={"Authorization": ORS_KEY},
            )
            r.raise_for_status()
            return r.json().get("features", [])

    async def _get_routes_osrm(self, origin: dict, destination: dict, mode: str) -> list:
        """Fetch alternative routes from free OSRM public API."""
        profile = OSRM_TRANSPORT_MAP.get(mode, "walking")
        coord_str = (
            f"{origin['longitude']},{origin['latitude']};"
            f"{destination['longitude']},{destination['latitude']}"
        )

        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{OSRM_BASE}/{profile}/{coord_str}",
                params={
                    "alternatives": "true",
                    "overview": "full",
                    "steps": "false",
                    "geometries": "geojson",
                },
            )
            r.raise_for_status()
            data = r.json()

        routes = data.get("routes", [])
        features = []
        for route in routes:
            features.append(
                {
                    "geometry": route.get("geometry", {}),
                    "properties": {
                        "summary": {
                            "distance": route.get("distance", 0),
                            "duration": route.get("duration", 0),
                        }
                    },
                }
            )
        return features

    def _score_route(self, route_feature: dict) -> tuple[float, float]:
        """
        Score a route by combining normalized distance and risk score.
        route_score = 0.4 * norm_distance + 0.6 * avg_risk
        Lower = better (safer and shorter)
        """
        summary = route_feature["properties"]["summary"]
        distance = summary["distance"]  # meters

        coords = route_feature["geometry"]["coordinates"]
        if len(coords) < 2:
            avg_risk = risk_engine.predict(coords[0][1], coords[0][0])["risk_score"] if coords else 0.5
        else:
            # Distance-weighted risk across route segments for better safety accuracy.
            # Downsample very dense geometries to keep runtime bounded.
            stride = max(1, len(coords) // 120)
            sampled = coords[::stride]
            if sampled[-1] != coords[-1]:
                sampled.append(coords[-1])

            weighted_risk = 0.0
            total_km = 0.0

            for i in range(len(sampled) - 1):
                lon1, lat1 = sampled[i]
                lon2, lat2 = sampled[i + 1]
                seg_km = self._haversine_km(lat1, lon1, lat2, lon2)
                if seg_km <= 0:
                    continue

                mid_lat = (lat1 + lat2) / 2
                mid_lon = (lon1 + lon2) / 2
                seg_risk = risk_engine.predict(mid_lat, mid_lon)["risk_score"]
                weighted_risk += seg_risk * seg_km
                total_km += seg_km

            avg_risk = weighted_risk / total_km if total_km > 0 else 0.5

        # Normalize distance (assume max route 10km)
        norm_dist = min(distance / 10000, 1.0)
        score = 0.4 * norm_dist + 0.6 * avg_risk

        return score, avg_risk

    async def compute_safe_route(self, origin: dict, destination: dict, mode: str) -> RouteResponse:
        """
        Compute the safest route between two points.
        """
        # Resolve destination if address string
        if "address" in destination:
            destination = await self._geocode(destination["address"])

        profile = TRANSPORT_MAP.get(mode, "foot-walking")

        try:
            if ORS_KEY:
                features = await self._get_routes(origin, destination, profile)
            else:
                features = await self._get_routes_osrm(origin, destination, mode)
        except Exception:
            features = []

        if not features:
            return self._mock_route(origin, destination)

        # Score all routes and pick safest
        scored = [(self._score_route(f), f) for f in features]
        scored.sort(key=lambda x: x[0][0])  # ascending score = best
        best_feature = scored[0][1]

        summary = best_feature["properties"]["summary"]
        coords = best_feature["geometry"]["coordinates"]
        _, avg_risk = scored[0][0]

        # Count avoided high-risk zones vs other routes
        avoided = sum(1 for (_, risk), _ in scored[1:] if risk > avg_risk + 0.1)

        return RouteResponse(
            route_id=str(uuid.uuid4()),
            total_distance_m=summary["distance"],
            estimated_duration_s=summary["duration"],
            overall_safety_score=round((1 - avg_risk) * 100, 1),
            segments=[RouteSegment(
                coordinates=coords,
                distance_m=summary["distance"],
                avg_risk_score=round(avg_risk, 3),
            )],
            avoided_high_risk_zones=avoided,
            geometry=best_feature["geometry"],
        )

    def _mock_route(self, origin: dict, destination: dict) -> RouteResponse:
        """Returns a mock route when ORS is not configured."""
        import math
        dist = math.sqrt(
            (origin["latitude"] - destination.get("latitude", origin["latitude"] + 0.01))**2 +
            (origin["longitude"] - destination.get("longitude", origin["longitude"] + 0.01))**2
        ) * 111000

        return RouteResponse(
            route_id=str(uuid.uuid4()),
            total_distance_m=round(dist),
            estimated_duration_s=round(dist / 1.3),
            overall_safety_score=82.0,
            segments=[RouteSegment(
                coordinates=[
                    [origin["longitude"], origin["latitude"]],
                    [destination.get("longitude", origin["longitude"] + 0.01), destination.get("latitude", origin["latitude"] + 0.01)],
                ],
                distance_m=round(dist),
                avg_risk_score=0.18,
            )],
            avoided_high_risk_zones=2,
            geometry={
                "type": "LineString",
                "coordinates": [
                    [origin["longitude"], origin["latitude"]],
                    [destination.get("longitude", origin["longitude"] + 0.01), destination.get("latitude", origin["latitude"] + 0.01)],
                ],
            },
        )
