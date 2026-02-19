import json
import re
import uuid
import logging
from pathlib import Path
from sqlalchemy import Connection, text

logger = logging.getLogger(__name__)

BUILTIN_SKILLS_DIR = Path(__file__).parent.parent.parent / "skills" / "builtin"

REQUIRED_FIELDS = ["schema_version", "id", "name", "description", "icon", "version"]
MAX_LOGO_SIZE = 32 * 1024  # 32 KB


def validate_skill(data: dict, filename: str) -> list[str]:
    """Validate a .think-skill file. Returns list of error strings (empty = valid)."""
    errors = []

    for field in REQUIRED_FIELDS:
        if field not in data:
            errors.append(f"{filename}: missing required field '{field}'")

    if "id" in data:
        try:
            uuid.UUID(data["id"], version=4)
        except ValueError:
            errors.append(f"{filename}: invalid UUID v4 '{data['id']}'")

    prompt = data.get("prompt", {})
    if "system" not in prompt:
        errors.append(f"{filename}: missing prompt.system")
    if "user_template" not in prompt:
        errors.append(f"{filename}: missing prompt.user_template")
    elif "{{content}}" not in prompt.get("user_template", ""):
        errors.append(f"{filename}: prompt.user_template must contain {{{{content}}}}")

    logo = data.get("logo")
    if logo and len(logo.encode("utf-8")) > MAX_LOGO_SIZE:
        errors.append(f"{filename}: logo exceeds {MAX_LOGO_SIZE} bytes")

    return errors


def validate_skill_json(json_str: str) -> tuple[bool, list[str], list[str], dict | None]:
    """Validate a .think-skill JSON string for import/editor use.

    Returns (valid, errors, warnings, parsed_dict_or_none).
    """
    errors = []
    warnings = []

    # 1. Parse JSON
    try:
        data = json.loads(json_str)
    except json.JSONDecodeError as e:
        return False, [f"Invalid JSON: {e}"], [], None

    if not isinstance(data, dict):
        return False, ["JSON root must be an object"], [], None

    # 2. Required fields
    for field in REQUIRED_FIELDS:
        if field not in data:
            errors.append(f"Missing required field: {field}")

    # 3. UUID validation
    if "id" in data:
        try:
            uuid.UUID(data["id"], version=4)
        except ValueError:
            errors.append(f"Invalid UUID v4: {data['id']}")

    # 4. Schema version check
    sv = data.get("schema_version")
    if sv is not None and sv != 1:
        errors.append(f"Unsupported schema_version: {sv} (only v1 supported)")

    # 5. Prompt validation
    prompt = data.get("prompt", {})
    if not isinstance(prompt, dict):
        errors.append("'prompt' must be an object")
    else:
        if "system" not in prompt:
            errors.append("Missing required field: prompt.system")
        if "user_template" not in prompt:
            errors.append("Missing required field: prompt.user_template")
        elif "{{content}}" not in prompt.get("user_template", ""):
            errors.append("prompt.user_template must contain {{content}}")

    # 6. Logo size
    logo = data.get("logo")
    if logo:
        logo_size = len(logo.encode("utf-8"))
        if logo_size > MAX_LOGO_SIZE:
            errors.append(f"Logo exceeds {MAX_LOGO_SIZE} bytes ({logo_size} bytes)")
        elif logo_size > int(MAX_LOGO_SIZE * 0.875):
            warnings.append(f"Logo is close to size limit ({logo_size} of {MAX_LOGO_SIZE} bytes)")

    # 7. Parameter validation
    params = data.get("parameters", [])
    if params and isinstance(params, list):
        param_ids = set()
        for i, p in enumerate(params):
            pid = p.get("id")
            if not pid:
                errors.append(f"Parameter at index {i}: missing 'id'")
            elif pid in param_ids:
                errors.append(f"Duplicate parameter id: '{pid}'")
            else:
                param_ids.add(pid)

            ptype = p.get("type", "string")
            if ptype == "select":
                options = p.get("options", [])
                if not options:
                    errors.append(f"Parameter '{pid}': select type requires at least 1 option")
                default = p.get("default")
                if default is not None and options and default not in options:
                    errors.append(f"Parameter '{pid}': default '{default}' not in options")
            elif ptype == "boolean":
                default = p.get("default")
                if default is not None and not isinstance(default, bool):
                    errors.append(f"Parameter '{pid}': boolean default must be true/false")

    # 8. Check template variable references
    template = prompt.get("user_template", "") if isinstance(prompt, dict) else ""
    if template and params and isinstance(params, list):
        referenced_vars = set(re.findall(r"\{\{(\w+)\}\}", template))
        builtin_vars = {"content", "memory_title", "memory_url", "memory_date", "memory_type", "memory_tags"}
        param_ids_set = {p.get("id") for p in params if p.get("id")}
        unknown = referenced_vars - builtin_vars - param_ids_set
        for var in sorted(unknown):
            warnings.append(f"Template references unknown variable: {{{{{var}}}}}")

    valid = len(errors) == 0
    return valid, errors, warnings, data if valid else None


