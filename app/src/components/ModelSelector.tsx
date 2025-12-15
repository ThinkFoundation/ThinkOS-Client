import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, Check, Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ModelInfo {
  name: string;
  size: string | null;
  is_downloaded: boolean;
  context_window: number;
}

interface ModelsResponse {
  models: ModelInfo[];
  current_model: string;
  provider: string;
}

interface ModelSelectorProps {
  type?: "chat" | "embedding";
  provider?: string;
  selectedModel?: string;  // For controlled component (embedding models)
  onModelChange?: (model: string) => void;
}

export function ModelSelector({ type = "chat", provider, selectedModel, onModelChange }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [currentModel, setCurrentModel] = useState("");
  const [fetchedProvider, setFetchedProvider] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const lastFetchedProviderRef = useRef<string | undefined>(undefined);

  // Use selectedModel prop if provided (controlled), otherwise use internal state
  const displayModel = selectedModel !== undefined ? selectedModel : currentModel;

  // Shared fetch logic for models
  const fetchModels = useCallback(async (): Promise<ModelsResponse | null> => {
    setIsLoading(true);
    try {
      const baseEndpoint = type === "embedding" ? "/api/settings/embedding-models" : "/api/settings/models";
      const endpoint = provider ? `${baseEndpoint}?provider=${provider}` : baseEndpoint;
      const res = await apiFetch(endpoint);
      if (res.ok) {
        const data: ModelsResponse = await res.json();
        setModels(data.models);
        setCurrentModel(data.current_model);
        setFetchedProvider(data.provider);
        return data;
      }
    } catch (err) {
      console.error("Failed to fetch models:", err);
    } finally {
      setIsLoading(false);
    }
    return null;
  }, [type, provider]);

  // Initial fetch on mount or when type/provider changes
  useEffect(() => {
    // Skip if we already fetched for this provider (prevents flashing during polling)
    if (lastFetchedProviderRef.current === provider && models.length > 0) {
      return;
    }
    lastFetchedProviderRef.current = provider;

    setCurrentModel(""); // Clear stale model before fetch
    fetchModels().then((data) => {
      // Notify parent of the initial model (for controlled mode)
      if (data && type === "embedding" && selectedModel === undefined) {
        onModelChange?.(data.current_model);
      }
    });
  }, [fetchModels, type, selectedModel, onModelChange, provider, models.length]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Listen for model pull progress from Electron
  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.onModelPullProgress((data) => {
      if (data.progress !== undefined) {
        setPullProgress(data.progress);
      }
    });

    return () => {
      window.electronAPI?.removeModelPullProgress?.();
    };
  }, []);


  const selectModel = async (modelName: string) => {
    // For embedding models, just notify parent (no immediate save)
    if (type === "embedding") {
      onModelChange?.(modelName);
      setIsOpen(false);
      return;
    }

    // For chat models, save immediately
    try {
      const res = await apiFetch("/api/settings/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelName, provider }),
      });

      if (res.ok) {
        setCurrentModel(modelName);
        onModelChange?.(modelName);
        // Notify sidebar to refresh provider status
        window.dispatchEvent(new Event("settings-changed"));
        setIsOpen(false);
      }
    } catch (err) {
      console.error("Failed to select model:", err);
    }
  };

  const pullModel = async (modelName: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!window.electronAPI) {
      console.error("Electron API not available");
      return;
    }

    setPullingModel(modelName);
    setPullProgress(0);

    const result = await window.electronAPI.pullModel(modelName);

    if (result.success) {
      // Refresh models list
      await fetchModels();
    } else {
      console.error("Failed to pull model:", result.error);
    }

    setPullingModel(null);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="outline"
        className="w-full justify-between"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
      >
        <span className="truncate">
          {isLoading ? "Loading..." : displayModel || "Select model"}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 ml-2 transition-transform flex-shrink-0",
            isOpen && "rotate-180"
          )}
        />
      </Button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 max-h-[300px] overflow-y-auto">
          {models.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
              {fetchedProvider === "ollama"
                ? "No models found. Pull a model to get started."
                : "No models available."}
            </div>
          ) : (
            models.map((model) => (
              <div
                key={model.name}
                className={cn(
                  "flex items-center justify-between px-3 py-2.5 hover:bg-muted/50 cursor-pointer",
                  model.name === displayModel && "bg-muted"
                )}
                onClick={() => model.is_downloaded && selectModel(model.name)}
              >
                <div className="flex-1 min-w-0 mr-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{model.name}</span>
                    {model.name === displayModel && (
                      <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground flex gap-2">
                    {model.size && <span>{model.size}</span>}
                    <span>{model.context_window.toLocaleString()} tokens</span>
                  </div>
                </div>

                {/* Download button for Ollama models not yet pulled */}
                {fetchedProvider === "ollama" && !model.is_downloaded && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-shrink-0"
                    onClick={(e) => pullModel(model.name, e)}
                    disabled={pullingModel !== null}
                  >
                    {pullingModel === model.name ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        <span className="text-xs">{Math.round(pullProgress)}%</span>
                      </>
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
