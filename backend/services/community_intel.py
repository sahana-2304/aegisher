"""
Community Intelligence Service
Aggregates community reports and route feedback into area risk scores
"""
import math
from typing import Optional
from datetime import datetime, timedelta


class CommunityIntelService:
    """
    Computes community_risk_score for a location based on:
    - Recent incident reports
    - Route safety feedback
    - Post-event reports
    
    community_risk_score formula:
      score = min(1.0, (weighted_reports + recency_penalty) / normalization_factor)
    """

    REPORT_RADIUS_KM = 0.5   # Radius to aggregate reports
    RECENCY_HOURS = 72        # Reports older than this are downweighted

    def _haversine(self, lat1, lng1, lat2, lng2) -> float:
        R = 6371
        dlat = math.radians(lat2 - lat1)
        dlng = math.radians(lng2 - lng1)
        a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
        return R * 2 * math.asin(math.sqrt(a))

    async def get_area_score(self, lat: float, lng: float) -> float:
        """
        Returns community risk score (0–1) for a location.
        In production: queries Firestore RiskGridData collection.
        """
        try:
            from services.firebase import get_firestore
            db = get_firestore()

            # Get reports within radius
            cutoff = (datetime.utcnow() - timedelta(hours=self.RECENCY_HOURS)).isoformat()
            reports = db.collection("CommunityReports").where("timestamp", ">=", cutoff).stream()

            total_weight = 0.0
            count = 0
            for r in reports:
                data = r.to_dict()
                dist = self._haversine(lat, lng, data["latitude"], data["longitude"])
                if dist <= self.REPORT_RADIUS_KM:
                    # Weight by proximity and recency
                    proximity_weight = 1 - (dist / self.REPORT_RADIUS_KM)
                    try:
                        age_hours = (datetime.utcnow() - datetime.fromisoformat(data["timestamp"])).total_seconds() / 3600
                    except Exception:
                        age_hours = 24
                    recency_weight = max(0.1, 1 - age_hours / self.RECENCY_HOURS)
                    total_weight += proximity_weight * recency_weight
                    count += 1

            # Normalize: 5+ incidents near full score
            return min(1.0, total_weight / 5.0)

        except Exception:
            # Fallback: return low community score
            return 0.1

    async def update_grid_score(self, lat: float, lng: float):
        """Recompute and store grid cell score after new report."""
        try:
            from services.firebase import get_firestore
            db = get_firestore()
            score = await self.get_area_score(lat, lng)
            grid_id = f"{round(lat, 3)}_{round(lng, 3)}"
            db.collection("RiskGridData").document(grid_id).set({
                "grid_id": grid_id,
                "latitude": lat,
                "longitude": lng,
                "community_risk_score": score,
                "last_updated": datetime.utcnow().isoformat(),
            }, merge=True)
        except Exception:
            pass

    async def get_area_reports(self, lat: float, lng: float, radius_km: float) -> list:
        """Fetch recent reports within radius."""
        try:
            from services.firebase import get_firestore
            db = get_firestore()
            cutoff = (datetime.utcnow() - timedelta(hours=48)).isoformat()
            docs = db.collection("CommunityReports").where("timestamp", ">=", cutoff).stream()
            results = []
            for d in docs:
                data = d.to_dict()
                dist = self._haversine(lat, lng, data["latitude"], data["longitude"])
                if dist <= radius_km:
                    results.append({**data, "distance_km": round(dist, 2)})
            return sorted(results, key=lambda x: x.get("timestamp", ""), reverse=True)
        except Exception:
            return []