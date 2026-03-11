"""
AegisHer — Pydantic request/response models
"""
from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime


# ─── Auth ─────────────────────────────────────────────────────────────
class UserCreate(BaseModel):
    name: str
    phone: str
    email: EmailStr
    emergency_contact_1: str
    emergency_contact_2: str
    address: str
    fcm_token: Optional[str] = None


class UserResponse(BaseModel):
    user_id: str
    name: str
    email: str
    created_at: str


# ─── Risk Prediction ──────────────────────────────────────────────────
class LocationRequest(BaseModel):
    latitude: float
    longitude: float
    timestamp: str


class RiskResponse(BaseModel):
    risk_score: float          # 0–100 hybrid score
    risk_zone: str             # LOW | MEDIUM | HIGH
    ai_score: float            # XGBoost prediction (0–1)
    community_score: float     # Community intelligence score (0–1)
    contributing_factors: dict # SHAP explanation dict
    label: str


class ModelStatusResponse(BaseModel):
    model_loaded: bool
    model_source: str
    model_path: str
    feature_columns: List[str]


class ModelTrainResponse(BaseModel):
    status: str
    model_path: str
    dataset_path: str
    samples_used: int
    class_balance: dict
    metrics: dict
    feature_columns: List[str]


class ModelTestRequest(BaseModel):
    latitude: float
    longitude: float
    hour: Optional[int] = None
    day_type: Optional[str] = None
    lighting_score: Optional[float] = None
    crowd_density: Optional[float] = None
    crime_density_norm: Optional[float] = None
    police_distance_km: Optional[float] = None
    cctv_presence: Optional[int] = None
    past_incident_count: Optional[int] = None


class ModelTestResponse(BaseModel):
    model_loaded: bool
    model_source: str
    predicted_risk_probability: float
    predicted_label: str
    contributing_factors: dict


# ─── Routing ──────────────────────────────────────────────────────────
class RouteRequest(BaseModel):
    origin: dict               # {latitude, longitude}
    destination: dict          # {latitude, longitude} OR {"address": str}
    transport_mode: str        # walking | driving | cycling


class RouteSegment(BaseModel):
    coordinates: List[List[float]]
    distance_m: float
    avg_risk_score: float


class RouteResponse(BaseModel):
    route_id: str
    total_distance_m: float
    estimated_duration_s: float
    overall_safety_score: float
    segments: List[RouteSegment]
    avoided_high_risk_zones: int
    geometry: dict             # GeoJSON LineString


class RouteFeedback(BaseModel):
    route_id: str
    user_id: str
    rating: int                # 1–5
    safety_perception: str     # safe | unsafe | neutral
    comments: Optional[str] = None


# ─── SOS ──────────────────────────────────────────────────────────────
class SOSRequest(BaseModel):
    user_id: str
    latitude: float
    longitude: float
    device_ip: str
    timestamp: str


class SOSResponse(BaseModel):
    sos_id: str
    status: str
    contacts_notified: int
    police_notified: bool
    timestamp: str


# ─── Community ────────────────────────────────────────────────────────
class CommunityReport(BaseModel):
    user_id: str
    latitude: float
    longitude: float
    incident_type: str         # harassment | theft | unsafe_area | poor_lighting | other
    description: str
    timestamp: Optional[str] = None


class CommunityPost(BaseModel):
    user_id: str
    text: str
    category: str              # alert | tip | info
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    location_label: Optional[str] = None


# ─── Police ───────────────────────────────────────────────────────────
class PoliceStation(BaseModel):
    name: str
    address: str
    phone: str
    distance_m: float
    latitude: float
    longitude: float


# ─── Chat ─────────────────────────────────────────────────────────────
# Nearby services
class NearbyServicePoint(BaseModel):
    id: str
    name: str
    address: str
    phone: str
    latitude: float
    longitude: float
    distance_m: float
    source: str


class HelplineContact(BaseModel):
    id: str
    name: str
    number: str
    type: str


class NearbyMeta(BaseModel):
    fetched_at: str
    used_fallback_police: bool
    used_fallback_hospitals: bool


class NearbyServicesResponse(BaseModel):
    police: List[NearbyServicePoint]
    hospitals: List[NearbyServicePoint]
    helplines: List[HelplineContact]
    meta: NearbyMeta


# Chat
class ChatMessage(BaseModel):
    message: str
    session_id: str
    user_id: Optional[str] = None


class ChatResponse(BaseModel):
    reply: str
    session_id: str
    escalated: bool            # True if escalated to human
    suggest_call: bool
