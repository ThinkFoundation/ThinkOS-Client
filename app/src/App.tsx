import { useState, useEffect } from "react";
import SetupWizard from "./SetupWizard";
import LockScreen from "./LockScreen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { API_BASE_URL } from "./constants";

interface Note {
  id: number;
  url: string;
  title: string;
  created_at: string;
}

type AppState =
  | "waiting_for_backend"
  | "loading"
  | "setup"
  | "locked"
  | "ai_setup"
  | "ready"
  | "error";

function App() {
  const [appState, setAppState] = useState<AppState>("waiting_for_backend");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    // Check if running in Electron
    if (window.electronAPI) {
      // Listen for backend ready signal from main process
      window.electronAPI.onBackendReady(() => {
        setAppState("loading");
        checkAuthStatus();
      });

      window.electronAPI.onBackendError((data: { message: string }) => {
        setErrorMessage(data.message);
        setAppState("error");
      });

      // Cleanup listeners on unmount
      return () => {
        window.electronAPI?.removeBackendListeners();
      };
    } else {
      // Not in Electron (e.g., dev server in browser) - check immediately
      setAppState("loading");
      checkAuthStatus();
    }
  }, []);

  const checkAuthStatus = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/status`);
      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`);
      }
      const data = await res.json();

      if (!data.has_password) {
        setAppState("setup");
      } else if (!data.is_unlocked) {
        setAppState("locked");
      } else {
        checkAiSetup();
      }
    } catch (err) {
      // Backend was ready but auth check failed - this is a real error
      console.error("Auth status check failed:", err);
      setErrorMessage("Failed to connect to backend");
      setAppState("error");
    }
  };

  const checkAiSetup = () => {
    const aiSetupComplete =
      localStorage.getItem("think_ai_setup_complete") === "true";
    if (aiSetupComplete) {
      setAppState("ready");
      fetchNotes();
    } else {
      setAppState("ai_setup");
    }
  };

  const handleUnlock = () => {
    checkAiSetup();
  };

  const handleAiSetupComplete = () => {
    localStorage.setItem("think_ai_setup_complete", "true");
    setAppState("ready");
    fetchNotes();
  };

  const fetchNotes = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/notes`);
      if (!res.ok) {
        throw new Error(`Failed to fetch notes: ${res.status}`);
      }
      const data = await res.json();
      setNotes(data.notes || []);
    } catch (err) {
      console.error("Failed to fetch notes:", err);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/notes/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(`Failed to delete note: ${res.status}`);
      }
      fetchNotes();
    } catch (err) {
      console.error("Failed to delete note:", err);
    }
  };

  const handleChat = async () => {
    if (!message.trim()) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) {
        throw new Error(`Chat request failed: ${res.status}`);
      }
      const data = await res.json();
      // TODO: Display chat response in UI
      console.log("Chat response:", data);
    } catch (err) {
      console.error("Chat failed:", err);
    }
  };

  if (appState === "waiting_for_backend") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <p className="text-muted-foreground">Starting ThinkOS...</p>
      </div>
    );
  }

  if (appState === "error") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-destructive font-medium">Failed to start</p>
        <p className="text-muted-foreground text-sm">{errorMessage}</p>
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  if (appState === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (appState === "setup") {
    return <LockScreen needsSetup={true} onUnlock={handleUnlock} />;
  }

  if (appState === "locked") {
    return <LockScreen needsSetup={false} onUnlock={handleUnlock} />;
  }

  if (appState === "ai_setup") {
    return <SetupWizard onComplete={handleAiSetupComplete} />;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Think</h1>
      <p className="text-muted-foreground mb-8">
        Your personal AI assistant for saved content.
      </p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Chat</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ask about your saved content..."
              className="flex-1"
            />
            <Button onClick={handleChat}>Send</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved Notes ({notes.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {notes.length === 0 ? (
            <p className="text-muted-foreground">
              No notes yet. Save some content via the browser extension!
            </p>
          ) : (
            <div className="space-y-3">
              {notes.map((note) => (
                <div
                  key={note.id}
                  className="flex items-center justify-between p-3 border rounded-md"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">
                      {note.title || "Untitled"}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">
                      {note.url}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(note.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(note.id)}
                  >
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default App;
