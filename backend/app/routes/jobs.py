"""
Jobs API endpoints for background task management.

Provides endpoints to start, monitor, and cancel background jobs
like re-embedding operations.
"""

import asyncio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.jobs import job_manager, reembed_worker, JobStatus

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


class JobResponse(BaseModel):
    id: str
    type: str
    status: str
    progress: int
    processed: int
    failed: int
    total: int
    error: str | None = None
    created_at: str | None = None
    started_at: str | None = None
    completed_at: str | None = None


class CreateJobResponse(BaseModel):
    id: str
    type: str
    status: str
    is_new: bool  # Whether a new job was created or existing one returned


@router.post("/reembed", response_model=CreateJobResponse)
async def create_reembed_job():
    """
    Start a background job to process all memories.

    This unified job handles:
    1. Generating embedding_summary for memories that don't have one
    2. Creating/updating embeddings using the embedding_summary

    If a job is already running, returns the existing job
    instead of creating a duplicate.
    """
    # Check if there's already an active reembed job
    existing = await job_manager.get_active_job("reembed")
    if existing:
        return CreateJobResponse(
            id=existing["id"],
            type=existing["type"],
            status=existing["status"],
            is_new=False,
        )

    # Create new job
    job_id = await job_manager.create_job("reembed")

    # Start background task
    asyncio.create_task(reembed_worker(job_id))

    return CreateJobResponse(
        id=job_id,
        type="reembed",
        status=JobStatus.PENDING.value,
        is_new=True,
    )


@router.get("/{job_id}", response_model=JobResponse)
async def get_job_status(job_id: str):
    """Get status and progress of a job."""
    job = await job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return JobResponse(
        id=job["id"],
        type=job["type"],
        status=job["status"],
        progress=job["progress"],
        processed=job["processed"],
        failed=job["failed"],
        total=job["total"],
        error=job["error"],
        created_at=job["created_at"],
        started_at=job["started_at"],
        completed_at=job["completed_at"],
    )


@router.post("/{job_id}/cancel", response_model=JobResponse)
async def cancel_job(job_id: str):
    """
    Cancel a running or pending job.

    The job will be marked as cancelled and the worker will stop
    processing at the next checkpoint.
    """
    job = await job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job["status"] not in [JobStatus.PENDING.value, JobStatus.RUNNING.value]:
        raise HTTPException(
            status_code=400,
            detail=f"Job cannot be cancelled (status: {job['status']})"
        )

    await job_manager.update_job(job_id, status=JobStatus.CANCELLED)

    # Re-fetch to get updated status
    job = await job_manager.get_job(job_id)
    return JobResponse(
        id=job["id"],
        type=job["type"],
        status=job["status"],
        progress=job["progress"],
        processed=job["processed"],
        failed=job["failed"],
        total=job["total"],
        error=job["error"],
        created_at=job["created_at"],
        started_at=job["started_at"],
        completed_at=job["completed_at"],
    )
