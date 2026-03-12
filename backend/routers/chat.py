"""
Helpline Chat Router
OpenRouter-backed support chatbot with emergency escalation.
"""
import os
import re
from typing import Dict, List

import httpx
from fastapi import APIRouter

from models.schemas import ChatMessage, ChatResponse

router = APIRouter()

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "").strip()
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "nvidia/nemotron-3-super-120b-a12b:free").strip()
OPENROUTER_TIMEOUT_SECONDS = float(os.getenv("OPENROUTER_TIMEOUT_SECONDS", "25"))
OPENROUTER_SITE_URL = os.getenv("OPENROUTER_SITE_URL", "http://localhost:3000").strip()
OPENROUTER_APP_NAME = os.getenv("OPENROUTER_APP_NAME", "AegisHer").strip()

# Escalation trigger keywords
ESCALATION_KEYWORDS = re.compile(
    r"\b(help|danger|scared|unsafe|emergency|hurt|attack|follow|stalking|threat|violence|assault|"
    r"rape|harass|abuse|trapped|missing|kidnap|murder|bleeding|panic)\b",
    re.IGNORECASE,
)


def _is_emergency(text: str) -> bool:
    return bool(ESCALATION_KEYWORDS.search(text))


def _system_prompt() -> str:
    return (
        "You are AegisHer safety support assistant for women in India. "
        "Your job is to give calm, practical, short safety guidance. "
        "If user appears in danger, prioritize immediate actions first: call 112, move to safe public place, "
        "contact trusted person, and keep location sharing on. "
        "Never claim actions you cannot perform (no fake calling/dispatch). "
        "If user asks for routes, police, hospital, or helplines, guide them to in-app map/support options. "
        "Keep responses under 120 words and use simple language."
    )


def _normalize_history(history: List) -> List[Dict[str, str]]:
    if not history:
        return []

    normalized: List[Dict[str, str]] = []
    for turn in history[-8:]:
        role = str(getattr(turn, "role", "") or "").strip().lower()
        text = str(getattr(turn, "text", "") or "").strip()
        if not text:
            continue
        if role in {"assistant", "bot", "model"}:
            normalized.append({"role": "assistant", "content": text})
        else:
            normalized.append({"role": "user", "content": text})
    return normalized


def _extract_reply_content(payload: dict) -> str:
    choices = payload.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content") or ""
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
            elif isinstance(item, str):
                parts.append(item)
        return " ".join(part.strip() for part in parts if part and part.strip()).strip()
    return str(content).strip()


def _fallback_reply(user_text: str, escalated: bool) -> str:
    if escalated:
        return (
            "I am prioritizing your safety. If you are in immediate danger, call 112 now. "
            "Move to a crowded, well-lit place, contact someone you trust, and keep your live location shared. "
            "You can also call Women Helpline 1091."
        )

    lower = user_text.lower()
    if any(word in lower for word in ("route", "map", "direction", "navigate")):
        return (
            "Open the map and use Route Planner. Compare shortest and safest route, then pick the safest one. "
            "If needed, choose police station or hospital as your destination."
        )
    if any(word in lower for word in ("helpline", "number", "call")):
        return (
            "Emergency numbers: 112 (Emergency), 100 (Police), 1091 (Women Helpline), "
            "181 (Domestic Violence), 1098 (Child Helpline)."
        )
    if any(word in lower for word in ("police", "hospital", "nearby")):
        return (
            "Use the full map page to see nearest police stations and hospitals in real time. "
            "Tap a marker to call directly or set it as destination."
        )
    return (
        "I am here with you. Tell me what is happening right now, where you are, and whether you are alone. "
        "If this is urgent, call 112 immediately."
    )


async def _openrouter_reply(req: ChatMessage) -> str:
    if not OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY is not configured")

    messages = [{"role": "system", "content": _system_prompt()}]
    messages.extend(_normalize_history(req.history or []))
    messages.append({"role": "user", "content": req.message.strip()})

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": OPENROUTER_SITE_URL,
        "X-Title": OPENROUTER_APP_NAME,
    }

    payload = {
        "model": OPENROUTER_MODEL,
        "messages": messages,
        "temperature": 0.25,
        "max_tokens": 260,
    }

    async with httpx.AsyncClient(timeout=OPENROUTER_TIMEOUT_SECONDS) as client:
        response = await client.post(OPENROUTER_URL, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    reply = _extract_reply_content(data)
    if not reply:
        raise ValueError("OpenRouter returned an empty response")
    return reply


@router.post("/message", response_model=ChatResponse)
async def chat_message(req: ChatMessage):
    """
    Process support chat message with:
    1) emergency keyword escalation
    2) OpenRouter free-model response
    3) deterministic fallback if provider fails
    """
    user_text = req.message.strip()
    if not user_text:
        return ChatResponse(
            reply="Please type a message so I can help you.",
            session_id=req.session_id,
            escalated=False,
            suggest_call=False,
        )

    escalated = _is_emergency(user_text)
    suggest_call = escalated

    if escalated:
        return ChatResponse(
            reply=_fallback_reply(user_text, escalated=True),
            session_id=req.session_id,
            escalated=True,
            suggest_call=True,
        )

    try:
        reply = await _openrouter_reply(req)
    except Exception:
        reply = _fallback_reply(user_text, escalated=False)

    return ChatResponse(
        reply=reply,
        session_id=req.session_id,
        escalated=False,
        suggest_call=False,
    )
