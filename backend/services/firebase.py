"""
Firebase Service - Firestore + FCM
"""
import json
import os
from pathlib import Path

_db = None
_fcm_app = None


def init_firebase():
    """Initialize Firebase Admin SDK from environment credentials."""
    global _db, _fcm_app
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore, messaging

        cred_json = os.getenv("FIREBASE_CREDENTIALS_JSON")
        cred_path = os.getenv("FIREBASE_CREDENTIALS_PATH")

        if cred_json:
            cred = credentials.Certificate(json.loads(cred_json))
        elif cred_path:
            resolved_path = Path(cred_path)
            if not resolved_path.is_absolute():
                resolved_path = Path(__file__).resolve().parents[1] / resolved_path
            cred = credentials.Certificate(str(resolved_path))
        else:
            print("[Firebase] No credentials found. Running without Firebase.")
            return

        if not firebase_admin._apps:
            firebase_admin.initialize_app(cred)

        _db = firestore.client()
        print("[Firebase] Initialized successfully.")
    except Exception as e:
        print(f"[Firebase] Initialization failed: {e}")


def get_firestore():
    if _db is None:
        raise RuntimeError("Firestore not initialized. Set FIREBASE_CREDENTIALS_JSON or FIREBASE_CREDENTIALS_PATH.")
    return _db


async def send_fcm_notification(token: str, title: str, body: str, data: dict = None):
    """Send a push notification via Firebase Cloud Messaging."""
    try:
        from firebase_admin import messaging

        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data={str(k): str(v) for k, v in (data or {}).items()},
            token=token,
        )
        response = messaging.send(message)
        return response
    except Exception as e:
        print(f"[FCM] Failed to send notification: {e}")
        return None
