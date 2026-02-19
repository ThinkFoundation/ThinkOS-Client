import json
import logging
import uuid as uuid_mod
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel

from ..db.crud.skills import (
    get_skill,
    get_skill_raw,
    get_all_skills,
    toggle_skill_visibility,
    get_skill_executions,
    get_skill_execution_history,
    create_user_skill,
    update_user_skill,
    delete_user_skill,
    get_skill_triggers,
    create_trigger,
    update_trigger,
    delete_trigger,
    toggle_trigger,
    get_matching_memories,
)
from ..services.skills.executor import execute_skill, test_execute
from ..services.skills.registry import validate_skill_json, generate_skill_json

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["skills"])


# ---------------------------------------------------------------------------
# Pydantic Request Models
# ---------------------------------------------------------------------------

class SkillExecuteRequest(BaseModel):
    skill_id: str
    memory_id: int
    parameters: dict | None = None


class SkillVisibilityRequest(BaseModel):
    hidden: bool


class SkillCreateRequest(BaseModel):
    name: str
    description: str
    icon: str
    category: str = "custom"
    tags: list[str] = []
    input_type: str = "single_memory"
    input_accepts: list[str] | None = None
    parameters: list[dict] = []
    prompt_system: str
    prompt_user_template: str
    output_format: str = "markdown"
    author_name: str | None = None
    author_url: str | None = None
    logo: str | None = None


class SkillUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    icon: str | None = None
    logo: str | None = None
    category: str | None = None
    tags: list[str] | None = None
    input_type: str | None = None
    input_accepts: list[str] | None = None
    parameters: list[dict] | None = None
    prompt_system: str | None = None
    prompt_user_template: str | None = None
    output_format: str | None = None
    author_name: str | None = None
    author_url: str | None = None


class SkillTestRequest(BaseModel):
    memory_id: int
    prompt_system: str
    prompt_user_template: str
    parameters: list[dict] | None = None
    parameter_values: dict | None = None
    input_accepts: list[str] | None = None
    output_format: str = "markdown"


class SkillValidateRequest(BaseModel):
    definition: str


class SkillImportRequest(BaseModel):
    definition: str
    conflict_resolution: str = "copy"  # "copy" or "replace"


class TriggerCreateRequest(BaseModel):
    name: str
    description: str | None = None
    event_type: str = "on_save"
    conditions: dict
    parameters: dict | None = None


class TriggerUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    conditions: dict | None = None
    parameters: dict | None = None
    enabled: bool | None = None


class TriggerToggleRequest(BaseModel):
    enabled: bool


class TriggerPreviewRequest(BaseModel):
    conditions: dict


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parsed_to_crud_data(parsed: dict) -> dict:
    """Convert parsed .think-skill JSON to CRUD data dict."""
    prompt = parsed.get("prompt", {})
    input_config = parsed.get("input", {})
    author = parsed.get("author", {})
    return {
        "id": parsed.get("id"),
        "name": parsed["name"],
        "description": parsed["description"],
        "icon": parsed["icon"],
        "logo": parsed.get("logo"),
        "version": parsed.get("version", "1.0.0"),
        "category": parsed.get("category", "custom"),
        "tags": parsed.get("tags", []),
        "author_name": author.get("name") if author else None,
        "author_url": author.get("url") if author else None,
        "input_type": input_config.get("type", "single_memory"),
        "input_accepts": input_config.get("accepts"),
        "parameters": parsed.get("parameters", []),
        "prompt_system": prompt["system"],
        "prompt_user_template": prompt["user_template"],
        "output_format": parsed.get("output", {}).get("format", "markdown"),
        "triggers": parsed.get("triggers"),
    }


# ---------------------------------------------------------------------------
# Routes — Fixed paths MUST come before /skills/{skill_id}
# ---------------------------------------------------------------------------

@router.get("/skills")
async def list_skills(
    include_hidden: bool = Query(False),
    source: str | None = Query(None),
    category: str | None = Query(None),
    search: str | None = Query(None),
):
    """Get all skills with optional filtering."""
    return await get_all_skills(
        include_hidden=include_hidden,
        source_filter=source,
        category_filter=category,
        search=search,
    )


