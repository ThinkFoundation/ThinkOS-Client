from openai import AsyncOpenAI
from ..config import settings


def get_client() -> AsyncOpenAI:
    """Get configured OpenAI client (works with Ollama too)."""
    if settings.ai_provider == "ollama":
        return AsyncOpenAI(
            base_url=settings.ollama_base_url,
            api_key="ollama",  # Ollama doesn't need a real key
        )
    else:
        return AsyncOpenAI(api_key=settings.openai_api_key)


def get_model() -> str:
    """Get the model name based on provider."""
    if settings.ai_provider == "ollama":
        return settings.ollama_model
    return settings.openai_model


async def chat(message: str, context: str = "") -> str:
    """Send a message to the AI and get a response."""
    client = get_client()
    model = get_model()

    messages = []

    if context:
        messages.append({
            "role": "system",
            "content": f"You are a helpful assistant. Use the following context to answer questions:\n\n{context}"
        })
    else:
        messages.append({
            "role": "system",
            "content": "You are a helpful assistant."
        })

    messages.append({"role": "user", "content": message})

    response = await client.chat.completions.create(
        model=model,
        messages=messages,
    )

    return response.choices[0].message.content or ""
