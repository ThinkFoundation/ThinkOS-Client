import type { Conversation } from "@/types/chat";

export type TimeGroup =
  | "pinned"
  | "today"
  | "yesterday"
  | "previous_7_days"
  | "previous_30_days"
  | "older";

export interface GroupedConversations {
  pinned: Conversation[];
  today: Conversation[];
  yesterday: Conversation[];
  previous_7_days: Conversation[];
  previous_30_days: Conversation[];
  older: Conversation[];
}

export function getTimeGroup(dateString: string): Exclude<TimeGroup, "pinned"> {
  const date = new Date(dateString);
  const now = new Date();

  // Reset time to start of day for comparison
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  if (date >= today) {
    return "today";
  } else if (date >= yesterday) {
    return "yesterday";
  } else if (date >= sevenDaysAgo) {
    return "previous_7_days";
  } else if (date >= thirtyDaysAgo) {
    return "previous_30_days";
  } else {
    return "older";
  }
}

export function groupConversations(
  conversations: Conversation[]
): GroupedConversations {
  const groups: GroupedConversations = {
    pinned: [],
    today: [],
    yesterday: [],
    previous_7_days: [],
    previous_30_days: [],
    older: [],
  };

  for (const conversation of conversations) {
    if (conversation.pinned) {
      groups.pinned.push(conversation);
    } else {
      const group = getTimeGroup(conversation.updated_at);
      groups[group].push(conversation);
    }
  }

  return groups;
}

export function filterConversations(
  conversations: Conversation[],
  searchQuery: string
): Conversation[] {
  if (!searchQuery.trim()) {
    return conversations;
  }

  const query = searchQuery.toLowerCase();
  return conversations.filter(
    (c) =>
      c.title.toLowerCase().includes(query) ||
      c.last_message?.toLowerCase().includes(query)
  );
}

export const GROUP_LABELS: Record<TimeGroup, string> = {
  pinned: "Pinned",
  today: "Today",
  yesterday: "Yesterday",
  previous_7_days: "Previous 7 Days",
  previous_30_days: "Previous 30 Days",
  older: "Older",
};
