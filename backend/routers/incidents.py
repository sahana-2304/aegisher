"""
Incidents Router - Incident Reporting System
Provides endpoints for creating incident drafts, uploading evidence, and submitting reports.
"""
import os
import uuid
import json
import hashlib
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Header, status
from fastapi.responses import JSONResponse

from models.schemas import (
    IncidentDraftRequest,
    IncidentDraftResponse,
    IncidentSubmitRequest,
    IncidentSubmitResponse,
    IncidentEvidenceUploadResponse,
    IncidentEvidenceMeta,
    IncidentLocationPayload,
    IncidentType,
)
from services.firebase import get_firestore, upload_evidence_to_storage, delete_evidence_from_storage

router = APIRouter()

# Incident status constants
STATUS_DRAFT = "draft"
STATUS_SUBMITTED = "submitted"
STATUS_FLAGGED = "flagged"

# Allowed MIME types for evidence
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
ALLOWED_VIDEO_TYPES = {"video/mp4", "video/3gpp", "video/webm"}
ALLOWED_AUDIO_TYPES = {"audio/mpeg", "audio/wav", "audio/ogg", "audio/mp3"}
ALLOWED_TYPES = ALLOWED_IMAGE_TYPES | ALLOWED_VIDEO_TYPES | ALLOWED_AUDIO_TYPES

# File size limits (in bytes)
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB per file
MAX_TOTAL_SIZE = 200 * 1024 * 1024  # 200MB total
MAX_FILES = 10


