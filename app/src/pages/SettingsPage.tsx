import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Check, Circle, Loader2, Monitor, Sun, Moon, AlertTriangle } from "lucide-react";
import { Theme, setTheme, getTheme } from "@/hooks/useSystemTheme";
import { apiFetch } from "@/lib/api";
import { ModelSelector } from "@/components/ModelSelector";
import { useReembedJob } from "@/hooks/useReembedJob";

interface Settings {
  ai_provider: string;
  openai_api_key: string;
  openai_base_url: string;
}

interface OllamaStatus {
  installed: boolean;
  running: boolean;
}

interface EmbeddingImpact {
  affected_count: number;
  current_model: string;
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
  const [originalProvider, setOriginalProvider] = useState("ollama");
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>({
    installed: false,
    running: false,
  });
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Embedding model state (for unified save flow)
  const [pendingEmbeddingModel, setPendingEmbeddingModel] = useState<string>("");
  const [originalEmbeddingModel, setOriginalEmbeddingModel] = useState<string>("");

  // Profile state
  const [profileName, setProfileName] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  // Theme state
  const [theme, setThemeState] = useState<Theme>(getTheme);

  // Provider change warning state
  const [showProviderWarning, setShowProviderWarning] = useState(false);
  const [affectedCount, setAffectedCount] = useState(0);

  // Stale embeddings state (for manual re-embed button)
  const [staleEmbeddingsCount, setStaleEmbeddingsCount] = useState(0);
  const [showReembedDialog, setShowReembedDialog] = useState(false);

  // Use the reembed job hook for background re-embedding
  const reembedJob = useReembedJob({
    onComplete: (processed, failed) => {
      console.log(`Re-embed completed: ${processed} processed, ${failed} failed`);
      fetchStaleEmbeddingsCount();
      // Auto-close dialog after completion
      setTimeout(() => {
        setShowProviderWarning(false);
        setShowReembedDialog(false);
        reembedJob.reset();
      }, 1500);
    },
    onError: (error) => {
      console.error("Re-embed failed:", error);
      fetchStaleEmbeddingsCount();
    },
  });

  useEffect(() => {
    fetchSettings();
    fetchOllamaStatus();
    fetchProfile();
    fetchStaleEmbeddingsCount();
  }, []);

  const fetchEmbeddingModel = async (provider: string) => {
    try {
      const res = await apiFetch(`/api/settings/embedding-models?provider=${provider}`);
      if (res.ok) {
        const data = await res.json();
        const model = data.current_model || "";
        // Always reset to saved value on fetch (handles navigation back to page)
        setOriginalEmbeddingModel(model);
        setPendingEmbeddingModel(model);
      }
    } catch (err) {
      console.error("Failed to fetch embedding model:", err);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await apiFetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setOriginalProvider(data.ai_provider);
        setBaseUrl(data.openai_base_url || "");
        // Fetch embedding model after we know the actual provider
        await fetchEmbeddingModel(data.ai_provider);
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

  const checkEmbeddingImpact = async (): Promise<EmbeddingImpact | null> => {
    try {
      const res = await apiFetch("/api/settings/embedding-model-impact");
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.error("Failed to check embedding impact:", err);
    }
    return null;
  };

  const fetchStaleEmbeddingsCount = async () => {
    try {
      const res = await apiFetch("/api/memories/stale-embeddings-count");
      if (res.ok) {
        const data = await res.json();
        setStaleEmbeddingsCount(data.count);
      }
    } catch (err) {
      console.error("Failed to fetch stale embeddings count:", err);
    }
  };

  const handleManualReembed = async () => {
    setShowReembedDialog(true);
    await reembedJob.startJob();
  };

  const handleCancelReembed = () => {
    // Confirm if work is in progress
    if (reembedJob.isActive && reembedJob.processed > 0) {
      const confirmed = window.confirm(
        `Cancel re-embedding? ${reembedJob.processed} of ${reembedJob.total} memories processed so far will be kept.`
      );
      if (!confirmed) return;
    }
    reembedJob.cancelJob();
    setShowReembedDialog(false);
    setShowProviderWarning(false);
    reembedJob.reset();
    fetchStaleEmbeddingsCount();
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

  const doSave = async () => {
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
        // Save embedding model if it changed
        if (pendingEmbeddingModel && pendingEmbeddingModel !== originalEmbeddingModel) {
          await apiFetch("/api/settings/embedding-model", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: pendingEmbeddingModel }),
          });
        }

        setSaved(true);
        setApiKey("");
        setOriginalProvider(settings.ai_provider);
        setOriginalEmbeddingModel(pendingEmbeddingModel);
        fetchSettings();
        fetchStaleEmbeddingsCount();
        // Notify other components (e.g., sidebar) to refresh provider status
        window.dispatchEvent(new Event("settings-changed"));
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const providerChanged = settings.ai_provider !== originalProvider;
    const embeddingModelChanged = pendingEmbeddingModel !== originalEmbeddingModel;

    // Check if provider or embedding model is changing
    if (providerChanged || embeddingModelChanged) {
      // Check embedding impact
      const impact = await checkEmbeddingImpact();
      if (impact && impact.affected_count > 0) {
        setAffectedCount(impact.affected_count);
        setShowProviderWarning(true);
        return;
      }
    }

    await doSave();
  };

