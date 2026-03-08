"""
Helpline Chat Router
AI chatbot with automatic escalation to human operator
"""
from fastapi import APIRouter
from models.schemas import ChatMessage, ChatResponse
import re

router = APIRouter()

# Escalation trigger keywords
ESCALATION_KEYWORDS = re.compile(
    r"\b(help|danger|scared|unsafe|emergency|hurt|attack|follow|stalking|threat|violence|assault|"
    r"rape|harass|abuse|trapped|missing|kidnap|murder)\b",
    re.IGNORECASE
)

# Bot response tree
BOT_RESPONSES = {
    "greeting": "Hello! I'm your AegisHer safety assistant. Are you safe right now? If you're in immediate danger, please press the red SOS button.",
    "safe_query": "I'm here to help. You can ask me about safe routes, helpline numbers, or report an unsafe area. What do you need?",
    "location_help": "To find the safest route, use the Safe Route feature on your map. I can also show you the nearest police station.",
    "helpline_info": "Key helplines: Women Helpline 1091, Police 100, Emergency 112, Domestic Violence 181, Child Helpline 1098.",
    "escalation": "I'm connecting you with a live human safety operator immediately. Please stay on the line. You are not alone.",
    "default": "I hear you. Can you tell me more about what's happening? Are you currently safe?",
}

KEYWORD_RESPONSES = {
    "route": "location_help",
    "safe": "safe_query",
    "helpline": "helpline_info",
    "number": "helpline_info",
    "hello": "greeting",
    "hi": "greeting",
}


@router.post("/message", response_model=ChatResponse)
async def chat_message(req: ChatMessage):
    """
    Process chat message.
    Detects danger keywords → escalates to human operator.
    Returns appropriate bot/operator response.
    """
    escalated = bool(ESCALATION_KEYWORDS.search(req.message))
    suggest_call = escalated

    if escalated:
        reply = BOT_RESPONSES["escalation"]
    else:
        # Simple keyword matching (production: replace with LLM or NLP classifier)
        reply = BOT_RESPONSES["default"]
        for keyword, response_key in KEYWORD_RESPONSES.items():
            if keyword in req.message.lower():
                reply = BOT_RESPONSES[response_key]
                break

    return ChatResponse(
        reply=reply,
        session_id=req.session_id,
        escalated=escalated,
        suggest_call=suggest_call,
    )