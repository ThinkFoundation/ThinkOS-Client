import json
import uuid as uuid_mod
from datetime import datetime
from sqlalchemy import select, update, func as sa_func

from ..core import get_session_maker, run_sync
from ...models import Skill, SkillExecution, SkillTrigger, Memory, MemoryTag, Tag


# ---------------------------------------------------------------------------
# Phase 1 functions (unchanged except get_skill which adds new fields)
# ---------------------------------------------------------------------------

async def get_skills() -> list[dict]:
    """Get all non-hidden skills (without prompt/definition)."""
    def _get():
        with get_session_maker()() as session:
            skills = session.execute(
                select(Skill).where(Skill.hidden == False).order_by(Skill.name)  # noqa: E712
            ).scalars().all()

            return [
                {
                    "id": s.id,
                    "name": s.name,
                    "description": s.description,
                    "icon": s.icon,
                    "logo": s.logo,
                    "version": s.version,
                    "category": s.category,
                    "tags": json.loads(s.tags) if s.tags else [],
                    "parameters": json.loads(s.parameters) if s.parameters else [],
                    "input": {
                        "type": s.input_type,
                        "accepts": json.loads(s.input_accepts) if s.input_accepts else None,
                    },
                }
                for s in skills
            ]

    return await run_sync(_get)


async def get_skill(skill_id: str) -> dict | None:
    """Get a single skill with prompt details."""
    def _get():
        with get_session_maker()() as session:
            skill = session.get(Skill, skill_id)
            if not skill:
                return None

            return {
                "id": skill.id,
                "name": skill.name,
                "description": skill.description,
                "icon": skill.icon,
                "logo": skill.logo,
                "version": skill.version,
                "category": skill.category,
                "tags": json.loads(skill.tags) if skill.tags else [],
                "parameters": json.loads(skill.parameters) if skill.parameters else [],
                "input": {
                    "type": skill.input_type,
                    "accepts": json.loads(skill.input_accepts) if skill.input_accepts else None,
                },
                "prompt": {
                    "system": skill.prompt_system,
                    "user_template": skill.prompt_user_template,
                },
                "source": skill.source,
                "hidden": skill.hidden,
                "author_name": skill.author_name,
                "author_url": skill.author_url,
                "output_format": skill.output_format,
                "created_at": skill.created_at.isoformat() if skill.created_at else None,
                "updated_at": skill.updated_at.isoformat() if skill.updated_at else None,
            }

    return await run_sync(_get)


async def get_skill_for_execution(skill_id: str) -> dict | None:
    """Get a single skill with all fields needed for execution."""
    def _get():
        with get_session_maker()() as session:
            skill = session.get(Skill, skill_id)
            if not skill:
                return None

            return {
                "id": skill.id,
                "name": skill.name,
                "icon": skill.icon,
                "input_type": skill.input_type,
                "input_accepts": skill.input_accepts,
                "parameters": skill.parameters,
                "prompt_system": skill.prompt_system,
                "prompt_user_template": skill.prompt_user_template,
                "output_format": skill.output_format,
            }

    return await run_sync(_get)


async def toggle_skill_visibility(skill_id: str, hidden: bool) -> bool:
    """Toggle a skill's hidden status. Returns False if skill not found."""
    def _toggle():
        with get_session_maker()() as session:
            skill = session.get(Skill, skill_id)
            if not skill:
                return False
            skill.hidden = hidden
            skill.updated_at = datetime.utcnow()
            session.commit()
            return True

    return await run_sync(_toggle)


async def create_execution(
    skill_id: str,
    memory_id: int,
    trigger_type: str,
    parameters: dict | None,
) -> int:
    """Create a new skill execution in 'running' status. Returns execution ID."""
    def _create():
        with get_session_maker()() as session:
            execution = SkillExecution(
                skill_id=skill_id,
                memory_id=memory_id,
                trigger_type=trigger_type,
                parameters=json.dumps(parameters) if parameters else None,
                status="running",
                started_at=datetime.utcnow(),
            )
            session.add(execution)
            session.commit()
            session.refresh(execution)
            return execution.id

    return await run_sync(_create)


async def update_execution_completed(execution_id: int, result: str) -> None:
    """Mark execution as completed with result text."""
    def _update():
        with get_session_maker()() as session:
            execution = session.get(SkillExecution, execution_id)
            if execution:
                execution.status = "completed"
                execution.result = result
                execution.completed_at = datetime.utcnow()
                session.commit()

    await run_sync(_update)


