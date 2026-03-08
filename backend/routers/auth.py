"""
Authentication Router — Firebase Auth token verification
"""
from fastapi import APIRouter, HTTPException, Header
from models.schemas import UserCreate, UserResponse
from services.firebase import get_firestore
from datetime import datetime
import uuid

router = APIRouter()


async def verify_token(authorization: str = Header(None)) -> str:
    """Verify Firebase ID token and return user_id."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.split(" ")[1]
    try:
        from firebase_admin import auth
        decoded = auth.verify_id_token(token)
        return decoded["uid"]
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


@router.post("/register", response_model=UserResponse)
async def register_user(user: UserCreate, authorization: str = Header(None)):
    """
    Register user profile in Firestore.
    Call after Firebase Auth sign-up on frontend.
    """
    user_id = str(uuid.uuid4())  # In production: use Firebase UID from token

    db = get_firestore()
    profile = {
        "user_id": user_id,
        **user.dict(),
        "created_at": datetime.utcnow().isoformat(),
    }
    db.collection("Users").document(user_id).set(profile)

    return UserResponse(
        user_id=user_id,
        name=user.name,
        email=user.email,
        created_at=profile["created_at"],
    )


@router.get("/profile/{user_id}")
async def get_profile(user_id: str):
    db = get_firestore()
    doc = db.collection("Users").document(user_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="User not found")
    # Strip sensitive fields before returning
    data = doc.to_dict()
    data.pop("emergency_contact_1", None)
    data.pop("emergency_contact_2", None)
    return data