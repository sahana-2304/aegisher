"""
Safe Routing Engine
Uses OpenRouteService API + AI risk scoring to compute safest routes
"""
import os
import httpx
import uuid
from models.schemas import RouteResponse, RouteSegment
from services.risk_engine import RiskEngine

ORS_BASE = "https://api.openrouteservice.org/v2"
ORS_KEY = os.getenv("ORS_API_KEY", "")

TRANSPORT_MAP = {
    "walking": "foot-walking",
    "driving": "driving-car",
    "cycling": "cycling-regular",
}

risk_engine = RiskEngine()


class RoutingEngine:
    async def _geocode(self, address: str) -> dict:
        """Convert address string to coordinates."""
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{ORS_BASE}/geocode/search",
                params={"api_key": ORS_KEY, "text": address, "size": 1},
            )
            data = r.json()
            coords = data["features"][0]["geometry"]["coordinates"]
            return {"longitude": coords[0], "latitude": coords[1]}

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
            return r.json().get("features", [])

    def _score_route(self, route_feature: dict) -> tuple[float, float]:
        """
        Score a route by combining normalized distance and risk score.
        route_score = 0.4 * norm_distance + 0.6 * avg_risk
        Lower = better (safer and shorter)
        """
        summary = route_feature["properties"]["summary"]
        distance = summary["distance"]  # meters

        coords = route_feature["geometry"]["coordinates"]
        # Sample every 10th coordinate for performance
        sample = coords[::10] if len(coords) > 10 else coords
        risks = [risk_engine.predict(c[1], c[0])["risk_score"] for c in sample]
        avg_risk = sum(risks) / len(risks) if risks else 0.5

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

        # Fallback if no ORS key configured
        if not ORS_KEY:
            return self._mock_route(origin, destination)

        features = await self._get_routes(origin, destination, profile)
        if not features:
            raise ValueError("No routes found")

        # Score all routes and pick safest
        scored = [(self._score_route(f), f) for f in features]
        scored.sort(key=lambda x: x[0][0])  # ascending score = best
        best_score, best_feature = scored[0][0][0], scored[0][1]

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
                coordinates=[[origin["longitude"], origin["latitude"]]],
                distance_m=round(dist),
                avg_risk_score=0.18,
            )],
            avoided_high_risk_zones=2,
            geometry={"type": "LineString", "coordinates": [[origin["longitude"], origin["latitude"]]]},
        )