import { NavLink } from "react-router-dom";
import { Home, Brain, Settings, MessageSquare, Network } from "lucide-react";
import ProviderStatusIndicator from "./ProviderStatusIndicator";
import { useConversation } from "@/contexts/ConversationContext";
import { sidebar } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navItems = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/memories", icon: Brain, label: "Memories" },
  { to: "/chat", icon: MessageSquare, label: "Chats" },
  { to: "/graph", icon: Network, label: "Graph" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export default function Sidebar() {
  const { startNewChat } = useConversation();

  const handleNavClick = (to: string) => {
    if (to === "/") {
      startNewChat();
    }
  };

  return (
    <aside className={cn("w-[72px] h-screen flex flex-col py-4", sidebar.bg)}>
      <div className="flex justify-center mb-6 pb-4 border-b border-white/15 dark:border-white/[0.06] mx-3">
        <div className="w-10 h-10 flex items-center justify-center">
          <img
            src="./icons/think-os-agent-grey.svg"
            alt="Think"
            className="w-full h-full object-contain"
          />
        </div>
      </div>
      <nav className="flex-1 flex flex-col gap-1 px-2">
        {navItems.map((item) => (
          <Tooltip key={item.to}>
            <TooltipTrigger asChild>
              <NavLink
                to={item.to}
                onClick={() => handleNavClick(item.to)}
              >
                {({ isActive }) => (
                  <div
                    className={cn(
                      "relative flex flex-col items-center justify-center py-2.5 rounded-xl text-xs transition-all duration-200",
                      isActive
                        ? "text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/20 dark:hover:bg-white/[0.04]"
                    )}
                  >
                    {isActive && (
                      <span className="absolute inset-0 rounded-xl bg-primary/10 border border-primary/20" />
                    )}
                    <item.icon
                      className={cn(
                        "relative h-5 w-5 mb-1 transition-transform duration-200",
                        isActive && "scale-110"
                      )}
                    />
                    <span className="relative">{item.label}</span>
                  </div>
                )}
              </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right">
              {item.label}
            </TooltipContent>
          </Tooltip>
        ))}
      </nav>

      <ProviderStatusIndicator />
    </aside>
  );
}
