"""
Firebase Service - Firestore + FCM + Storage
"""
import json
import os
import uuid
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any

_db = None
_fcm_app = None
_storage_bucket = None


def init_firebase():
    """Initialize Firebase Admin SDK from environment credentials."""
    global _db, _fcm_app, _storage_bucket
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore, messaging, storage

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
            firebase_admin.initialize_app(cred, {
                'storageBucket': os.getenv('FIREBASE_STORAGE_BUCKET')
            })

        _db = firestore.client()
        _storage_bucket = storage.bucket()
        print("[Firebase] Initialized successfully with Storage bucket.")
    except Exception as e:
        print(f"[Firebase] Initialization failed: {e}")


def get_firestore():
    if _db is None:
        raise RuntimeError("Firestore not initialized. Set FIREBASE_CREDENTIALS_JSON or FIREBASE_CREDENTIALS_PATH.")
    return _db


def get_storage_bucket():
    """Get the Firebase Storage bucket."""
    global _storage_bucket
    if _storage_bucket is None:
        # Try to initialize if not done yet
        init_firebase()
    return _storage_bucket


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


def compute_file_hash(file_content: bytes) -> str:
    """Compute SHA256 hash of file content."""
    return hashlib.sha256(file_content).hexdigest()


async def upload_evidence_to_storage(
    incident_id: str,
    file_content: bytes,
    filename: str,
    content_type: str
) -> Dict[str, Any]:
    """
    Upload evidence file to Firebase Storage.
    
    Args:
        incident_id: The incident ID (or draft_id for drafts)
        file_content: The file content as bytes
        filename: Original filename
        content_type: MIME type of the file
    
    Returns:
        Dict with storage_path, content_type, size, checksum, uploaded_at
    """
    bucket = get_storage_bucket()
    
    # Generate unique file ID
    file_id = str(uuid.uuid4())
    
    # Sanitize filename - remove potentially dangerous characters
    safe_filename = "".join(c for c in filename if c.isalnum() or c in '.-_ ')[:100]
    
    # Storage path: incident_evidence/{incident_id}/{file_id}_{safe_filename}
    storage_path = f"incident_evidence/{incident_id}/{file_id}_{safe_filename}"
    
    # Upload to Firebase Storage
    blob = bucket.blob(storage_path)
    blob.upload_from_string(
        file_content,
        content_type=content_type
    )
    
    # Compute checksum
    checksum = compute_file_hash(file_content)
    
    # Get file size
    size = len(file_content)
    
    result = {
        "storage_path": storage_path,
        "content_type": content_type,
        "size": size,
        "checksum": checksum,
        "uploaded_at": datetime.utcnow().isoformat(),
        "original_filename": safe_filename,
        "file_id": file_id
    }
    
    return result


def delete_evidence_from_storage(storage_path: str) -> bool:
    """Delete evidence file from Firebase Storage."""
    try:
        bucket = get_storage_bucket()
        blob = bucket.blob(storage_path)
        blob.delete()
        return True
    except Exception as e:
        print(f"[Storage] Failed to delete file {storage_path}: {e}")
        return False
