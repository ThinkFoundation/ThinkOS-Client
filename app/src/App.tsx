import { useState, useEffect } from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import SetupWizard from "./SetupWizard";
import LockScreen from "./LockScreen";
import MainLayout from "./layouts/MainLayout";
import HomePage from "./pages/HomePage";
import MemoriesPage from "./pages/MemoriesPage";
import SettingsPage from "./pages/SettingsPage";
import { NamePromptDialog } from "./components/NamePromptDialog";
import { Button } from "@/components/ui/button";
import { API_BASE_URL } from "./constants";

const APP_VERSION = "1.1.0";

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
  const [userName, setUserName] = useState<string | null>(null);
  const [showNameDialog, setShowNameDialog] = useState(false);

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
    } else {
      setAppState("ai_setup");
    }
  };

  const fetchUserProfile = async (): Promise<string | null> => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/settings/profile`);
      if (res.ok) {
        const data = await res.json();
        const name = data.name || null;
        setUserName(name);
        return name;
      }
    } catch (err) {
      console.error("Failed to fetch user profile:", err);
    }
    return null;
  };

  const checkNamePrompt = async () => {
    const name = await fetchUserProfile();

    // If user already has a name, don't show dialog
    if (name) return;

    // If user dismissed the prompt before, don't show again
    const dismissed = localStorage.getItem("think_name_prompt_dismissed");
    if (dismissed === "true") return;

    // Check app version for "first load after update" detection
    const lastSeenVersion = localStorage.getItem("think_app_version");

    // Show dialog for new users or after updates
    if (!lastSeenVersion || lastSeenVersion !== APP_VERSION) {
      setShowNameDialog(true);
      localStorage.setItem("think_app_version", APP_VERSION);
    }
  };

  const handleUnlock = () => {
    checkAiSetup();
  };

  const handleAiSetupComplete = () => {
    localStorage.setItem("think_ai_setup_complete", "true");
    setAppState("ready");
    checkNamePrompt();
  };

  // Check name prompt when app becomes ready (for existing users after unlock)
  useEffect(() => {
    if (appState === "ready") {
      checkNamePrompt();
    }
  }, [appState]);

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
    <>
      <MemoryRouter>
        <Routes>
          <Route element={<MainLayout />}>
            <Route path="/" element={<HomePage userName={userName} />} />
            <Route path="/memories" element={<MemoriesPage />} />
            <Route
              path="/settings"
              element={<SettingsPage onNameChange={setUserName} />}
            />
          </Route>
        </Routes>
      </MemoryRouter>

      <NamePromptDialog
        open={showNameDialog}
        onOpenChange={setShowNameDialog}
        onNameSaved={(name) => setUserName(name)}
      />
    </>
  );
}

export default App;
