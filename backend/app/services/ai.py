from typing import AsyncGenerator
from openai import AsyncOpenAI
from .. import config


# Custom system prompt for Think
SYSTEM_PROMPT = """You are Think, a friendly personal assistant with access to the user's saved memories and notes. You help them recall information, answer questions, and have natural conversations.

When context from their memories is provided, use it naturally to inform your responses without explicitly mentioning "your saved article" or "your memories" - just incorporate the knowledge seamlessly.

Keep responses conversational and concise. Be helpful and warm, like a knowledgeable friend."""


async def get_client() -> AsyncOpenAI:
    """Get configured OpenAI client (works with Ollama and OpenAI-compatible services)."""
    from .secrets import get_api_key

    if config.settings.ai_provider == "ollama":
        return AsyncOpenAI(
            base_url=config.settings.ollama_base_url,
            api_key="ollama",  # Ollama doesn't need a real key
        )
    else:
        api_key = await get_api_key("openai") or ""
        if config.settings.openai_base_url:
            return AsyncOpenAI(
                base_url=config.settings.openai_base_url,
                api_key=api_key,
            )
        return AsyncOpenAI(api_key=api_key)


def get_model() -> str:
    """Get the model name based on provider."""
    if config.settings.ai_provider == "ollama":
        return config.settings.ollama_model
    return config.settings.openai_model


def build_messages(
    message: str,
    context: str = "",
    history: list[dict] | None = None
) -> list[dict]:
    """Build the messages array for the chat completion."""
    messages = []

    # System prompt with optional context
    if context:
        messages.append({
            "role": "system",
            "content": f"{SYSTEM_PROMPT}\n\nContext:\n{context}"
        })
    else:
        messages.append({
            "role": "system",
            "content": SYSTEM_PROMPT
        })

    # Add full conversation history
    if history:
        for msg in history:
            messages.append({
                "role": msg["role"],
                "content": msg["content"]
            })

    # Add current user message
    messages.append({"role": "user", "content": message})

    return messages


async def chat(
    message: str,
    context: str = "",
    history: list[dict] | None = None
) -> str:
    """Send a message to the AI and get a response."""
    client = await get_client()
    model = get_model()
    messages = build_messages(message, context, history)

    response = await client.chat.completions.create(
        model=model,
        messages=messages,
    )

    return response.choices[0].message.content or ""


async def chat_stream(
    message: str,
    context: str = "",
    history: list[dict] | None = None
) -> AsyncGenerator[tuple[str, dict | None], None]:
    """Stream AI response token by token, yielding (token, usage_or_none).

    Usage data is yielded at the end of the stream with empty token.
    """
    client = await get_client()
    model = get_model()
    messages = build_messages(message, context, history)

    stream = await client.chat.completions.create(
        model=model,
        messages=messages,
        stream=True,
        stream_options={"include_usage": True},  # Get usage at end of stream
    )

    async for chunk in stream:
        # Yield content tokens
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content, None

        # Final chunk includes usage stats
        if chunk.usage:
            yield "", {
                "prompt_tokens": chunk.usage.prompt_tokens,
                "completion_tokens": chunk.usage.completion_tokens,
                "total_tokens": chunk.usage.total_tokens,
            }
