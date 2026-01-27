from ..core import get_session_maker, run_sync
from ...models import Setting


async def get_setting(key: str) -> str | None:
    """Get a setting value by key."""
    def _get():
        with get_session_maker()() as session:
            setting = session.get(Setting, key)
            return setting.value if setting else None

    return await run_sync(_get)


async def set_setting(key: str, value: str) -> None:
    """Set a setting value."""
    def _set():
        with get_session_maker()() as session:
            setting = session.get(Setting, key)
            if setting:
                setting.value = value
            else:
                setting = Setting(key=key, value=value)
                session.add(setting)
            session.commit()

    await run_sync(_set)


async def delete_setting(key: str) -> None:
    """Delete a setting."""
    def _delete():
        with get_session_maker()() as session:
            setting = session.get(Setting, key)
            if setting:
                session.delete(setting)
                session.commit()

    await run_sync(_delete)
