/**
 * Design tokens for consistent styling across the app.
 * Single source of truth for glassmorphism, actions, and chip styles.
 */

// Glassmorphism base (used on cards, messages, panels)
export const glass = {
  base: "bg-white/70 dark:bg-white/5 backdrop-blur-md border border-white/60 dark:border-white/10 shadow-sm shadow-black/5 dark:shadow-black/20",
  hover:
    "hover:shadow-lg hover:shadow-black/10 dark:hover:shadow-black/30 hover:scale-[1.01] hover:-translate-y-0.5 transition-all duration-200",
  panel: "bg-white/60 dark:bg-white/[0.04] backdrop-blur-xl border border-white/50 dark:border-white/[0.08] shadow-md",
  card: "bg-white/50 dark:bg-white/[0.03] backdrop-blur-sm border border-white/40 dark:border-white/[0.06]",
  overlay: "bg-white/40 dark:bg-white/[0.03] backdrop-blur-md border border-white/30 dark:border-white/[0.05]",
};

// Sidebar glass background
export const sidebar = {
  bg: "bg-white/40 dark:bg-white/[0.02] backdrop-blur-lg border-r border-white/50 dark:border-white/[0.08]",
};

// Action buttons that fade in on hover
export const actions = {
  container: "opacity-0 group-hover:opacity-100 transition-opacity duration-200",
  button: "h-7 w-7 text-muted-foreground hover:text-primary",
};

// Prompt chips (quick prompts, follow-ups)
export const chips = {
  base: "px-2.5 py-1 text-xs rounded-full transition-colors",
  glass:
    "bg-white/70 dark:bg-white/5 border border-white/60 dark:border-white/10 hover:bg-primary/10",
  primary: "bg-primary/10 text-primary hover:bg-primary/20",
};

// Full-screen note editor
export const editor = {
  container: "fixed inset-0 z-50 bg-background/98 backdrop-blur-2xl",
  content: "max-w-3xl mx-auto px-8 py-6",
  toolbar:
    "bg-white/70 dark:bg-white/5 backdrop-blur-md border border-white/60 dark:border-white/10 shadow-sm shadow-black/5 dark:shadow-black/20 px-2 py-1.5 rounded-xl flex items-center gap-1 transition-opacity duration-300",
  title:
    "w-full text-3xl font-heading font-semibold bg-transparent border-none outline-none placeholder:text-muted-foreground/50",
  actionBar:
    "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-white/85 dark:bg-neutral-900/85 backdrop-blur-xl border border-white/60 dark:border-white/20 shadow-lg shadow-black/10 dark:shadow-black/30 px-4 py-3 rounded-2xl flex items-center gap-3",
  actionBarWarning: "border-amber-500/50 shadow-amber-500/20",
};

// Memory type colors — single source of truth for graph nodes, filters, legend, etc.
export const memoryTypeColors = {
  web:        { hex: "#06b6d4", bg: "bg-cyan-500",   text: "text-cyan-500"   },
  note:       { hex: "#f59e0b", bg: "bg-amber-500",  text: "text-amber-500"  },
  voice_memo: { hex: "#f97316", bg: "bg-orange-500", text: "text-orange-500" },
  audio:      { hex: "#3b82f6", bg: "bg-blue-500",   text: "text-blue-500"   },
  video:      { hex: "#a855f7", bg: "bg-purple-500", text: "text-purple-500" },
  document:   { hex: "#ef4444", bg: "bg-red-500",    text: "text-red-500"    },
} as const;

export function getMemoryTypeColor(type: string) {
  return memoryTypeColors[type as keyof typeof memoryTypeColors]
    ?? { hex: "#64748b", bg: "bg-slate-500", text: "text-slate-500" };
}

// Community colors — alternating vibrant/soft for rhythm and visual interest
export const communityColors = [
  '#3b82f6',  // blue-600    (vibrant)
  '#7dd3fc',  // sky-300     (soft)
  '#6366f1',  // indigo-600  (vibrant)
  '#c4b5fd',  // violet-300  (soft)
  '#a855f7',  // purple-600  (vibrant)
  '#f0abfc',  // fuchsia-300 (soft)
  '#ec4899',  // pink-600    (vibrant)
  '#fda4af',  // rose-300    (soft)
  '#f97316',  // orange-600  (vibrant)
  '#fbbf24',  // amber-300   (soft)
] as const;

export function getCommunityColor(index: number): string {
  return communityColors[index % communityColors.length];
}
