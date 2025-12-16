"""
Background job queue system for long-running operations.

Provides a SQLite-backed job queue with status tracking for operations
like re-embedding memories.
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import select

from ..db.core import get_session_maker, run_sync
from ..models import Job

logger = logging.getLogger(__name__)


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobManager:
    """Manages background jobs with database persistence."""

    async def create_job(self, job_type: str, params: dict | None = None) -> str:
        """Create a new job record. Returns job_id (UUID)."""
        job_id = str(uuid.uuid4())

        def _create():
            with get_session_maker()() as session:
                job = Job(
                    id=job_id,
                    type=job_type,
                    status=JobStatus.PENDING.value,
                    params=json.dumps(params) if params else None,
                )
                session.add(job)
                session.commit()
                return job_id

        return await run_sync(_create)

    async def get_job(self, job_id: str) -> dict | None:
        """Get job status and details."""
        def _get():
            with get_session_maker()() as session:
                job = session.get(Job, job_id)
                if not job:
                    return None
                return {
                    "id": job.id,
                    "type": job.type,
                    "status": job.status,
                    "params": json.loads(job.params) if job.params else None,
                    "result": json.loads(job.result) if job.result else None,
                    "error": job.error,
                    "progress": job.progress,
                    "processed": job.processed,
                    "failed": job.failed,
                    "total": job.total,
                    "created_at": job.created_at.isoformat() if job.created_at else None,
                    "started_at": job.started_at.isoformat() if job.started_at else None,
                    "completed_at": job.completed_at.isoformat() if job.completed_at else None,
                }

        return await run_sync(_get)

    async def update_job(self, job_id: str, **updates: Any) -> bool:
        """Update job fields."""
        def _update():
            with get_session_maker()() as session:
                job = session.get(Job, job_id)
                if not job:
                    return False

                for key, value in updates.items():
                    if key == "status" and isinstance(value, JobStatus):
                        value = value.value
                    if key == "result" and isinstance(value, dict):
                        value = json.dumps(value)
                    if hasattr(job, key):
                        setattr(job, key, value)

                session.commit()
                return True

        return await run_sync(_update)

    async def get_active_job(self, job_type: str) -> dict | None:
        """Get an active (pending or running) job of the given type."""
        def _get():
            with get_session_maker()() as session:
                job = session.execute(
                    select(Job).where(
                        Job.type == job_type,
                        Job.status.in_([JobStatus.PENDING.value, JobStatus.RUNNING.value])
                    ).order_by(Job.created_at.desc()).limit(1)
                ).scalars().first()

                if not job:
                    return None

                return {
                    "id": job.id,
                    "type": job.type,
                    "status": job.status,
                    "progress": job.progress,
                    "processed": job.processed,
                    "failed": job.failed,
                    "total": job.total,
                    "created_at": job.created_at.isoformat() if job.created_at else None,
                    "started_at": job.started_at.isoformat() if job.started_at else None,
                }

        return await run_sync(_get)

    async def mark_started(self, job_id: str) -> bool:
        """Mark a job as started."""
        return await self.update_job(
            job_id,
            status=JobStatus.RUNNING,
            started_at=datetime.utcnow()
        )

    async def mark_completed(self, job_id: str, result: dict | None = None) -> bool:
        """Mark a job as completed."""
        return await self.update_job(
            job_id,
            status=JobStatus.COMPLETED,
            progress=100,
            completed_at=datetime.utcnow(),
            result=result
        )

    async def mark_failed(self, job_id: str, error: str) -> bool:
        """Mark a job as failed."""
        return await self.update_job(
            job_id,
            status=JobStatus.FAILED,
            completed_at=datetime.utcnow(),
            error=error
        )


# Global job manager instance
job_manager = JobManager()


async def reembed_worker(job_id: str) -> None:
    """
    Unified background worker for processing all memories.

    This worker handles two phases:
    1. Generate embedding_summary for memories that don't have one, then embed
    2. Re-embed memories that have embedding_summary but stale/no embedding

    Progress is tracked across both phases for smooth UI updates.
    """
    from .embeddings import get_embedding, get_current_embedding_model
    from .ai_processing import generate_embedding_summary
    from ..db.crud import (
        count_memories_needing_processing,
        get_memories_without_embedding_summary,
        get_memories_needing_reembedding,
        update_memory_embedding,
        update_memory_embedding_summary,
        increment_processing_attempts,
    )

    try:
        await job_manager.mark_started(job_id)

        # Get current model and count total work
        current_model = get_current_embedding_model()
        counts = await count_memories_needing_processing(current_model)
        total = counts["total"]

        if total == 0:
            await job_manager.mark_completed(job_id, {"processed": 0, "failed": 0})
            return

        await job_manager.update_job(job_id, total=total)

        processed = 0
        failed = 0

        # ========== Phase 1: Generate summaries + embed ==========
        # Process memories that don't have embedding_summary yet
        summary_batch_size = 5  # Smaller batches for LLM calls

        while True:
            job = await job_manager.get_job(job_id)
            if not job or job["status"] == JobStatus.CANCELLED.value:
                logger.info(f"Job {job_id} was cancelled")
                break

            memories = await get_memories_without_embedding_summary(limit=summary_batch_size)
            if not memories:
                break

            batch_processed = 0
            batch_failed = 0

            for memory in memories:
                try:
                    content = memory.get("content", "")
                    title = memory.get("title", "")

                    if not content:
                        logger.warning(f"Skipping memory {memory['id']}: no content")
                        await increment_processing_attempts(memory["id"])
                        batch_failed += 1
                        continue

                    # Generate embedding summary
                    embedding_summary = await generate_embedding_summary(content, title)
                    if not embedding_summary:
                        logger.warning(f"Empty embedding_summary for memory {memory['id']}")
                        await increment_processing_attempts(memory["id"])
                        batch_failed += 1
                        continue

                    await update_memory_embedding_summary(memory["id"], embedding_summary)

                    # Immediately embed using the new summary
                    current_model = get_current_embedding_model()
                    embedding = await get_embedding(embedding_summary)
                    await update_memory_embedding(memory["id"], embedding, current_model)

                    batch_processed += 1
                    logger.debug(f"Generated summary and embedded memory {memory['id']}")

                except Exception as e:
                    logger.warning(f"Failed to process memory {memory['id']}: {e}")
                    await increment_processing_attempts(memory["id"])
                    batch_failed += 1

                # Delay between LLM calls
                await asyncio.sleep(0.3)

            processed += batch_processed
            failed += batch_failed

            # Update progress
            progress = int((processed + failed) / total * 100) if total > 0 else 100
            await job_manager.update_job(
                job_id,
                processed=processed,
                failed=failed,
                progress=min(progress, 99)
            )

            if batch_processed == 0 and batch_failed == len(memories):
                logger.warning(f"Job {job_id} phase 1: all {batch_failed} in batch failed, moving to phase 2")
                break

        # ========== Phase 2: Re-embed existing summaries ==========
        # Process memories that have embedding_summary but need (re)embedding
        embed_batch_size = 10

        while True:
            job = await job_manager.get_job(job_id)
            if not job or job["status"] == JobStatus.CANCELLED.value:
                logger.info(f"Job {job_id} was cancelled")
                break

            current_model = get_current_embedding_model()
            memories = await get_memories_needing_reembedding(current_model, limit=embed_batch_size)
            if not memories:
                break

            batch_processed = 0
            batch_failed = 0

            for memory in memories:
                try:
                    text = memory["embedding_summary"]
                    embedding = await get_embedding(text)
                    await update_memory_embedding(memory["id"], embedding, current_model)
                    batch_processed += 1
                    logger.debug(f"Re-embedded memory {memory['id']}")
                except Exception as e:
                    logger.warning(f"Re-embedding failed for memory {memory['id']}: {e}")
                    batch_failed += 1

                await asyncio.sleep(0.1)

            processed += batch_processed
            failed += batch_failed

            progress = int((processed + failed) / total * 100) if total > 0 else 100
            await job_manager.update_job(
                job_id,
                processed=processed,
                failed=failed,
                progress=min(progress, 99)
            )

            if batch_processed == 0 and batch_failed == len(memories):
                logger.warning(f"Job {job_id} phase 2: all {batch_failed} in batch failed, stopping")
                break

        await job_manager.mark_completed(job_id, {"processed": processed, "failed": failed})
        logger.info(f"Reembed job {job_id} completed: {processed} processed, {failed} failed")

    except Exception as e:
        logger.exception(f"Reembed job {job_id} failed with error: {e}")
        await job_manager.mark_failed(job_id, str(e))