def get_current_user_id(authorization: str = Header(None)) -> str:
    """
    Extract user ID from authorization header.
    For now, we'll use a simple token-based approach.
    In production, this would validate JWT and extract user_id.
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header required"
        )
    
    # For development/testing, accept user_id in the format "Bearer user_id"
    # In production, validate JWT token
    if authorization.startswith("Bearer "):
        user_id = authorization[7:].strip()
        if user_id:
            return user_id
    
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authorization token"
    )


def get_firestore_db():
    """Get Firestore database instance."""
    try:
        return get_firestore()
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database not available"
        )


@router.post("/drafts", response_model=IncidentDraftResponse)
async def create_incident_draft(
    request: IncidentDraftRequest,
    user_id: str = Depends(get_current_user_id),
    db = Depends(get_firestore_db)
):
    """
    Create a new incident draft.
    Returns a draft_id that will be used for subsequent uploads and submission.
    """
    try:
        # Generate unique incident ID
        incident_id = f"INC-{uuid.uuid4().hex[:12].upper()}"
        
        # Create draft document
        draft_data = {
            "incident_id": incident_id,
            "status": STATUS_DRAFT,
            "reporter_uid": user_id,
            "source": request.source or "web_beta",
            "app_version": request.app_version,
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
            # Incident core fields (initially empty for draft)
            "incident_type": None,
            "description": None,
            "incident_time": None,
            "location": None,
            "anonymous_report": True,
            # Evidence metadata (initially empty)
            "evidence": [],
            # Legal simulation fields
            "legal_disclaimer_accepted": False,
            "truth_declaration_accepted": False,
            "fir_summary_text": None,
            "disclaimer_accepted_at": None,
            # Workflow metadata
            "submitted_at": None,
            "map_to_community": False,
        }
        
        # Store in Firestore
        db.collection("incident_reports").document(incident_id).set(draft_data)
        
        return IncidentDraftResponse(
            incident_id=incident_id,
            status=STATUS_DRAFT,
            created_at=draft_data["created_at"]
        )
    except Exception as e:
        print(f"[Incidents] Failed to create draft: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create incident draft"
        )


@router.post("/{draft_id}/evidence", response_model=IncidentEvidenceUploadResponse)
async def upload_evidence(
    draft_id: str,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
    db = Depends(get_firestore_db)
):
    """
    Upload evidence files for an incident draft.
    Supports multipart file uploads.
    """
    try:
        # Validate draft exists and belongs to user
        doc_ref = db.collection("incident_reports").document(draft_id)
        doc = doc_ref.get()
        
        if not doc.exists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Incident draft not found"
            )
        
        draft_data = doc.to_dict()
        
        # Check ownership
        if draft_data.get("reporter_uid") != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to upload evidence to this incident"
            )
        
        # Check status
        if draft_data.get("status") != STATUS_DRAFT:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot upload evidence to a submitted incident"
            )
        
        # Validate file type
        content_type = file.file.content_type
        if content_type not in ALLOWED_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File type {content_type} not allowed. Allowed types: {', '.join(ALLOWED_TYPES)}"
            )
        
        # Read file content
        file_content = await file.read()
        file_size = len(file_content)
        
        # Validate file size
        if file_size > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File size exceeds maximum allowed size of {MAX_FILE_SIZE // (1024*1024)}MB"
            )
        
        # Check total size limit
        current_evidence = draft_data.get("evidence", [])
        current_total_size = sum(e.get("size_bytes", 0) for e in current_evidence)
        
        if len(current_evidence) >= MAX_FILES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Maximum number of files ({MAX_FILES}) exceeded"
            )
        
        if current_total_size + file_size > MAX_TOTAL_SIZE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Total evidence size would exceed maximum limit"
            )
        
        # Upload to Firebase Storage
        original_filename = file.filename or "evidence"
        storage_result = await upload_evidence_to_storage(
            incident_id=draft_id,
            file_content=file_content,
            filename=original_filename,
            content_type=content_type
        )
        
        # Create evidence metadata
        evidence_meta = {
            "evidence_id": storage_result["file_id"],
            "filename": storage_result["original_filename"],
            "content_type": storage_result["content_type"],
            "size_bytes": storage_result["size"],
            "sha256": storage_result["checksum"],
            "storage_path": storage_result["storage_path"],
            "uploaded_at": storage_result["uploaded_at"]
        }
        
        # Update Firestore document
        current_evidence.append(evidence_meta)
        doc_ref.update({
            "evidence": current_evidence,
            "updated_at": datetime.utcnow().isoformat()
        })
        
        return IncidentEvidenceUploadResponse(
            incident_id=draft_id,
            uploaded_count=1,
            evidence=[IncidentEvidenceMeta(**evidence_meta)]
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Incidents] Failed to upload evidence: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to upload evidence"
        )


@router.delete("/{draft_id}/evidence/{evidence_id}")
async def delete_evidence(
    draft_id: str,
    evidence_id: str,
    user_id: str = Depends(get_current_user_id),
    db = Depends(get_firestore_db)
):
    """Delete evidence from an incident draft."""
    try:
        doc_ref = db.collection("incident_reports").document(draft_id)
        doc = doc_ref.get()
        
        if not doc.exists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Incident draft not found"
            )
        
        draft_data = doc.to_dict()
        
        # Check ownership
        if draft_data.get("reporter_uid") != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized"
            )
        
        # Check status
        if draft_data.get("status") != STATUS_DRAFT:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete evidence from a submitted incident"
            )
        
        # Find and remove evidence
        current_evidence = draft_data.get("evidence", [])
        evidence_to_delete = None
        
        for i, evidence in enumerate(current_evidence):
            if evidence.get("evidence_id") == evidence_id:
                evidence_to_delete = evidence
                current_evidence.pop(i)
                break
        
        if evidence_to_delete is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Evidence not found"
            )
        
        # Delete from Storage
        storage_path = evidence_to_delete.get("storage_path")
        if storage_path:
            delete_evidence_from_storage(storage_path)
        
        # Update Firestore
        doc_ref.update({
            "evidence": current_evidence,
            "updated_at": datetime.utcnow().isoformat()
        })
        
        return {"status": "deleted", "evidence_id": evidence_id}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Incidents] Failed to delete evidence: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete evidence"
        )


@router.get("/{draft_id}")
async def get_incident(
    draft_id: str,
    user_id: str = Depends(get_current_user_id),
    db = Depends(get_firestore_db)
):
    """Get incident details (draft or submitted)."""
    try:
        doc_ref = db.collection("incident_reports").document(draft_id)
        doc = doc_ref.get()
        
        if not doc.exists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Incident not found"
            )
        
        data = doc.to_dict()
        
        # Check ownership or admin
        # For now, only owner can view
        if data.get("reporter_uid") != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to view this incident"
            )
        
        # Build response (handle anonymous flag)
        response = {
            "incident_id": data.get("incident_id"),
            "status": data.get("status"),
            "created_at": data.get("created_at"),
            "updated_at": data.get("updated_at"),
            "incident_type": data.get("incident_type"),
            "description": data.get("description"),
            "incident_time": data.get("incident_time"),
            "location": data.get("location"),
            "anonymous_report": data.get("anonymous_report", True),
            "evidence": data.get("evidence", []),
            "submitted_at": data.get("submitted_at"),
            "fir_summary_text": data.get("fir_summary_text"),
        }
        
        # Only include reporter info for non-anonymous or if user owns it
        if not data.get("anonymous_report") or data.get("reporter_uid") == user_id:
            response["reporter_uid"] = data.get("reporter_uid")
        
        return response
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Incidents] Failed to get incident: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve incident"
        )


@router.post("/{draft_id}/submit", response_model=IncidentSubmitResponse)
async def submit_incident(
    draft_id: str,
    request: IncidentSubmitRequest,
    user_id: str = Depends(get_current_user_id),
    db = Depends(get_firestore_db)
):
    """
    Submit an incident report.
    This finalizes the draft and makes it official.
    """
    try:
        doc_ref = db.collection("incident_reports").document(draft_id)
        doc = doc_ref.get()
        
        if not doc.exists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Incident draft not found"
            )
        
        draft_data = doc.to_dict()
        
        # Check ownership
        if draft_data.get("reporter_uid") != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to submit this incident"
            )
        
        # Check status
        if draft_data.get("status") != STATUS_DRAFT:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Incident already submitted"
            )
        
        # Validate required fields
        if not request.incident_type:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Incident type is required"
            )
        
        if not request.description or len(request.description) < 10:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Description must be at least 10 characters"
            )
        
        if not request.incident_time_iso:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Incident time is required"
            )
        
        if not request.location:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Location is required"
            )
        
        # Legal consent validation
        if not request.legal_disclaimer_accepted:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Legal disclaimer must be accepted"
            )
        
        if not request.truth_declaration_accepted:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Truth declaration must be accepted"
            )
        
        # Check idempotency - if already submitted with same details, return success
        existing_status = draft_data.get("status")
        if existing_status == STATUS_SUBMITTED:
            return IncidentSubmitResponse(
                incident_id=draft_id,
                status=STATUS_SUBMITTED,
                submitted_at=draft_data.get("submitted_at"),
                idempotent=True
            )
        
        # Generate FIR-ready summary if not provided
        fir_summary = request.fir_summary_text
        if not fir_summary:
            fir_summary = generate_fir_summary(
                incident_type=request.incident_type,
                description=request.description,
                location=request.location,
                incident_time=request.incident_time_iso
            )
        
        # Update the document
        submitted_at = datetime.utcnow().isoformat()
        
        update_data = {
            "status": STATUS_SUBMITTED,
            "incident_type": request.incident_type,
            "description": request.description,
            "incident_time": request.incident_time_iso,
            "location": {
                "label": request.location.label,
                "latitude": request.location.latitude,
                "longitude": request.location.longitude,
                "source": request.location.source or "manual"
            },
            "anonymous_report": request.anonymous_report,
            "legal_disclaimer_accepted": True,
            "truth_declaration_accepted": True,
            "fir_summary_text": fir_summary,
            "disclaimer_accepted_at": submitted_at,
            "submitted_at": submitted_at,
            "updated_at": submitted_at,
            "app_version": request.app_version or draft_data.get("app_version"),
            "map_to_community": request.map_to_community
        }
        
        doc_ref.update(update_data)
        
        # Optionally map to community reports
        if request.map_to_community:
            await map_to_community_report(db, draft_id, user_id, request, draft_data)
        
        return IncidentSubmitResponse(
            incident_id=draft_id,
            status=STATUS_SUBMITTED,
            submitted_at=submitted_at,
            idempotent=False
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Incidents] Failed to submit incident: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to submit incident"
        )


def generate_fir_summary(
    incident_type: str,
    description: str,
    location: IncidentLocationPayload,
    incident_time_iso: str
) -> str:
    """Generate FIR-ready narrative summary."""
    
    type_labels = {
        "verbal_abuse": "Verbal Abuse",
        "stalking": "Stalking",
        "physical_harassment": "Physical Harassment",
        "workplace_harassment": "Workplace Harassment",
        "public_transport_harassment": "Public Transportation Harassment",
        "other": "Other Harassment"
    }
    
    type_label = type_labels.get(incident_type, "Harassment Incident")
    
    # Format incident time
    try:
        dt = datetime.fromisoformat(incident_time_iso.replace("Z", "+00:00"))
        formatted_time = dt.strftime("%d-%m-%Y at %H:%M hours")
    except:
        formatted_time = incident_time_iso
    
    summary = f"""
