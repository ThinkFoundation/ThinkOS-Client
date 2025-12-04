import { Circle, Loader2 } from "lucide-react";
import { useProviderStatus, ProviderStatus } from "../hooks/useProviderStatus";
import { cn } from "@/lib/utils";

function getStatusColor(status: ProviderStatus["status"]): string {
  switch (status) {
    case "running":
    case "ready":
      return "fill-green-500 text-green-500";
    case "offline":
    case "no-key":
      return "fill-gray-400 text-gray-400";
    default:
      return "fill-gray-400 text-gray-400";
  }
}

function getProviderLabel(provider: ProviderStatus["provider"]): string {
  return provider === "ollama" ? "Ollama" : "OpenAI";
}

export default function ProviderStatusIndicator() {
  const { status, isLoading, error } = useProviderStatus({
    pollInterval: 30000,
  });

  if (isLoading && !status) {
    return (
      <div className="px-2 py-3 border-t flex flex-col items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="px-2 py-3 border-t flex flex-col items-center gap-1">
        <Circle className="h-2 w-2 fill-gray-400 text-gray-400" />
        <span className="text-[10px] text-muted-foreground">Offline</span>
      </div>
    );
  }

  if (!status) return null;

  return (
    <div
      className="px-2 py-3 border-t flex flex-col items-center gap-0.5"
      title={`${getProviderLabel(status.provider)} - ${status.model}\nStatus: ${status.status_label}`}
    >
      <Circle className={cn("h-2 w-2", getStatusColor(status.status))} />

      <span className="text-[10px] font-medium text-foreground leading-tight">
        {getProviderLabel(status.provider)}
      </span>

      <span className="text-[9px] text-muted-foreground leading-tight truncate max-w-full">
        {status.model}
      </span>

      <span
        className={cn(
          "text-[9px] leading-tight",
          status.status === "running" || status.status === "ready"
            ? "text-green-600"
            : "text-muted-foreground"
        )}
      >
        {status.status_label}
      </span>
    </div>
  );
}
