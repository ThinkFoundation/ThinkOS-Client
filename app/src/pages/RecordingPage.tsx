import { useState, useRef, useEffect } from "react";
import { Mic, Square, Loader2, X, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

type RecordingState = "idle" | "recording" | "uploading" | "done" | "error";

export default function RecordingPage() {
  const [state, setState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Enumerate audio devices on mount and after permission granted
  const enumerateDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter((d) => d.kind === "audioinput");
      setAudioDevices(mics);

      // Restore saved preference if still available
      const saved = localStorage.getItem("think_preferred_mic");
      if (saved && mics.some((m) => m.deviceId === saved)) {
        setSelectedDeviceId(saved);
      }
    } catch (err) {
      console.error("Failed to enumerate devices:", err);
    }
  };

  useEffect(() => {
    enumerateDevices();
    // Re-enumerate when devices change (e.g., plugging in a mic)
    navigator.mediaDevices.addEventListener("devicechange", enumerateDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", enumerateDevices);
    };
  }, []);

  // Notify main process of recording state changes (for blur handler)
  useEffect(() => {
    const isRecording = state === "recording" || state === "uploading";
    window.electronAPI?.setRecordingState?.(isRecording);
    return () => {
      window.electronAPI?.setRecordingState?.(false);
    };
  }, [state]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTimer();
      cleanupStream();
    };
  }, []);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const cleanupStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const startRecording = async () => {
    try {
      setError(null);
      const audioConstraints = selectedDeviceId
        ? { deviceId: { exact: selectedDeviceId } }
        : true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      streamRef.current = stream;

      // Re-enumerate devices after permission granted (to get labels)
      enumerateDevices();

      // Use webm/opus for good compression and broad support
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stopTimer();
        cleanupStream();

        if (chunksRef.current.length === 0) {
          setState("idle");
          return;
        }

        setState("uploading");
        await uploadRecording();
      };

      mediaRecorder.onerror = (e) => {
        console.error("MediaRecorder error:", e);
        setError("Recording failed");
        setState("error");
        cleanupStream();
      };

      mediaRecorder.start(1000); // Collect data every second
      setState("recording");
      setDuration(0);

      // Start duration timer
      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Failed to start recording:", err);
      setError("Microphone access denied");
      setState("error");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && state === "recording") {
      mediaRecorderRef.current.stop();
    }
  };

  const uploadRecording = async () => {
    try {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });

      // Create a file with a timestamp name
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = new File([blob], `voice-note-${timestamp}.webm`, {
        type: "audio/webm",
      });

      const formData = new FormData();
      formData.append("file", file);

      const response = await apiFetch("/api/media/record", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      setState("done");

      // Close the window after a brief success indication
      setTimeout(() => {
        window.close();
      }, 1000);
    } catch (err) {
      console.error("Failed to upload recording:", err);
      setError("Upload failed");
      setState("error");
    }
  };

  const handleClose = () => {
    if (state === "recording") {
      stopRecording();
    } else {
      window.close();
    }
  };

  return (
    <div
      className={cn(
        "fixed inset-0 flex flex-col items-center justify-center p-4",
        "bg-card"
      )}
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Close button */}
      <button
        onClick={handleClose}
        className={cn(
          "absolute top-2 right-2 p-1.5 rounded-full",
          "text-muted-foreground hover:text-foreground hover:bg-muted/50",
          "transition-colors"
        )}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <X className="h-4 w-4" />
      </button>

      {/* Title */}
      <p className="text-sm text-muted-foreground mb-2">
        {state === "idle" && "Click to record"}
        {state === "recording" && "Recording..."}
        {state === "uploading" && "Saving..."}
        {state === "done" && "Saved!"}
        {state === "error" && (error || "Error")}
      </p>

      {/* Microphone selector - only show when idle or error */}
      {(state === "idle" || state === "error") && audioDevices.length > 1 && (
        <div className="relative mb-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <select
            value={selectedDeviceId}
            onChange={(e) => {
              setSelectedDeviceId(e.target.value);
              localStorage.setItem("think_preferred_mic", e.target.value);
            }}
            className={cn(
              "appearance-none w-44 text-xs bg-muted/50 border border-border rounded-md",
              "pl-2.5 pr-7 py-1.5 text-foreground cursor-pointer",
              "focus:outline-none focus:ring-1 focus:ring-ring",
              "hover:bg-muted/70 transition-colors"
            )}
          >
            <option value="">Default Microphone</option>
            {audioDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Mic ${device.deviceId.slice(0, 6)}...`}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        </div>
      )}

      {/* Record button */}
      <button
        onClick={state === "idle" || state === "error" ? startRecording : stopRecording}
        disabled={state === "uploading" || state === "done"}
        className={cn(
          "w-20 h-20 rounded-full flex items-center justify-center",
          "transition-all duration-200",
          state === "idle" || state === "error"
            ? "bg-orange-100 hover:bg-orange-200 dark:bg-orange-900/30 dark:hover:bg-orange-900/50 text-orange-600"
            : state === "recording"
            ? "bg-red-500 hover:bg-red-600 text-white animate-pulse"
            : state === "uploading"
            ? "bg-muted text-muted-foreground"
            : "bg-green-500 text-white"
        )}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {state === "idle" || state === "error" ? (
          <Mic className="h-8 w-8" />
        ) : state === "recording" ? (
          <Square className="h-6 w-6 fill-current" />
        ) : state === "uploading" ? (
          <Loader2 className="h-8 w-8 animate-spin" />
        ) : (
          <Check className="h-8 w-8" />
        )}
      </button>

      {/* Duration */}
      {state === "recording" && (
        <p className="text-2xl font-mono mt-3 text-foreground">
          {formatDuration(duration)}
        </p>
      )}

      {/* Hint */}
      {state === "idle" && (
        <p className="text-xs text-muted-foreground/70 mt-3">
          Press to start recording
        </p>
      )}
      {state === "recording" && (
        <p className="text-xs text-muted-foreground/70 mt-1">
          Press to stop
        </p>
      )}
    </div>
  );
}
