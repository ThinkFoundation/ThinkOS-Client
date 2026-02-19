import json
import logging
from typing import AsyncGenerator

from ..ai.client import get_client, get_model
from ...db.crud import get_memory
from ...db.crud.skills import (
    get_skill_for_execution,
    create_execution,
    update_execution_completed,
    update_execution_failed,
)

logger = logging.getLogger(__name__)


def extract_content(memory: dict) -> tuple[str, str]:
    """Extract text content from memory with fallback chain.

    Returns (content, source_name) where source_name is
    "content", "transcript", "summary", or "none".
    """
    if memory.get("content"):
        return memory["content"], "content"
    if memory.get("transcript"):
        return memory["transcript"], "transcript"
    if memory.get("summary"):
        return memory["summary"], "summary"
    return "", "none"


def validate_parameters(
    parameters: dict,
    skill_params_def: list[dict],
) -> tuple[dict, list[str]]:
    """Validate and normalize parameters against skill definition.

    Returns (normalized_params, errors).
    """
    normalized = {}
    errors = []

    for param_def in skill_params_def:
        pid = param_def["id"]
        ptype = param_def.get("type", "string")

        if pid in parameters:
            value = parameters[pid]

            if ptype == "select":
                options = param_def.get("options", [])
                if value not in options:
                    errors.append(f"Parameter '{pid}': value '{value}' not in options {options}")
                    continue
            elif ptype == "boolean":
                if not isinstance(value, bool):
                    value = str(value).lower() in ("true", "1", "yes")
            elif ptype == "number":
                try:
                    value = float(value) if isinstance(value, str) else value
                except (ValueError, TypeError):
                    errors.append(f"Parameter '{pid}': invalid number '{value}'")
                    continue

            normalized[pid] = value
        else:
            normalized[pid] = param_def.get("default")

    return normalized, errors


def render_template(
    template: str,
    content: str,
    memory: dict,
    parameters: dict,
    skill_params_def: list[dict],
) -> str:
    """Replace {{variable}} placeholders in the user template."""
    result = template

    # Memory variables
    result = result.replace("{{content}}", content)
    result = result.replace("{{memory_title}}", memory.get("title") or "")
    result = result.replace("{{memory_url}}", memory.get("url") or "")
    result = result.replace("{{memory_date}}", memory.get("created_at") or "")
    result = result.replace("{{memory_type}}", memory.get("type") or "")

    # Tags as comma-separated string
    tags = memory.get("tags", [])
    tag_names = [t["name"] for t in tags] if tags else []
    result = result.replace("{{memory_tags}}", ", ".join(tag_names))

    # Parameter variables
    for param_def in skill_params_def:
        param_id = param_def["id"]
        value = parameters.get(param_id, param_def.get("default"))

        if param_def.get("type") == "boolean" and isinstance(value, bool):
            value = "yes" if value else "no"

        result = result.replace(f"{{{{{param_id}}}}}", str(value) if value is not None else "")

    return result


async def _stream_llm(
    prompt_system: str,
    prompt_user_template: str,
    params_def: list[dict],
    memory_id: int,
    parameters: dict,
    execution_id: int | None = None,
    output_format: str = "markdown",
) -> AsyncGenerator[dict, None]:
    """Shared streaming logic for execute and test_execute.

    If execution_id is None, no DB tracking is performed.
    """
    # 1. Load memory
    memory = await get_memory(memory_id)
    if not memory:
        yield {"type": "error", "message": f"Memory not found: {memory_id}"}
        return

    # 2. Extract content
    content, content_source = extract_content(memory)
    if not content:
        yield {"type": "error", "message": "Memory has no content, transcript, or summary"}
        return

    # 3. Validate parameters
    normalized_params, param_errors = validate_parameters(parameters, params_def)
    if param_errors:
        yield {"type": "error", "message": f"Invalid parameters: {'; '.join(param_errors)}"}
        return

    # 4. Yield meta event
    meta = {"type": "meta", "content_source": content_source}
    if execution_id is not None:
        meta["execution_id"] = execution_id
    yield meta

    if content_source == "summary":
        yield {"type": "meta", "content_warning": "summary_only"}

    # 5. Render template
    rendered_prompt = render_template(
        template=prompt_user_template,
        content=content,
        memory=memory,
        parameters=normalized_params,
        skill_params_def=params_def,
    )

    # 6. Apply output format instruction
    effective_system = prompt_system
    if output_format and output_format != "markdown":
        format_instructions = {
            "plain": "\n\nIMPORTANT: Respond in plain text only. Do not use any markdown formatting (no headers, bold, italic, lists, code blocks, etc.).",
            "json": "\n\nIMPORTANT: Respond with valid JSON only. No markdown, no explanation outside the JSON structure.",
            "html": "\n\nIMPORTANT: Respond with HTML markup. Use semantic HTML tags for structure.",
        }
        if output_format in format_instructions:
            effective_system += format_instructions[output_format]

    # 7. Stream LLM
    full_result = ""
    try:
        client = await get_client()
        model = get_model()

        messages = [
            {"role": "system", "content": effective_system},
            {"role": "user", "content": rendered_prompt},
        ]

        stream = await client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
        )

        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                token = chunk.choices[0].delta.content
                full_result += token
                yield {"type": "token", "content": token}

        # Mark completed if tracking
        if execution_id is not None:
            await update_execution_completed(execution_id, full_result)

        done_event = {"type": "done"}
        if execution_id is not None:
            done_event["execution_id"] = execution_id
        yield done_event

    except Exception as e:
        error_msg = str(e)
        logger.error(f"Skill execution failed: {error_msg}")
        if execution_id is not None:
            await update_execution_failed(execution_id, error_msg)
        yield {"type": "error", "message": error_msg}


