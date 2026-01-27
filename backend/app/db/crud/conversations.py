from datetime import datetime
from sqlalchemy import select, func, and_

from ..core import get_session_maker, run_sync
from ...models import Conversation, Message, MessageSource, Memory


async def create_conversation(title: str = "") -> dict:
    """Create a new conversation."""
    def _create():
        with get_session_maker()() as session:
            conversation = Conversation(title=title)
            session.add(conversation)
            session.commit()
            session.refresh(conversation)
            return {
                "id": conversation.id,
                "title": conversation.title,
                "pinned": conversation.pinned,
                "created_at": conversation.created_at.isoformat(),
                "updated_at": conversation.updated_at.isoformat(),
                "message_count": 0,
            }

    return await run_sync(_create)


async def get_conversations(limit: int = 50, offset: int = 0) -> list[dict]:
    """Get all conversations ordered by pinned status then most recent update."""
    def _get():
        with get_session_maker()() as session:
            # Get conversations with message count, pinned first then by date
            conversations = session.execute(
                select(
                    Conversation,
                    func.count(Message.id).label("message_count")
                )
                .outerjoin(Message, Conversation.id == Message.conversation_id)
                .group_by(Conversation.id)
                .order_by(Conversation.pinned.desc(), Conversation.updated_at.desc())
                .offset(offset)
                .limit(limit)
            ).all()

            if not conversations:
                return []

            # Batch fetch last messages for all conversations in a single query
            conv_ids = [conv.id for conv, _ in conversations]

            # Subquery to get the max created_at for each conversation
            last_msg_subq = (
                select(
                    Message.conversation_id,
                    func.max(Message.created_at).label("max_created_at")
                )
                .where(Message.conversation_id.in_(conv_ids))
                .group_by(Message.conversation_id)
                .subquery()
            )

            # Get the actual messages matching the max created_at
            last_messages_query = (
                select(Message)
                .join(
                    last_msg_subq,
                    and_(
                        Message.conversation_id == last_msg_subq.c.conversation_id,
                        Message.created_at == last_msg_subq.c.max_created_at
                    )
                )
            )
            last_messages = session.execute(last_messages_query).scalars().all()

            # Build lookup dict
            last_message_by_conv = {msg.conversation_id: msg.content[:100] for msg in last_messages}

            result = []
            for conv, message_count in conversations:
                result.append({
                    "id": conv.id,
                    "title": conv.title,
                    "pinned": conv.pinned,
                    "created_at": conv.created_at.isoformat(),
                    "updated_at": conv.updated_at.isoformat(),
                    "message_count": message_count,
                    "last_message": last_message_by_conv.get(conv.id),
                })

            return result

    return await run_sync(_get)


async def get_conversation(conversation_id: int) -> dict | None:
    """Get a conversation with all its messages and their sources."""
    def _get():
        with get_session_maker()() as session:
            conversation = session.get(Conversation, conversation_id)
            if not conversation:
                return None

            messages = session.execute(
                select(Message)
                .where(Message.conversation_id == conversation_id)
                .order_by(Message.created_at.asc())
            ).scalars().all()

            message_list = []
            for m in messages:
                # Get sources for this message
                sources_result = session.execute(
                    select(MessageSource, Memory)
                    .join(Memory, MessageSource.memory_id == Memory.id)
                    .where(MessageSource.message_id == m.id)
                ).all()

                sources = [
                    {"id": mem.id, "title": mem.title, "url": mem.url}
                    for msg_src, mem in sources_result
                ]

                message_list.append({
                    "id": m.id,
                    "role": m.role,
                    "content": m.content,
                    "created_at": m.created_at.isoformat(),
                    "sources": sources,
                    "prompt_tokens": m.prompt_tokens,
                    "completion_tokens": m.completion_tokens,
                    "total_tokens": m.total_tokens,
                })

            return {
                "id": conversation.id,
                "title": conversation.title,
                "created_at": conversation.created_at.isoformat(),
                "updated_at": conversation.updated_at.isoformat(),
                "messages": message_list,
            }

    return await run_sync(_get)


async def delete_conversation(conversation_id: int) -> bool:
    """Delete a conversation and all its messages."""
    def _delete():
        with get_session_maker()() as session:
            conversation = session.get(Conversation, conversation_id)
            if not conversation:
                return False
            session.delete(conversation)
            session.commit()
            return True

    return await run_sync(_delete)


async def update_conversation_title(conversation_id: int, title: str) -> bool:
    """Update a conversation's title."""
    def _update():
        with get_session_maker()() as session:
            conversation = session.get(Conversation, conversation_id)
            if not conversation:
                return False
            conversation.title = title
            session.commit()
            return True

    return await run_sync(_update)


async def toggle_conversation_pinned(conversation_id: int, pinned: bool) -> bool:
    """Toggle a conversation's pinned status."""
    def _update():
        with get_session_maker()() as session:
            conversation = session.get(Conversation, conversation_id)
            if not conversation:
                return False
            conversation.pinned = pinned
            session.commit()
            return True

    return await run_sync(_update)


async def add_message(
    conversation_id: int,
    role: str,
    content: str,
    sources: list[dict] | None = None,
    usage: dict | None = None,
) -> dict | None:
    """Add a message to a conversation with optional sources and token usage."""
    def _add():
        with get_session_maker()() as session:
            conversation = session.get(Conversation, conversation_id)
            if not conversation:
                return None

            message = Message(
                conversation_id=conversation_id,
                role=role,
                content=content,
            )

            # Store token usage if provided (for assistant messages)
            if usage:
                message.prompt_tokens = usage.get("prompt_tokens")
                message.completion_tokens = usage.get("completion_tokens")
                message.total_tokens = usage.get("total_tokens")

            session.add(message)
            session.flush()  # Get message.id before adding sources

            # Store sources if provided
            if sources:
                for source in sources:
                    msg_source = MessageSource(
                        message_id=message.id,
                        memory_id=source["id"],
                        relevance_score=source.get("distance"),
                    )
                    session.add(msg_source)

            # Update conversation's updated_at
            conversation.updated_at = datetime.utcnow()

            session.commit()
            session.refresh(message)

            return {
                "id": message.id,
                "conversation_id": conversation_id,
                "role": message.role,
                "content": message.content,
                "created_at": message.created_at.isoformat(),
                "sources": sources or [],
                "prompt_tokens": message.prompt_tokens,
                "completion_tokens": message.completion_tokens,
                "total_tokens": message.total_tokens,
            }

    return await run_sync(_add)
