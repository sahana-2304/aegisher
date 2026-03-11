"""
AegisHer Backend - FastAPI Application
"""
from pathlib import Path

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from dotenv import load_dotenv

from routers import risk, routes, sos, community, police, auth, chat, nearby
from services.firebase import init_firebase

load_dotenv(Path(__file__).resolve().parent / ".env")

app = FastAPI(
    title="AegisHer API",
    description="Women's Safety Platform - AI-powered risk prediction, emergency response, and community intelligence",
    version="1.0.0",
)

# Middleware
app.add_middleware(GZipMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Initialize Firebase on startup
@app.on_event("startup")
async def startup():
    init_firebase()


# Routers
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(risk.router, prefix="/api/risk", tags=["Risk Prediction"])
app.include_router(routes.router, prefix="/api/routes", tags=["Safe Routing"])
app.include_router(sos.router, prefix="/api/sos", tags=["Emergency SOS"])
app.include_router(community.router, prefix="/api/community", tags=["Community"])
app.include_router(police.router, prefix="/api/police", tags=["Police Assistance"])
app.include_router(nearby.router, prefix="/api/nearby", tags=["Nearby Services"])
app.include_router(chat.router, prefix="/api/chat", tags=["Helpline Chat"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "AegisHer API"}
