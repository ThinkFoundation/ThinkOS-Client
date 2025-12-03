from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .db import is_db_initialized
from .routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="Think API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths that don't require unlock
PUBLIC_PATHS = {"/health", "/api/auth/status", "/api/auth/setup", "/api/auth/unlock"}


@app.middleware("http")
async def require_unlock_middleware(request: Request, call_next):
    """Block requests to protected endpoints if DB is not unlocked."""
    if request.url.path not in PUBLIC_PATHS and not is_db_initialized():
        return JSONResponse(
            status_code=403,
            content={"detail": "Database not unlocked"}
        )
    return await call_next(request)


@app.get("/health")
async def health():
    return {"status": "ok"}


app.include_router(router)