async def update_execution_failed(execution_id: int, error: str) -> None:
    """Mark execution as failed with error message."""
    def _update():
        with get_session_maker()() as session:
            execution = session.get(SkillExecution, execution_id)
            if execution:
                execution.status = "failed"
                execution.error = error
                execution.completed_at = datetime.utcnow()
                session.commit()

    await run_sync(_update)


async def get_skill_executions(memory_id: int) -> list[dict]:
    """Get all skill executions for a memory, with skill_name and skill_icon via JOIN."""
    def _get():
        with get_session_maker()() as session:
            results = session.execute(
                select(SkillExecution, Skill.name, Skill.icon, Skill.logo)
                .join(Skill, SkillExecution.skill_id == Skill.id)
                .where(SkillExecution.memory_id == memory_id)
                .order_by(SkillExecution.created_at.desc())
            ).all()

            return [
                {
                    "id": ex.id,
                    "skill_id": ex.skill_id,
                    "skill_name": skill_name,
                    "skill_icon": skill_icon,
                    "skill_logo": skill_logo,
                    "memory_id": ex.memory_id,
                    "trigger_type": ex.trigger_type,
                    "parameters": json.loads(ex.parameters) if ex.parameters else None,
                    "status": ex.status,
                    "result": ex.result,
                    "error": ex.error,
                    "started_at": ex.started_at.isoformat() if ex.started_at else None,
                    "completed_at": ex.completed_at.isoformat() if ex.completed_at else None,
                    "created_at": ex.created_at.isoformat() if ex.created_at else None,
                }
                for ex, skill_name, skill_icon, skill_logo in results
            ]

    return await run_sync(_get)


# ---------------------------------------------------------------------------
# Phase 2 functions
# ---------------------------------------------------------------------------

def _skill_to_full_dict(skill: Skill) -> dict:
    """Convert a Skill ORM object to a full response dict."""
    return {
        "id": skill.id,
        "name": skill.name,
        "description": skill.description,
        "icon": skill.icon,
        "logo": skill.logo,
        "version": skill.version,
        "category": skill.category,
        "tags": json.loads(skill.tags) if skill.tags else [],
        "source": skill.source,
        "hidden": skill.hidden,
        "author_name": skill.author_name,
        "author_url": skill.author_url,
        "parameters": json.loads(skill.parameters) if skill.parameters else [],
        "input": {
            "type": skill.input_type,
            "accepts": json.loads(skill.input_accepts) if skill.input_accepts else None,
        },
        "prompt": {
            "system": skill.prompt_system,
            "user_template": skill.prompt_user_template,
        },
        "output_format": skill.output_format,
        "created_at": skill.created_at.isoformat() if skill.created_at else None,
        "updated_at": skill.updated_at.isoformat() if skill.updated_at else None,
    }


async def get_all_skills(
    include_hidden: bool = False,
    source_filter: str | None = None,
    category_filter: str | None = None,
    search: str | None = None,
) -> list[dict]:
    """Get skills with filtering, annotated with execution stats."""
    def _get():
        with get_session_maker()() as session:
            # Subquery for execution stats per skill
            exec_stats = (
                select(
                    SkillExecution.skill_id,
                    sa_func.count(SkillExecution.id).label("execution_count"),
                    sa_func.max(SkillExecution.started_at).label("last_executed_at"),
                )
                .group_by(SkillExecution.skill_id)
                .subquery()
            )

            query = (
                select(
                    Skill,
                    exec_stats.c.execution_count,
                    exec_stats.c.last_executed_at,
                )
                .outerjoin(exec_stats, Skill.id == exec_stats.c.skill_id)
            )

            # Filters
            if not include_hidden:
                query = query.where(Skill.hidden == False)  # noqa: E712

            if source_filter:
                query = query.where(Skill.source == source_filter)

            if category_filter:
                query = query.where(Skill.category == category_filter)

            if search:
                like_pattern = f"%{search}%"
                query = query.where(
                    (Skill.name.ilike(like_pattern))
                    | (Skill.description.ilike(like_pattern))
                    | (Skill.tags.ilike(like_pattern))
                )

            query = query.order_by(Skill.name)
            results = session.execute(query).all()

            return [
                {
                    "id": s.id,
                    "name": s.name,
                    "description": s.description,
                    "icon": s.icon,
                    "logo": s.logo,
                    "version": s.version,
                    "category": s.category,
                    "tags": json.loads(s.tags) if s.tags else [],
                    "source": s.source,
                    "hidden": bool(s.hidden),
                    "author_name": s.author_name,
                    "parameters": json.loads(s.parameters) if s.parameters else [],
                    "input": {
                        "type": s.input_type,
                        "accepts": json.loads(s.input_accepts) if s.input_accepts else None,
                    },
                    "execution_count": exec_count or 0,
                    "last_executed_at": last_exec.isoformat() if last_exec else None,
                    "created_at": s.created_at.isoformat() if s.created_at else None,
                    "updated_at": s.updated_at.isoformat() if s.updated_at else None,
                }
                for s, exec_count, last_exec in results
            ]

    return await run_sync(_get)


