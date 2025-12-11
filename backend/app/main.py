import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .db import is_db_initialized
from .routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start native messaging socket server for secure extension communication
    from .native_messaging import start_native_messaging_server, stop_native_messaging_server

    await start_native_messaging_server()
    yield
    await stop_native_messaging_server()


app = FastAPI(title="Think API", lifespan=lifespan)

# CORS restricted to Electron app origins only
# Browser extension uses native messaging (no HTTP), so it doesn't need CORS access
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "file://",  # Electron production (loads from file://)
        "app://.",  # Electron custom protocol (if used)
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths that don't require unlock
PUBLIC_PATHS = {"/health", "/api/auth/status", "/api/auth/setup", "/api/auth/unlock"}


@app.middleware("http")
async def require_unlock_middleware(request: Request, call_next):
    """Block requests to protected endpoints if DB is not unlocked."""
    # Allow CORS preflight requests (OPTIONS) to pass through
    if request.method == "OPTIONS":
        return await call_next(request)

    if request.url.path not in PUBLIC_PATHS and not is_db_initialized():
        return JSONResponse(
            status_code=403,
            content={"detail": "Database not unlocked"}
        )
    return await call_next(request)


@app.middleware("http")
async def require_app_token_middleware(request: Request, call_next):
    """Validate X-App-Token header on all requests.

    This ensures only the Electron app can access the API.
    In dev mode (no token set), validation is bypassed.
    """
    # Allow CORS preflight requests (OPTIONS) to pass through
    if request.method == "OPTIONS":
        return await call_next(request)

    app_token = os.environ.get("THINK_APP_TOKEN", "")
    if not app_token:
        # Dev mode: no token configured, allow all requests
        return await call_next(request)

    request_token = request.headers.get("X-App-Token")
    if request_token != app_token:
        return JSONResponse(
            status_code=401,
            content={"detail": "Unauthorized: Invalid or missing app token"}
        )

    return await call_next(request)


@app.get("/health")
async def health():
    return {"status": "ok"}


app.include_router(router)
