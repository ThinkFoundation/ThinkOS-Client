import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Circle, Loader2, Monitor, Sun, Moon } from "lucide-react";
import { Theme, setTheme, getTheme } from "@/hooks/useSystemTheme";
import { apiFetch } from "@/lib/api";

interface Settings {
  ai_provider: string;
  openai_api_key: string;
  openai_base_url: string;
}

interface OllamaStatus {
  installed: boolean;
  running: boolean;
}

interface SettingsPageProps {
  onNameChange?: (name: string | null) => void;
}

export default function SettingsPage({ onNameChange }: SettingsPageProps) {
  const [settings, setSettings] = useState<Settings>({
    ai_provider: "ollama",
    openai_api_key: "",
    openai_base_url: "",
  });
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>({
    installed: false,
    running: false,
  });
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Profile state
  const [profileName, setProfileName] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  // Theme state
  const [theme, setThemeState] = useState<Theme>(getTheme);

  useEffect(() => {
    fetchSettings();
    fetchOllamaStatus();
    fetchProfile();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await apiFetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setBaseUrl(data.openai_base_url || "");
      }
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    }
  };

  const fetchOllamaStatus = async () => {
    try {
      const res = await apiFetch("/api/settings/ollama-status");
      if (res.ok) {
        const data = await res.json();
        setOllamaStatus(data);
      }
    } catch (err) {
      console.error("Failed to fetch Ollama status:", err);
    }
  };

  const fetchProfile = async () => {
    try {
      const res = await apiFetch("/api/settings/profile");
      if (res.ok) {
        const data = await res.json();
        setProfileName(data.name || "");
        setOriginalName(data.name || "");
      }
    } catch (err) {
      console.error("Failed to fetch profile:", err);
    }
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    setProfileSaved(false);
    try {
      const res = await apiFetch("/api/settings/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: profileName }),
      });

      if (res.ok) {
        setProfileSaved(true);
        setOriginalName(profileName);
        onNameChange?.(profileName || null);
        setTimeout(() => setProfileSaved(false), 2000);
      }
    } catch (err) {
      console.error("Failed to save profile:", err);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const updates: { ai_provider?: string; openai_api_key?: string; openai_base_url?: string } = {
        ai_provider: settings.ai_provider,
        openai_base_url: baseUrl,
      };

      if (apiKey) {
        updates.openai_api_key = apiKey;
      }

      const res = await apiFetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (res.ok) {
        setSaved(true);
        setApiKey("");
        fetchSettings();
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  };

  const selectProvider = (provider: string) => {
    setSettings({ ...settings, ai_provider: provider });
  };

  const handleThemeChange = (newTheme: Theme) => {
    setThemeState(newTheme);
    setTheme(newTheme);
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Settings</h1>

      {/* Profile Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">Your Name</label>
            <Input
              placeholder="Enter your name"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Used for personalized greetings
            </p>
          </div>

          <Button
            onClick={handleSaveProfile}
            disabled={savingProfile || profileName === originalName}
            className="w-full"
          >
            {savingProfile ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : profileSaved ? (
              <Check className="h-4 w-4 mr-2" />
            ) : null}
            {profileSaved ? "Saved" : "Save Profile"}
          </Button>
        </CardContent>
      </Card>

      {/* Appearance Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {[
              { value: "system" as Theme, label: "System", icon: Monitor },
              { value: "light" as Theme, label: "Light", icon: Sun },
              { value: "dark" as Theme, label: "Dark", icon: Moon },
            ].map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => handleThemeChange(value)}
                className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-md border transition-colors ${
                  theme === value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <Icon className={`h-4 w-4 ${theme === value ? "text-primary" : "text-muted-foreground"}`} />
                <span className={`text-sm font-medium ${theme === value ? "text-foreground" : "text-muted-foreground"}`}>
                  {label}
                </span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Choose your preferred theme
          </p>
        </CardContent>
      </Card>

      {/* AI Provider Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">AI Provider</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <button
              onClick={() => selectProvider("ollama")}
              className={`w-full flex items-center justify-between p-3 rounded-md border transition-colors ${
                settings.ai_provider === "ollama"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    settings.ai_provider === "ollama"
                      ? "border-primary"
                      : "border-muted-foreground"
                  }`}
                >
                  {settings.ai_provider === "ollama" && (
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  )}
                </div>
                <div className="text-left">
                  <p className="font-medium">Ollama (Local)</p>
                  <p className="text-sm text-muted-foreground">
                    Free, private, runs on your machine
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {ollamaStatus.running ? (
                  <span className="text-xs text-green-600 flex items-center gap-1">
                    <Circle className="h-2 w-2 fill-green-600" />
                    Running
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Circle className="h-2 w-2" />
                    Not running
                  </span>
                )}
              </div>
            </button>

            <button
              onClick={() => selectProvider("openai")}
              className={`w-full flex items-center justify-between p-3 rounded-md border transition-colors ${
                settings.ai_provider === "openai"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    settings.ai_provider === "openai"
                      ? "border-primary"
                      : "border-muted-foreground"
                  }`}
                >
                  {settings.ai_provider === "openai" && (
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  )}
                </div>
                <div className="text-left">
                  <p className="font-medium">Cloud API</p>
                  <p className="text-sm text-muted-foreground">
                    OpenAI or compatible services
                  </p>
                </div>
              </div>
            </button>
          </div>

          {settings.ai_provider === "ollama" && !ollamaStatus.running && (
            <div className="pt-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  localStorage.removeItem("think_ai_setup_complete");
                  window.location.reload();
                }}
              >
                Run Ollama Setup Wizard
              </Button>
              <p className="text-xs text-muted-foreground mt-1 text-center">
                Install or start Ollama to use local AI
              </p>
            </div>
          )}

          {settings.ai_provider === "openai" && (
            <div className="pt-2 space-y-4">
              <div>
                <label className="text-sm font-medium">API Base URL</label>
                <Input
                  type="text"
                  placeholder="https://api.openai.com/v1"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Leave empty for OpenAI, or enter a custom endpoint for compatible services
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">API Key</label>
                <Input
                  type="password"
                  placeholder={
                    settings.openai_api_key ? "••• Key saved •••" : "Enter API key"
                  }
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  API key from your provider (OpenAI, Azure, etc.)
                </p>
              </div>
            </div>
          )}

          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : saved ? (
              <Check className="h-4 w-4 mr-2" />
            ) : null}
            {saved ? "Saved" : "Save Settings"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
