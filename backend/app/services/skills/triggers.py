"""Trigger-Engine: automatic skill execution when memories are saved."""

import asyncio
import json
import logging
from datetime import datetime

from ...events import event_manager, MemoryEvent, EventType
from ...db.crud.skills import (
    get_enabled_triggers,
    get_skill_for_execution,
    create_execution,
    update_trigger_stats,
)
from ...db.crud import get_memory
from .executor import _stream_llm

logger = logging.getLogger(__name__)

# Concurrency limit for simultaneous trigger executions
MAX_CONCURRENT_EXECUTIONS = 3


class TriggerEvaluator:
    """Evaluates trigger rules against memories and executes matching skills."""

    def __init__(self):
        self._running = False
        self._queue = None
        self._task = None
        self._semaphore = asyncio.Semaphore(MAX_CONCURRENT_EXECUTIONS)

    async def start(self):
        """Subscribe to MEMORY_PROCESSED events and begin listening."""
        if self._running:
            return
        self._running = True
        self._queue = event_manager.subscribe()
        self._task = asyncio.create_task(self._listen())
        logger.info("TriggerEvaluator started")

    async def stop(self):
        """Unsubscribe and stop listening."""
        self._running = False
        if self._queue:
            event_manager.unsubscribe(self._queue)
            self._queue = None
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("TriggerEvaluator stopped")

    async def _listen(self):
        """Event loop: evaluate triggers for each processed memory."""
        while self._running:
            try:
                event = await self._queue.get()
                if event.type == EventType.MEMORY_PROCESSED:
                    await self._evaluate(event.memory_id, event.data)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"TriggerEvaluator error: {e}")

    async def _evaluate(self, memory_id: int, memory_data: dict | None):
        """Find matching triggers and execute skills."""
        try:
            memory = memory_data or await get_memory(memory_id)
            if not memory:
                return

            triggers = await get_enabled_triggers()
            if not triggers:
                return

            for trigger in triggers:
                try:
                    conditions = trigger["conditions"]  # Already parsed by CRUD
                    if evaluate_conditions(conditions, memory):
                        asyncio.create_task(
                            self._execute_trigger(trigger, memory_id)
                        )
                except Exception as e:
                    logger.error(f"Failed to evaluate trigger {trigger['id']}: {e}")

        except Exception as e:
            logger.error(f"TriggerEvaluator._evaluate failed for memory {memory_id}: {e}")

    async def _execute_trigger(self, trigger: dict, memory_id: int):
        """Execute a single trigger's skill with concurrency limiting."""
        async with self._semaphore:
            trigger_id = trigger["id"]
            skill_id = trigger["skill_id"]
            skill_name = trigger.get("skill_name", "Unknown Skill")
            trigger_name = trigger["name"]

            try:
                skill = await get_skill_for_execution(skill_id)
                if not skill:
                    logger.warning(f"Trigger {trigger_id}: skill {skill_id} not found")
                    return

                params_def_raw = skill.get("parameters")
                params_def = json.loads(params_def_raw) if isinstance(params_def_raw, str) and params_def_raw else []
                parameters = trigger.get("parameters") or {}

                execution_id = await create_execution(
                    skill_id=skill_id,
                    memory_id=memory_id,
                    trigger_type="on_save",
                    parameters=parameters,
                )

                # Stream LLM and collect result (background, no SSE needed)
                had_error = False
                async for event in _stream_llm(
                    prompt_system=skill["prompt_system"],
                    prompt_user_template=skill["prompt_user_template"],
                    params_def=params_def,
                    memory_id=memory_id,
                    parameters=parameters,
                    execution_id=execution_id,
                    output_format=skill.get("output_format", "markdown"),
                ):
                    if event["type"] == "error":
                        had_error = True
                        logger.error(f"Trigger {trigger_id} execution error: {event['message']}")
                        break

                if not had_error:
                    await update_trigger_stats(trigger_id)

                    # Notify frontend via SSE
                    await event_manager.publish(
                        MemoryEvent(
                            type=EventType.SKILL_EXECUTED,
                            memory_id=memory_id,
                            data={
                                "execution_id": execution_id,
                                "skill_id": skill_id,
                                "skill_name": skill_name,
                                "skill_icon": trigger.get("skill_icon", ""),
                                "trigger_name": trigger_name,
                                "trigger_type": "on_save",
                            },
                        )
                    )
                    logger.info(
                        f"Trigger '{trigger_name}' executed skill '{skill_name}' "
                        f"on memory {memory_id} (execution {execution_id})"
                    )

            except Exception as e:
                logger.error(f"Trigger {trigger_id} failed: {e}")


# ---------------------------------------------------------------------------
# Condition evaluation (pure functions, used by both evaluator and preview)
# ---------------------------------------------------------------------------

def evaluate_conditions(conditions: dict, memory: dict) -> bool:
    """Evaluate a conditions dict against a memory dict. Returns True if match."""
    operator = conditions.get("operator", "AND")
    rules = conditions.get("rules", [])

    if not rules:
        return False

    results = [_eval_rule(rule, memory) for rule in rules]

    if operator == "AND":
        return all(results)
    return any(results)  # OR


def _eval_rule(rule: dict, memory: dict) -> bool:
    """Evaluate a single condition rule."""
    field = rule.get("field", "")
    op = rule.get("op", "")
    expected = rule.get("value")

    actual = _get_field_value(field, memory)

    try:
        if op == "equals":
            return _normalize(actual) == _normalize(expected)
        elif op == "not_equals":
            return _normalize(actual) != _normalize(expected)
        elif op == "contains":
            if isinstance(actual, list):
                names = [t["name"] if isinstance(t, dict) else str(t) for t in actual]
                return str(expected).lower() in [n.lower() for n in names]
            return str(expected).lower() in str(actual).lower()
        elif op == "not_contains":
            if isinstance(actual, list):
                names = [t["name"] if isinstance(t, dict) else str(t) for t in actual]
                return str(expected).lower() not in [n.lower() for n in names]
            return str(expected).lower() not in str(actual).lower()
        elif op == "starts_with":
            return str(actual).lower().startswith(str(expected).lower())
        elif op == "greater_than":
            return _to_number(actual) > _to_number(expected)
        elif op == "less_than":
            return _to_number(actual) < _to_number(expected)
        elif op == "is_empty":
            return actual is None or actual == "" or actual == [] or actual == 0
        elif op == "is_not_empty":
            return actual is not None and actual != "" and actual != [] and actual != 0
        else:
            logger.warning(f"Unknown operator: {op}")
            return False
    except Exception as e:
        logger.warning(f"Rule evaluation error ({field} {op} {expected}): {e}")
        return False


def _get_field_value(field: str, memory: dict):
    """Extract a field value from a memory dict for condition evaluation."""
    if field == "type":
        return memory.get("type", "")
    elif field == "tags":
        return memory.get("tags", [])
    elif field == "title":
        return memory.get("title", "")
    elif field == "url":
        return memory.get("url", "")
    elif field == "content_length":
        content = memory.get("content", "")
        return len(content) if content else 0
    elif field == "has_transcript":
        transcript = memory.get("transcript")
        return bool(transcript and transcript.strip())
    elif field == "media_source":
        return memory.get("media_source", "")
    else:
        return memory.get(field)


def _normalize(value) -> str:
    """Normalize a value to lowercase string for comparison."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value).lower()
    return str(value).lower().strip()


def _to_number(value) -> float:
    """Convert a value to a number for comparison."""
    if value is None:
        return 0.0
    try:
        return float(value)
    except (ValueError, TypeError):
        return 0.0


# Global instance
trigger_evaluator = TriggerEvaluator()