def generate_skill_json(skill_row: dict) -> str:
    """Generate .think-skill JSON from DB columns.

    Args:
        skill_row: Dict with Skill table column values.

    Returns:
        Formatted JSON string matching the .think-skill file format.
    """
    tags = skill_row.get("tags")
    if isinstance(tags, str):
        tags = json.loads(tags)
    elif tags is None:
        tags = []

    input_accepts = skill_row.get("input_accepts")
    if isinstance(input_accepts, str):
        input_accepts = json.loads(input_accepts)

    parameters = skill_row.get("parameters")
    if isinstance(parameters, str):
        parameters = json.loads(parameters)
    elif parameters is None:
        parameters = []

    triggers = skill_row.get("triggers")
    if isinstance(triggers, str) and triggers:
        triggers = json.loads(triggers)

    skill_json = {
        "schema_version": skill_row.get("schema_version", 1),
        "id": skill_row["id"],
        "name": skill_row["name"],
        "description": skill_row["description"],
        "icon": skill_row["icon"],
        "version": skill_row.get("version", "1.0.0"),
        "category": skill_row.get("category", "custom"),
        "tags": tags,
        "input": {
            "type": skill_row.get("input_type", "single_memory"),
            "accepts": input_accepts,
        },
        "parameters": parameters,
        "prompt": {
            "system": skill_row["prompt_system"],
            "user_template": skill_row["prompt_user_template"],
        },
        "output": {
            "format": skill_row.get("output_format", "markdown"),
        },
    }

    # Optional fields
    logo = skill_row.get("logo")
    if logo:
        skill_json["logo"] = logo

    author_name = skill_row.get("author_name")
    author_url = skill_row.get("author_url")
    if author_name or author_url:
        skill_json["author"] = {}
        if author_name:
            skill_json["author"]["name"] = author_name
        if author_url:
            skill_json["author"]["url"] = author_url

    if triggers:
        skill_json["triggers"] = triggers

    return json.dumps(skill_json, indent=2, ensure_ascii=False)


def seed_builtin_skills(conn: Connection) -> None:
    """Load .think-skill files from builtin/ dir, validate, and upsert into DB.

    Called from init_db() after run_migrations().
    Uses raw SQL (text()) because this runs in the same Connection as migrations.
    """
    if not BUILTIN_SKILLS_DIR.exists():
        logger.warning(f"Builtin skills directory not found: {BUILTIN_SKILLS_DIR}")
        return

    skill_files = list(BUILTIN_SKILLS_DIR.glob("*.think-skill"))
    if not skill_files:
        logger.info("No builtin skill files found")
        return

    for filepath in skill_files:
        try:
            raw = filepath.read_text(encoding="utf-8")
            data = json.loads(raw)
        except (json.JSONDecodeError, IOError) as e:
            logger.error(f"Failed to load {filepath.name}: {e}")
            continue

        errors = validate_skill(data, filepath.name)
        if errors:
            for err in errors:
                logger.error(f"Skill validation: {err}")
            continue

        prompt = data.get("prompt", {})
        input_config = data.get("input", {})
        author = data.get("author", {})

        params = {
            "id": data["id"],
            "schema_version": data.get("schema_version", 1),
            "name": data["name"],
            "description": data["description"],
            "icon": data["icon"],
            "logo": data.get("logo"),
            "version": data["version"],
            "category": data.get("category", "custom"),
            "tags": json.dumps(data.get("tags", [])),
            "author_name": author.get("name"),
            "author_url": author.get("url"),
            "input_type": input_config.get("type", "single_memory"),
            "input_accepts": json.dumps(input_config.get("accepts")) if input_config.get("accepts") else None,
            "parameters": json.dumps(data.get("parameters", [])),
            "prompt_system": prompt["system"],
            "prompt_user_template": prompt["user_template"],
            "output_format": data.get("output", {}).get("format", "markdown"),
            "triggers": json.dumps(data.get("triggers")) if data.get("triggers") else None,
            "definition": raw,
        }

        existing = conn.execute(
            text("SELECT id FROM skills WHERE id = :id"),
            {"id": data["id"]}
        ).fetchone()

        if existing:
            conn.execute(text("""
                UPDATE skills SET
                    schema_version = :schema_version, name = :name, description = :description,
                    icon = :icon, logo = :logo, version = :version, category = :category,
                    tags = :tags, author_name = :author_name, author_url = :author_url,
                    input_type = :input_type, input_accepts = :input_accepts,
                    parameters = :parameters, prompt_system = :prompt_system,
                    prompt_user_template = :prompt_user_template, output_format = :output_format,
                    triggers = :triggers, definition = :definition,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :id
            """), params)
            logger.info(f"Updated builtin skill: {data['name']}")
        else:
            params["source"] = "builtin"
            params["hidden"] = 0
            conn.execute(text("""
                INSERT INTO skills (
                    id, schema_version, name, description, icon, logo, version,
                    category, tags, author_name, author_url, input_type, input_accepts,
                    parameters, prompt_system, prompt_user_template, output_format,
                    triggers, source, hidden, definition, created_at, updated_at
                ) VALUES (
                    :id, :schema_version, :name, :description, :icon, :logo, :version,
                    :category, :tags, :author_name, :author_url, :input_type, :input_accepts,
                    :parameters, :prompt_system, :prompt_user_template, :output_format,
                    :triggers, :source, :hidden, :definition, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
            """), params)
            logger.info(f"Seeded new builtin skill: {data['name']}")

    conn.commit()