  const handleProviderSaveAndReembed = async () => {
    // First save the settings
    await doSave();

    // Then start re-embedding via background job
    await reembedJob.startJob();
  };

  const handleProviderCancel = () => {
    // Revert provider and embedding model selection
    setSettings({ ...settings, ai_provider: originalProvider });
    setPendingEmbeddingModel(originalEmbeddingModel);
    setShowProviderWarning(false);
  };

  const selectProvider = (provider: string) => {
    setSettings({ ...settings, ai_provider: provider });
    // Reset embedding model to new provider's default
    if (provider === "ollama") {
      setPendingEmbeddingModel("mxbai-embed-large");
    } else {
      setPendingEmbeddingModel("text-embedding-3-small");
    }
  };

  const handleThemeChange = (newTheme: Theme) => {
    setThemeState(newTheme);
    setTheme(newTheme);
  };

  // Progress from the job hook
  const progressPercent = reembedJob.progress;

  return (
    <>
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

            {/* Chat Model Selection */}
            <div className="pt-2 border-t">
              <label className="text-sm font-medium block mb-2">Chat Model</label>
              <ModelSelector type="chat" provider={settings.ai_provider} />
              <p className="text-xs text-muted-foreground mt-1">
                {settings.ai_provider === "ollama"
                  ? "Select a model from your Ollama installation"
                  : "Select which model to use for chat"}
              </p>
            </div>

            {/* Embedding Model Selection */}
            <div className="pt-4">
              <label className="text-sm font-medium block mb-2">Embedding Model</label>
              <ModelSelector
                type="embedding"
                provider={settings.ai_provider}
                selectedModel={pendingEmbeddingModel}
                onModelChange={(model) => setPendingEmbeddingModel(model)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Used for memory search and RAG retrieval
              </p>

              {/* Re-embed button when there are stale embeddings */}
              {staleEmbeddingsCount > 0 && (
                <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-md">
                  <p className="text-sm text-amber-600 dark:text-amber-400 mb-2">
                    {staleEmbeddingsCount} {staleEmbeddingsCount === 1 ? "memory needs" : "memories need"} re-embedding
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleManualReembed}
                    className="w-full"
                  >
                    Re-embed Now
                  </Button>
                </div>
              )}
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

      {/* Settings change warning dialog - rendered via portal for full-screen overlay */}
      {showProviderWarning && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
          <div className="bg-background border rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            {!reembedJob.isActive && reembedJob.status !== "completed" ? (
              <>
                <div className="flex items-start gap-3 mb-4">
                  <AlertTriangle className="h-6 w-6 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-lg">Save Settings?</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Your changes will affect how memories are embedded for search.
                    </p>
                    <p className="text-sm text-muted-foreground mt-2">
                      {affectedCount} {affectedCount === 1 ? "memory" : "memories"} will need to be
                      re-embedded for search to work correctly.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Button onClick={handleProviderSaveAndReembed} className="w-full">
                    Save & Re-embed Now
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleProviderCancel}
                    className="w-full"
                  >
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-lg">Re-embedding Memories</h3>
                  {reembedJob.status === "completed" && (
                    <Check className="h-5 w-5 text-green-500" />
                  )}
                </div>

                <div className="space-y-3">
                  <Progress value={progressPercent} className="h-2" />
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>
                      {reembedJob.status === "completed"
                        ? "Complete!"
                        : `Processing... ${reembedJob.processed} of ${reembedJob.total}`}
                    </span>
                    <span>{progressPercent}%</span>
                  </div>
                  {reembedJob.failed > 0 && (
                    <p className="text-xs text-amber-500">
                      {reembedJob.failed} {reembedJob.failed === 1 ? "memory" : "memories"} failed to re-embed
                    </p>
                  )}
                  {reembedJob.isActive && (
                    <div className="flex justify-end pt-2">
                      <Button variant="outline" size="sm" onClick={handleCancelReembed}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Manual re-embed dialog */}
      {showReembedDialog && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
          <div className="bg-background border rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">Re-embedding Memories</h3>
              {reembedJob.status === "completed" && (
                <Check className="h-5 w-5 text-green-500" />
              )}
            </div>

            <div className="space-y-3">
              <Progress value={progressPercent} className="h-2" />
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>
                  {reembedJob.status === "completed"
                    ? "Complete!"
                    : `Processing... ${reembedJob.processed} of ${reembedJob.total}`}
                </span>
                <span>{progressPercent}%</span>
              </div>
              {reembedJob.failed > 0 && (
                <p className="text-xs text-amber-500">
                  {reembedJob.failed} {reembedJob.failed === 1 ? "memory" : "memories"} failed to re-embed
                </p>
              )}
              {reembedJob.isActive && (
                <div className="flex justify-end pt-2">
                  <Button variant="outline" size="sm" onClick={handleCancelReembed}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