async def execute_skill(
    skill_id: str,
    memory_id: int,
    parameters: dict | None = None,
    trigger_type: str = "manual",
) -> AsyncGenerator[dict, None]:
    """Execute a skill against a memory, yielding SSE event dicts.

    Yields dicts with 'type' key:
    - {"type": "meta", "execution_id": int, "skill_name": str, "content_source": str}
    - {"type": "meta", "content_warning": "summary_only"}
    - {"type": "token", "content": str}
    - {"type": "done", "execution_id": int}
    - {"type": "error", "message": str}
    """
    parameters = parameters or {}

    # 1. Load skill
    skill = await get_skill_for_execution(skill_id)
    if not skill:
        yield {"type": "error", "message": f"Skill not found: {skill_id}"}
        return

    # 2. Check input.accepts
    input_accepts_raw = skill.get("input_accepts")
    if input_accepts_raw:
        memory = await get_memory(memory_id)
        if memory:
            accepts = json.loads(input_accepts_raw) if isinstance(input_accepts_raw, str) else input_accepts_raw
            if accepts and memory["type"] not in accepts:
                yield {"type": "error", "message": f"Skill does not accept memory type '{memory['type']}'"}
                return

    # 3. Parse parameter definitions
    params_def_raw = skill.get("parameters")
    params_def = json.loads(params_def_raw) if isinstance(params_def_raw, str) and params_def_raw else []

    # 4. Create execution entry
    execution_id = await create_execution(
        skill_id=skill_id,
        memory_id=memory_id,
        trigger_type=trigger_type,
        parameters=parameters,
    )

    # 5. Delegate to shared streaming logic
    async for event in _stream_llm(
        prompt_system=skill["prompt_system"],
        prompt_user_template=skill["prompt_user_template"],
        params_def=params_def,
        memory_id=memory_id,
        parameters=parameters,
        execution_id=execution_id,
        output_format=skill.get("output_format", "markdown"),
    ):
        # Inject skill_name into the first meta event
        if event.get("type") == "meta" and "content_source" in event:
            event["skill_name"] = skill["name"]
        yield event


async def test_execute(
    memory_id: int,
    prompt_system: str,
    prompt_user_template: str,
    parameters_def: list[dict] | None = None,
    parameter_values: dict | None = None,
    input_accepts: list[str] | None = None,
    output_format: str = "markdown",
) -> AsyncGenerator[dict, None]:
    """Test-execute with provided prompt data, no DB tracking.

    Same streaming output as execute_skill but does not create a skill_executions entry.
    """
    # Check input.accepts if provided
    if input_accepts:
        memory = await get_memory(memory_id)
        if memory and memory["type"] not in input_accepts:
            yield {"type": "error", "message": f"Skill does not accept memory type '{memory['type']}'"}
            return

    params_def = parameters_def or []

    async for event in _stream_llm(
        prompt_system=prompt_system,
        prompt_user_template=prompt_user_template,
        params_def=params_def,
        memory_id=memory_id,
        parameters=parameter_values or {},
        execution_id=None,
        output_format=output_format,
    ):
        yield event