async def create_user_skill(data: dict) -> dict:
    """Create a new user skill. Returns the full skill dict."""
    def _create():
        with get_session_maker()() as session:
            from ...services.skills.registry import generate_skill_json

            skill_id = data.get("id") or str(uuid_mod.uuid4())

            # Build row data for definition generation
            row_data = {
                "id": skill_id,
                "schema_version": 1,
                "name": data["name"],
                "description": data["description"],
                "icon": data["icon"],
                "logo": data.get("logo"),
                "version": data.get("version", "1.0.0"),
                "category": data.get("category", "custom"),
                "tags": json.dumps(data.get("tags", [])),
                "author_name": data.get("author_name"),
                "author_url": data.get("author_url"),
                "input_type": data.get("input_type", "single_memory"),
                "input_accepts": json.dumps(data["input_accepts"]) if data.get("input_accepts") else None,
                "parameters": json.dumps(data.get("parameters", [])),
                "prompt_system": data["prompt_system"],
                "prompt_user_template": data["prompt_user_template"],
                "output_format": data.get("output_format", "markdown"),
                "triggers": json.dumps(data.get("triggers")) if data.get("triggers") else None,
            }
            definition = generate_skill_json(row_data)

            skill = Skill(
                id=skill_id,
                schema_version=1,
                name=data["name"],
                description=data["description"],
                icon=data["icon"],
                logo=data.get("logo"),
                version=data.get("version", "1.0.0"),
                category=data.get("category", "custom"),
                tags=json.dumps(data.get("tags", [])),
                author_name=data.get("author_name"),
                author_url=data.get("author_url"),
                input_type=data.get("input_type", "single_memory"),
                input_accepts=json.dumps(data["input_accepts"]) if data.get("input_accepts") else None,
                parameters=json.dumps(data.get("parameters", [])),
                prompt_system=data["prompt_system"],
                prompt_user_template=data["prompt_user_template"],
                output_format=data.get("output_format", "markdown"),
                triggers=json.dumps(data.get("triggers")) if data.get("triggers") else None,
                source="user",
                hidden=False,
                definition=definition,
            )
            session.add(skill)
            session.commit()
            session.refresh(skill)
            return _skill_to_full_dict(skill)

    return await run_sync(_create)


async def update_user_skill(skill_id: str, data: dict) -> dict | str | None:
    """Update a user skill. Returns None if not found, 'builtin_protected' if builtin."""
    def _update():
        with get_session_maker()() as session:
            from ...services.skills.registry import generate_skill_json

            skill = session.get(Skill, skill_id)
            if not skill:
                return None
            if skill.source != "user":
                return "builtin_protected"

            # Update provided fields
            field_map = {
                "name": "name",
                "description": "description",
                "icon": "icon",
                "logo": "logo",
                "version": "version",
                "category": "category",
                "input_type": "input_type",
                "prompt_system": "prompt_system",
                "prompt_user_template": "prompt_user_template",
                "output_format": "output_format",
                "author_name": "author_name",
                "author_url": "author_url",
            }
            for data_key, attr_name in field_map.items():
                if data_key in data:
                    setattr(skill, attr_name, data[data_key])

            # JSON fields
            if "tags" in data:
                skill.tags = json.dumps(data["tags"])
            if "input_accepts" in data:
                skill.input_accepts = json.dumps(data["input_accepts"]) if data["input_accepts"] else None
            if "parameters" in data:
                skill.parameters = json.dumps(data["parameters"])

            skill.updated_at = datetime.utcnow()

            # Regenerate definition
            row_data = {
                "id": skill.id,
                "schema_version": skill.schema_version,
                "name": skill.name,
                "description": skill.description,
                "icon": skill.icon,
                "logo": skill.logo,
                "version": skill.version,
                "category": skill.category,
                "tags": skill.tags,
                "author_name": skill.author_name,
                "author_url": skill.author_url,
                "input_type": skill.input_type,
                "input_accepts": skill.input_accepts,
                "parameters": skill.parameters,
                "prompt_system": skill.prompt_system,
                "prompt_user_template": skill.prompt_user_template,
                "output_format": skill.output_format,
                "triggers": skill.triggers,
            }
            skill.definition = generate_skill_json(row_data)

            session.commit()
            session.refresh(skill)
            return _skill_to_full_dict(skill)

    return await run_sync(_update)


