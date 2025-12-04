import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Circle, Loader2 } from "lucide-react";
import { API_BASE_URL } from "../constants";

interface Settings {
  ai_provider: string;
  openai_api_key: string;
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
  });
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>({
    installed: false,
    running: false,
  });
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Profile state
  const [profileName, setProfileName] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchOllamaStatus();
    fetchProfile();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    }
  };

  const fetchOllamaStatus = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/settings/ollama-status`);
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
      const res = await fetch(`${API_BASE_URL}/api/settings/profile`);
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
      const res = await fetch(`${API_BASE_URL}/api/settings/profile`, {
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
      const updates: { ai_provider?: string; openai_api_key?: string } = {
        ai_provider: settings.ai_provider,
      };

      if (apiKey) {
        updates.openai_api_key = apiKey;
      }

      const res = await fetch(`${API_BASE_URL}/api/settings`, {
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
                  <p className="font-medium">OpenAI</p>
                  <p className="text-sm text-muted-foreground">
                    Cloud-based, requires API key
                  </p>
                </div>
              </div>
            </button>
          </div>

          {settings.ai_provider === "openai" && (
            <div className="pt-2">
              <label className="text-sm font-medium">OpenAI API Key</label>
              <Input
                type="password"
                placeholder={
                  settings.openai_api_key ? "••• Key saved •••" : "sk-..."
                }
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Get your API key from{" "}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  platform.openai.com
                </a>
              </p>
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