FIR/NCRC COMPLAINT SUMMARY
==========================

Type of Incident: {type_label}

Date and Time: {formatted_time}

Location: {location.label}
Coordinates: {location.latitude}, {location.longitude}

Description of Incident:
{description}

---
This summary was generated by AegisHer Safety App for complaint filing purposes.
This is NOT an official FIR filing. Please visit the nearest police station 
or file online at https://portal.police.gov.in for official complaint registration.

Emergency Contacts:
- Police: 100 or 112
- Women's Helpline: 181
- State Women Helpline: 1091
"""
    
    return summary.strip()


async def map_to_community_report(
    db,
    incident_id: str,
    user_id: str,
    request: IncidentSubmitRequest,
    draft_data: dict
):
    """Map submitted incident to community reports for risk scoring."""
    try:
        # Create community report with reduced/anonymized fields
        community_report = {
            "incident_id": incident_id,
            "user_id": user_id,  # Keep for internal tracking
            "incident_type": map_to_community_type(request.incident_type),
            "latitude": request.location.latitude,
            "longitude": request.location.longitude,
            "location_label": request.location.label,
            "description": request.description[:500] if request.description else None,  # Truncate
            "timestamp": request.incident_time_iso,
            "submitted_at": datetime.utcnow().isoformat(),
            "source": "incident_report"
        }
        
        # Store in community_reports collection
        db.collection("community_reports").document(incident_id).set(community_report)
        print(f"[Incidents] Mapped incident {incident_id} to community reports")
    except Exception as e:
        print(f"[Incidents] Failed to map to community: {e}")
        # Don't fail the submission if this fails


def map_to_community_type(incident_type: str) -> str:
    """Map incident type to community report type."""
    mapping = {
        "verbal_abuse": "harassment",
        "stalking": "harassment",
        "physical_harassment": "harassment",
        "workplace_harassment": "harassment",
        "public_transport_harassment": "harassment",
        "other": "harassment"
    }
    return mapping.get(incident_type, "other")


# ─── Legal Content Endpoints ───────────────────────────────────────────────

LEGAL_CONTENT_VERSION = "1.0.0"

LEGAL_CONTENT = {
    "version": LEGAL_CONTENT_VERSION,
    "disclaimer": "This is a simulated legal guidance tool for informational purposes only. This does not constitute legal advice. Please consult a qualified legal professional for actual legal matters.",
    "emergency_contacts": [
        {"name": "Police Emergency", "number": "100", "description": "Dial for any emergency"},
        {"name": "National Emergency", "number": "112", "description": "All-in-one emergency response"},
        {"name": "Women Helpline", "number": "181", "description": "24/7 Women Helpline"},
        {"name": "State Women Helpline", "number": "1091", "description": "Women Safety Helpline"}
    ],
    "immediate_safety_actions": [
        "Move to a safe, public location if possible",
        "Call emergency services (100/112) if in immediate danger",
        "Inform trusted people about your location",
        "Do not confront the perpetrator if it puts you at risk",
        "Preserve any evidence (photos, messages, recordings)"
    ],
    "rights_guidance": [
        "Under Indian law, you have the right to file a complaint at any police station",
        "You can file an FIR even if the incident occurred outside the police station's jurisdiction",
        "For workplace harassment, you can approach the Internal Complaints Committee (ICC)",
        "You have the right to file complaints anonymously",
        "You can seek protection orders under the Protection of Women from Domestic Violence Act"
    ],
    "evidence_preservation": [
        "Do not delete any messages, emails, or call records",
        "Take screenshots of any threatening messages or social media posts",
        "Preserve any CCTV footage from the location",
        "Note down contact details of any witnesses",
        "Keep copies of medical reports if injuries were sustained"
    ],
    "fir_guidance": [
        "Visit the nearest police station to file an FIR",
        "You can file online at https://portal.police.gov.in",
        "For quick action, you can call 112 and request police assistance",
        "Carry ID proof and any evidence you have collected",
        "You have the right to get a copy of the FIR filed"
    ]
}


@router.get("/legal-content")
async def get_legal_content():
    """Get legal guidance content for the incident reporting flow."""
    return LEGAL_CONTENT
