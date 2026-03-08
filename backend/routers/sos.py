"""
SOS Emergency Router
Handles SOS activation, notification dispatch, and logging
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks
from models.schemas import SOSRequest, SOSResponse
from services.firebase import get_firestore, send_fcm_notification
from services.notifications import NotificationService
from datetime import datetime
import uuid

router = APIRouter()
notif_svc = NotificationService()


@router.post("/trigger", response_model=SOSResponse)
async def trigger_sos(req: SOSRequest, background_tasks: BackgroundTasks):
    """
    SOS activation endpoint.
    Sends alerts to emergency contacts and police.
    Logs event to Firestore.
    """
    sos_id = str(uuid.uuid4())
    timestamp = datetime.utcnow().isoformat()

    try:
        db = get_firestore()

        # 1. Fetch user profile
        user_doc = db.collection("Users").document(req.user_id).get()
        if not user_doc.exists:
            raise HTTPException(status_code=404, detail="User not found")
        user = user_doc.to_dict()

        # 2. Build SOS payload
        sos_payload = {
            "sos_id": sos_id,
            "user_id": req.user_id,
            "user_name": user["name"],
            "user_phone": user["phone"],
            "latitude": req.latitude,
            "longitude": req.longitude,
            "device_ip": req.device_ip,
            "maps_link": f"https://maps.google.com/?q={req.latitude},{req.longitude}",
            "timestamp": timestamp,
            "status": "active",
        }

        # 3. Log to Firestore
        db.collection("EmergencyLogs").document(sos_id).set(sos_payload)

        # 4. Dispatch notifications asynchronously
        background_tasks.add_task(
            notif_svc.dispatch_sos_alerts,
            sos_payload,
            user.get("emergency_contact_1"),
            user.get("emergency_contact_2"),
            user.get("fcm_token"),
        )

        return SOSResponse(
            sos_id=sos_id,
            status="dispatched",
            contacts_notified=2,
            police_notified=True,
            timestamp=timestamp,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status/{sos_id}")
async def get_sos_status(sos_id: str):
    """Returns current status of an SOS event."""
    db = get_firestore()
    doc = db.collection("EmergencyLogs").document(sos_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="SOS event not found")
    return doc.to_dict()