@router.get("/skills/executions")
async def list_executions(
    memory_id: int | None = Query(None),
    skill_id: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """Get execution history with pagination and filters."""
    # Backwards compatibility: if only memory_id given, use the simple function
    if memory_id and not skill_id and not status and not search and limit == 20 and offset == 0:
        return await get_skill_executions(memory_id)

    executions, total = await get_skill_execution_history(
        skill_id=skill_id,
        memory_id=memory_id,
        status=status,
        search=search,
        limit=limit,
        offset=offset,
    )
    return {
        "executions": executions,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/skills/execute")
async def execute_skill_endpoint(request: SkillExecuteRequest):
    """Execute a skill against a memory. Returns SSE stream."""

    async def generate():
        async for event in execute_skill(
            skill_id=request.skill_id,
            memory_id=request.memory_id,
            parameters=request.parameters,
        ):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@router.post("/skills/test")
async def test_skill_endpoint(request: SkillTestRequest):
    """Test-run a skill without DB tracking. Returns SSE stream."""

    async def generate():
        async for event in test_execute(
            memory_id=request.memory_id,
            prompt_system=request.prompt_system,
            prompt_user_template=request.prompt_user_template,
            parameters_def=request.parameters,
            parameter_values=request.parameter_values,
            input_accepts=request.input_accepts,
            output_format=request.output_format,
        ):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@router.post("/skills/validate")
async def validate_skill_endpoint(request: SkillValidateRequest):
    """Validate a .think-skill JSON string."""
    valid, errors, warnings, parsed = validate_skill_json(request.definition)

    if valid:
        return {
            "valid": True,
            "warnings": warnings,
            "parsed": {"name": parsed.get("name"), "id": parsed.get("id")} if parsed else None,
        }
    return {
        "valid": False,
        "errors": errors,
        "warnings": warnings,
        "parsed": None,
    }


@router.post("/skills/import")
async def import_skill(request: SkillImportRequest):
    """Import a .think-skill file."""
    # 1. Validate
    valid, errors, warnings, parsed = validate_skill_json(request.definition)
    if not valid:
        raise HTTPException(
            status_code=400,
            detail={"message": "Invalid skill definition", "errors": errors},
        )

    skill_id = parsed["id"]

    # 2. Check for ID collision
    existing = await get_skill(skill_id)

    if existing:
        if request.conflict_resolution == "replace":
            existing_raw = await get_skill_raw(skill_id)
            if existing_raw and existing_raw["source"] != "user":
                raise HTTPException(
                    status_code=403,
                    detail="Cannot replace a built-in skill. Use 'copy' instead.",
                )
            import_data = _parsed_to_crud_data(parsed)
            result = await update_user_skill(skill_id, import_data)
            return result
        else:
            # "copy" - generate new UUID
            parsed["id"] = str(uuid_mod.uuid4())

    # 3. Create the skill
    import_data = _parsed_to_crud_data(parsed)
    result = await create_user_skill(import_data)
    return result


@router.post("/skills/triggers/preview")
async def preview_trigger(request: TriggerPreviewRequest):
    """Preview which existing memories would match the given conditions."""
    if "rules" not in request.conditions:
        raise HTTPException(400, "conditions must contain 'rules'")

    matching, match_count, total = await get_matching_memories(request.conditions)
    return {
        "matching_count": match_count,
        "matching_memories": matching,
        "total_memories": total,
    }


@router.post("/skills")
async def create_skill(request: SkillCreateRequest):
    """Create a new user skill."""
    # Validation
    if not request.name.strip():
        raise HTTPException(400, "name cannot be empty")
    if len(request.name) > 60:
        raise HTTPException(400, "name must be 60 characters or less")
    if not request.description.strip():
        raise HTTPException(400, "description cannot be empty")
    if len(request.description) > 200:
        raise HTTPException(400, "description must be 200 characters or less")
    if not request.prompt_system.strip():
        raise HTTPException(400, "prompt_system cannot be empty")
    if "{{content}}" not in request.prompt_user_template:
        raise HTTPException(400, "prompt_user_template must contain {{content}}")
    if request.logo and len(request.logo.encode("utf-8")) > 32 * 1024:
        raise HTTPException(400, "logo exceeds 32KB limit")

    return await create_user_skill(request.model_dump())


# ---------------------------------------------------------------------------
# Routes with {skill_id} — MUST come after fixed paths
# ---------------------------------------------------------------------------

@router.get("/skills/{skill_id}")
async def get_skill_detail(skill_id: str):
    """Get a single skill with prompt details and triggers."""
    skill = await get_skill(skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    skill["triggers"] = await get_skill_triggers(skill_id)
    return skill


@router.put("/skills/{skill_id}")
async def update_skill(skill_id: str, request: SkillUpdateRequest):
    """Update a user skill (only source='user' skills can be updated)."""
    data = request.model_dump(exclude_unset=True)

    if "name" in data and data["name"] is not None:
        if not data["name"].strip():
            raise HTTPException(400, "name cannot be empty")
        if len(data["name"]) > 60:
            raise HTTPException(400, "name must be 60 characters or less")

    if "description" in data and data["description"] is not None:
        if not data["description"].strip():
            raise HTTPException(400, "description cannot be empty")
        if len(data["description"]) > 200:
            raise HTTPException(400, "description must be 200 characters or less")

    if "prompt_user_template" in data and data["prompt_user_template"] is not None:
        if "{{content}}" not in data["prompt_user_template"]:
            raise HTTPException(400, "prompt_user_template must contain {{content}}")
    if "logo" in data and data["logo"] is not None:
        if len(data["logo"].encode("utf-8")) > 32 * 1024:
            raise HTTPException(400, "logo exceeds 32KB limit")

    result = await update_user_skill(skill_id, data)
    if result is None:
        raise HTTPException(404, "Skill not found")
    if result == "builtin_protected":
        raise HTTPException(403, "Built-in skills cannot be edited")
    return result


@router.delete("/skills/{skill_id}")
async def delete_skill(skill_id: str):
    """Delete a user skill and its execution history."""
    result = await delete_user_skill(skill_id)
    if result == "not_found":
        raise HTTPException(404, "Skill not found")
    if result == "builtin_protected":
        raise HTTPException(403, "Built-in skills cannot be deleted")
    return {"deleted": True}


@router.get("/skills/{skill_id}/export")
async def export_skill(skill_id: str):
    """Export a skill as .think-skill JSON."""
    skill_raw = await get_skill_raw(skill_id)
    if not skill_raw:
        raise HTTPException(404, "Skill not found")

    # Built-in: return original definition. User: regenerate from DB columns.
    if skill_raw["source"] == "builtin" and skill_raw.get("definition"):
        json_content = skill_raw["definition"]
    else:
        json_content = generate_skill_json(skill_raw)

    # Slugify name for filename
    safe_name = skill_raw["name"].lower().replace(" ", "-")
    safe_name = "".join(c for c in safe_name if c.isalnum() or c == "-")

    return Response(
        content=json_content,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}.think-skill"',
        },
    )


@router.patch("/skills/{skill_id}/visibility")
async def update_skill_visibility(skill_id: str, body: SkillVisibilityRequest):
    """Toggle a skill's hidden status."""
    success = await toggle_skill_visibility(skill_id, body.hidden)
    if not success:
        raise HTTPException(status_code=404, detail="Skill not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Trigger Routes
# ---------------------------------------------------------------------------

@router.get("/skills/{skill_id}/triggers")
async def list_triggers(skill_id: str):
    """Get all triggers for a skill."""
    skill = await get_skill(skill_id)
    if not skill:
        raise HTTPException(404, "Skill not found")
    return await get_skill_triggers(skill_id)


@router.post("/skills/{skill_id}/triggers")
async def create_trigger_endpoint(skill_id: str, request: TriggerCreateRequest):
    """Create a new trigger for a skill."""
    if not request.name.strip():
        raise HTTPException(400, "name cannot be empty")
    if len(request.name) > 200:
        raise HTTPException(400, "name must be 200 characters or less")
    if "rules" not in request.conditions:
        raise HTTPException(400, "conditions must contain 'rules'")
    if not request.conditions.get("rules"):
        raise HTTPException(400, "conditions must have at least one rule")

    result = await create_trigger(skill_id, request.model_dump())
    if result is None:
        raise HTTPException(404, "Skill not found")
    return result


@router.put("/skills/triggers/{trigger_id}")
async def update_trigger_endpoint(trigger_id: int, request: TriggerUpdateRequest):
    """Update a trigger."""
    data = request.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        if not data["name"].strip():
            raise HTTPException(400, "name cannot be empty")
    if "conditions" in data and data["conditions"] is not None:
        if "rules" not in data["conditions"]:
            raise HTTPException(400, "conditions must contain 'rules'")

    result = await update_trigger(trigger_id, data)
    if result is None:
        raise HTTPException(404, "Trigger not found")
    return result


@router.delete("/skills/triggers/{trigger_id}")
async def delete_trigger_endpoint(trigger_id: int):
    """Delete a trigger."""
    success = await delete_trigger(trigger_id)
    if not success:
        raise HTTPException(404, "Trigger not found")
    return {"deleted": True}


@router.patch("/skills/triggers/{trigger_id}")
async def toggle_trigger_endpoint(trigger_id: int, request: TriggerToggleRequest):
    """Toggle a trigger's enabled status."""
    result = await toggle_trigger(trigger_id, request.enabled)
    if result is None:
        raise HTTPException(404, "Trigger not found")
    return result
