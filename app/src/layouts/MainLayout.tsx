import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { ConversationProvider } from "@/contexts/ConversationContext";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function MainLayout() {
  return (
    <ConversationProvider>
      <TooltipProvider delayDuration={400}>
        <div className="flex h-screen">
          <Sidebar />
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </TooltipProvider>
    </ConversationProvider>
  );
}
