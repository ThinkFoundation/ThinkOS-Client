import { NavLink } from "react-router-dom";
import { Home, Brain, Settings, MessageSquare } from "lucide-react";
import ProviderStatusIndicator from "./ProviderStatusIndicator";
import { useConversation } from "@/contexts/ConversationContext";

const navItems = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/memories", icon: Brain, label: "Memories" },
  { to: "/chat", icon: MessageSquare, label: "Chats" },
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
    <aside className="w-[72px] h-screen border-r bg-muted/30 flex flex-col py-4">
      <div className="flex justify-center mb-6">
        <div className="w-10 h-10 flex items-center justify-center">
          <img
            src="./icons/think-os-agent-grey.svg"
            alt="Think"
            className="w-full h-full object-contain dark:hidden"
          />
          <img
            src="./icons/think-os-agent-dark-mode-filled.svg"
            alt="Think"
            className="w-full h-full object-contain hidden dark:block"
          />
        </div>
      </div>
      <nav className="flex-1 flex flex-col gap-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => handleNavClick(item.to)}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center py-2 text-[10px] transition-colors border-l-2 ${
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`
            }
          >
            <item.icon className="h-5 w-5 mb-1" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <ProviderStatusIndicator />
    </aside>
  );
}
