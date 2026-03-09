"""
Authentication Router - Firebase Auth token verification
"""
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from models.schemas import UserCreate, UserResponse
from services.firebase import get_firestore

router = APIRouter()


async def verify_token(authorization: str = Header(None)) -> str:
    """Verify Firebase ID token and return the Firebase UID."""
    try:
        get_firestore()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = authorization.split(" ", 1)[1]
    try:
        from firebase_admin import auth

        decoded = auth.verify_id_token(token)
        return decoded["uid"]
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


@router.post("/register", response_model=UserResponse)
async def register_user(user: UserCreate, user_id: str = Depends(verify_token)):
    """Create or update user profile in Firestore using Firebase UID."""
    try:
        db = get_firestore()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    profile = {
        "user_id": user_id,
        **user.model_dump(),
        "created_at": datetime.utcnow().isoformat(),
    }
    db.collection("Users").document(user_id).set(profile, merge=True)

    return UserResponse(
        user_id=user_id,
        name=user.name,
        email=user.email,
        created_at=profile["created_at"],
    )


@router.get("/profile/{user_id}")
async def get_profile(user_id: str, _: str = Depends(verify_token)):
    try:
        db = get_firestore()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    doc = db.collection("Users").document(user_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="User not found")

    data = doc.to_dict()
    data.pop("emergency_contact_1", None)
    data.pop("emergency_contact_2", None)
    return data
