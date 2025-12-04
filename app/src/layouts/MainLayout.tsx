import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { ConversationProvider } from "@/contexts/ConversationContext";

export default function MainLayout() {
  return (
    <ConversationProvider>
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </ConversationProvider>
  );
}