async def delete_user_skill(skill_id: str) -> str:
    """Delete a user skill and its executions. Returns 'deleted', 'not_found', or 'builtin_protected'."""
    def _delete():
        with get_session_maker()() as session:
            skill = session.get(Skill, skill_id)
            if not skill:
                return "not_found"
            if skill.source != "user":
                return "builtin_protected"

            # Mark any running executions as failed before deletion
            session.execute(
                update(SkillExecution)
                .where(SkillExecution.skill_id == skill_id)
                .where(SkillExecution.status == "running")
                .values(status="failed", error="Skill deleted", completed_at=datetime.utcnow())
            )

            session.delete(skill)
            session.commit()
            return "deleted"

    return await run_sync(_delete)


async def get_skill_execution_history(
    skill_id: str | None = None,
    memory_id: int | None = None,
    status: str | None = None,
    search: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """Get execution history with pagination and filters. Returns (executions, total)."""
    def _get():
        with get_session_maker()() as session:
            # Base query with JOINs
            base = (
                select(
                    SkillExecution,
                    Skill.name.label("skill_name"),
                    Skill.icon.label("skill_icon"),
                    Skill.logo.label("skill_logo"),
                    Memory.title.label("memory_title"),
                    Memory.type.label("memory_type"),
                )
                .join(Skill, SkillExecution.skill_id == Skill.id)
                .join(Memory, SkillExecution.memory_id == Memory.id)
            )

            # Apply filters
            if skill_id:
                base = base.where(SkillExecution.skill_id == skill_id)
            if memory_id:
                base = base.where(SkillExecution.memory_id == memory_id)
            if status:
                base = base.where(SkillExecution.status == status)
            if search:
                base = base.where(Memory.title.ilike(f"%{search}%"))

            # Count total
            count_query = select(sa_func.count()).select_from(base.subquery())
            total = session.execute(count_query).scalar() or 0

            # Paginated results
            query = base.order_by(SkillExecution.created_at.desc()).offset(offset).limit(limit)
            results = session.execute(query).all()

            executions = []
            for ex, skill_name, skill_icon, skill_logo, memory_title, memory_type in results:
                duration = None
                if ex.started_at and ex.completed_at:
                    duration = round((ex.completed_at - ex.started_at).total_seconds(), 1)

                executions.append({
                    "id": ex.id,
                    "skill_id": ex.skill_id,
                    "skill_name": skill_name,
                    "skill_icon": skill_icon,
                    "skill_logo": skill_logo,
                    "memory_id": ex.memory_id,
                    "memory_title": memory_title,
                    "memory_type": memory_type,
                    "trigger_type": ex.trigger_type,
                    "parameters": json.loads(ex.parameters) if ex.parameters else None,
                    "status": ex.status,
                    "result": ex.result,
                    "error": ex.error,
                    "duration_seconds": duration,
                    "started_at": ex.started_at.isoformat() if ex.started_at else None,
                    "completed_at": ex.completed_at.isoformat() if ex.completed_at else None,
                    "created_at": ex.created_at.isoformat() if ex.created_at else None,
                })

            return executions, total

    return await run_sync(_get)


async def get_skill_stats(skill_id: str) -> dict:
    """Get aggregated execution stats for a skill."""
    def _get():
        with get_session_maker()() as session:
            result = session.execute(
                select(
                    sa_func.count(SkillExecution.id).label("execution_count"),
                    sa_func.sum(
                        sa_func.case(
                            (SkillExecution.status == "completed", 1),
                            else_=0,
                        )
                    ).label("success_count"),
                    sa_func.max(SkillExecution.started_at).label("last_executed_at"),
                )
                .where(SkillExecution.skill_id == skill_id)
            ).first()

            return {
                "execution_count": result.execution_count or 0,
                "success_count": result.success_count or 0,
                "last_executed_at": result.last_executed_at.isoformat() if result.last_executed_at else None,
            }

    return await run_sync(_get)


async def get_skill_raw(skill_id: str) -> dict | None:
    """Get all columns of a skill as raw values (for export)."""
    def _get():
        with get_session_maker()() as session:
            skill = session.get(Skill, skill_id)
            if not skill:
                return None
            return {
                "id": skill.id,
                "schema_version": skill.schema_version,
                "name": skill.name,
                "description": skill.description,
                "icon": skill.icon,
                "logo": skill.logo,
                "version": skill.version,
                "category": skill.category,
                "tags": skill.tags,
                "author_name": skill.author_name,
                "author_url": skill.author_url,
                "input_type": skill.input_type,
                "input_accepts": skill.input_accepts,
                "parameters": skill.parameters,
                "prompt_system": skill.prompt_system,
                "prompt_user_template": skill.prompt_user_template,
                "output_format": skill.output_format,
                "triggers": skill.triggers,
                "source": skill.source,
                "hidden": skill.hidden,
                "definition": skill.definition,
                "created_at": skill.created_at,
                "updated_at": skill.updated_at,
            }

    return await run_sync(_get)


# ---------------------------------------------------------------------------
# Phase 3: Trigger CRUD
# ---------------------------------------------------------------------------

def _trigger_to_dict(trigger: SkillTrigger) -> dict:
    """Convert a SkillTrigger ORM object to a dict."""
    return {
        "id": trigger.id,
        "skill_id": trigger.skill_id,
        "name": trigger.name,
        "description": trigger.description,
        "enabled": bool(trigger.enabled),
        "event_type": trigger.event_type,
        "conditions": json.loads(trigger.conditions),
        "parameters": json.loads(trigger.parameters) if trigger.parameters else None,
        "execution_count": trigger.execution_count,
        "last_triggered_at": trigger.last_triggered_at.isoformat() if trigger.last_triggered_at else None,
        "created_at": trigger.created_at.isoformat() if trigger.created_at else None,
        "updated_at": trigger.updated_at.isoformat() if trigger.updated_at else None,
    }


async def get_skill_triggers(skill_id: str) -> list[dict]:
    """Get all triggers for a skill."""
    def _get():
        with get_session_maker()() as session:
            triggers = session.execute(
                select(SkillTrigger)
                .where(SkillTrigger.skill_id == skill_id)
                .order_by(SkillTrigger.created_at.desc())
            ).scalars().all()
            return [_trigger_to_dict(t) for t in triggers]

    return await run_sync(_get)


async def get_enabled_triggers() -> list[dict]:
    """Get all enabled triggers with skill info (for evaluator)."""
    def _get():
        with get_session_maker()() as session:
            results = session.execute(
                select(SkillTrigger, Skill.name.label("skill_name"), Skill.icon.label("skill_icon"))
                .join(Skill, SkillTrigger.skill_id == Skill.id)
                .where(SkillTrigger.enabled == True)  # noqa: E712
            ).all()
            return [
                {**_trigger_to_dict(t), "skill_name": skill_name, "skill_icon": skill_icon}
                for t, skill_name, skill_icon in results
            ]

    return await run_sync(_get)


async def create_trigger(skill_id: str, data: dict) -> dict | None:
    """Create a new trigger. Returns None if skill not found."""
    def _create():
        with get_session_maker()() as session:
            skill = session.get(Skill, skill_id)
            if not skill:
                return None
            trigger = SkillTrigger(
                skill_id=skill_id,
                name=data["name"],
                description=data.get("description"),
                event_type=data.get("event_type", "on_save"),
                conditions=json.dumps(data["conditions"]),
                parameters=json.dumps(data["parameters"]) if data.get("parameters") else None,
            )
            session.add(trigger)
            session.commit()
            session.refresh(trigger)
            return _trigger_to_dict(trigger)

    return await run_sync(_create)


async def update_trigger(trigger_id: int, data: dict) -> dict | None:
    """Update a trigger. Returns None if not found."""
    def _update():
        with get_session_maker()() as session:
            trigger = session.get(SkillTrigger, trigger_id)
            if not trigger:
                return None
            if "name" in data:
                trigger.name = data["name"]
            if "description" in data:
                trigger.description = data["description"]
            if "conditions" in data:
                trigger.conditions = json.dumps(data["conditions"])
            if "parameters" in data:
                trigger.parameters = json.dumps(data["parameters"]) if data["parameters"] else None
            if "enabled" in data:
                trigger.enabled = data["enabled"]
            trigger.updated_at = datetime.utcnow()
            session.commit()
            session.refresh(trigger)
            return _trigger_to_dict(trigger)

    return await run_sync(_update)


async def delete_trigger(trigger_id: int) -> bool:
    """Delete a trigger. Returns False if not found."""
    def _delete():
        with get_session_maker()() as session:
            trigger = session.get(SkillTrigger, trigger_id)
            if not trigger:
                return False
            session.delete(trigger)
            session.commit()
            return True

    return await run_sync(_delete)


async def toggle_trigger(trigger_id: int, enabled: bool) -> dict | None:
    """Toggle a trigger's enabled status. Returns None if not found."""
    def _toggle():
        with get_session_maker()() as session:
            trigger = session.get(SkillTrigger, trigger_id)
            if not trigger:
                return None
            trigger.enabled = enabled
            trigger.updated_at = datetime.utcnow()
            session.commit()
            session.refresh(trigger)
            return _trigger_to_dict(trigger)

    return await run_sync(_toggle)


async def update_trigger_stats(trigger_id: int) -> None:
    """Increment execution_count and update last_triggered_at."""
    def _update():
        with get_session_maker()() as session:
            trigger = session.get(SkillTrigger, trigger_id)
            if trigger:
                trigger.execution_count += 1
                trigger.last_triggered_at = datetime.utcnow()
                session.commit()

    await run_sync(_update)


async def get_matching_memories(conditions: dict, limit: int = 10) -> tuple[list[dict], int, int]:
    """Evaluate conditions against all memories for preview. Returns (matching, match_count, total)."""
    def _get():
        with get_session_maker()() as session:
            from ...services.skills.triggers import evaluate_conditions

            all_memories = session.execute(
                select(Memory).order_by(Memory.created_at.desc())
            ).scalars().all()
            total = len(all_memories)

            # Batch-load tags
            tags_by_memory: dict[int, list[dict]] = {}
            if all_memories:
                memory_ids = [m.id for m in all_memories]
                all_tags = session.execute(
                    select(MemoryTag, Tag)
                    .join(Tag, MemoryTag.tag_id == Tag.id)
                    .where(MemoryTag.memory_id.in_(memory_ids))
                ).all()
                for mt, tag in all_tags:
                    tags_by_memory.setdefault(mt.memory_id, []).append(
                        {"id": tag.id, "name": tag.name, "source": mt.source}
                    )

            matching = []
            for m in all_memories:
                mem_dict = {
                    "id": m.id, "type": m.type, "title": m.title, "url": m.url,
                    "content": m.content, "tags": tags_by_memory.get(m.id, []),
                    "transcript": m.transcript, "media_source": m.media_source,
                }
                if evaluate_conditions(conditions, mem_dict):
                    matching.append({
                        "id": m.id,
                        "title": m.title,
                        "type": m.type,
                        "tags": [t["name"] for t in tags_by_memory.get(m.id, [])],
                    })

            return matching[:limit], len(matching), total

    return await run_sync(_get)


async def get_skills_with_chat_triggers() -> list[dict]:
    """Get all non-hidden skills that have chat trigger patterns defined."""
    def _get():
        with get_session_maker()() as session:
            skills = session.execute(
                select(Skill)
                .where(Skill.hidden == False)  # noqa: E712
                .where(Skill.triggers.isnot(None))
                .order_by(Skill.name)
            ).scalars().all()

            result = []
            for s in skills:
                triggers = json.loads(s.triggers) if s.triggers else {}
                if "chat" not in triggers:
                    continue
                result.append({
                    "id": s.id,
                    "name": s.name,
                    "icon": s.icon,
                    "input_accepts": s.input_accepts,
                    "triggers": s.triggers,
                })
            return result

    return await run_sync(_get)
