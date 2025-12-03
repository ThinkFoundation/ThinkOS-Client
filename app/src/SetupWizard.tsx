import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

type SetupStep = 'check' | 'choose' | 'installing' | 'pulling' | 'done';

interface Props {
  onComplete: () => void;
}

declare global {
  interface Window {
    electronAPI?: {
      checkOllama: () => Promise<{ installed: boolean; running: boolean }>;
      downloadOllama: () => Promise<{ success: boolean; error?: string }>;
      pullModel: (model: string) => Promise<{ success: boolean; error?: string }>;
      onOllamaDownloadProgress: (callback: (data: { progress: number; stage: string }) => void) => void;
      onModelPullProgress: (callback: (data: { progress?: number; status: string }) => void) => void;
      removeOllamaDownloadProgress: () => void;
      removeModelPullProgress: () => void;
      // Backend status handlers
      onBackendReady: (callback: () => void) => void;
      onBackendError: (callback: (data: { message: string }) => void) => void;
      removeBackendListeners: () => void;
    };
  }
}

export default function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState<SetupStep>('check');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');
  const [ollamaInstalled, setOllamaInstalled] = useState(false);

  useEffect(() => {
    checkOllama();
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.onOllamaDownloadProgress((data) => {
      setProgress(data.progress);
      const stageText = {
        downloading: 'Downloading Ollama...',
        installing: 'Installing...',
        starting: 'Starting Ollama...',
      }[data.stage] || 'Please wait...';
      setStatusText(stageText);
    });

    window.electronAPI.onModelPullProgress((data) => {
      if (data.progress !== undefined) {
        setProgress(data.progress);
      }
      if (data.status) {
        setStatusText(data.status);
      }
    });

    return () => {
      window.electronAPI?.removeOllamaDownloadProgress();
      window.electronAPI?.removeModelPullProgress();
    };
  }, []);

  const checkOllama = async () => {
    // Check via electron API first (knows if installed but not running)
    if (window.electronAPI) {
      const status = await window.electronAPI.checkOllama();
      setOllamaInstalled(status.installed);
      if (!status.running) {
        setStep('choose');
        return;
      }
    }

    // Ollama is running - check for models
    try {
      const res = await fetch('http://localhost:11434/api/tags');
      if (res.ok) {
        const data = await res.json();
        const models = data.models?.map((m: { name: string }) => m.name) || [];
        const hasEmbedding = models.some((n: string) => n.startsWith('nomic-embed-text'));

        if (!hasEmbedding && window.electronAPI) {
          setStep('pulling');
          setProgress(0);
          setStatusText('Downloading embedding model...');
          const result = await window.electronAPI.pullModel('nomic-embed-text');
          if (!result.success) {
            setError(result.error || 'Embedding model download failed');
            setStep('choose');
            return;
          }
        }

        setStep('done');
        return;
      }
    } catch {
      // Ollama not running - show choice screen
    }
    setStep('choose');
  };

  const installOllama = async () => {
    if (!window.electronAPI) {
      window.open('https://ollama.com/download', '_blank');
      return;
    }

    setStep('installing');
    setProgress(0);
    setStatusText('Starting download...');
    setError('');

    const result = await window.electronAPI.downloadOllama();

    if (!result.success) {
      setError(result.error || 'Installation failed');
      setStep('choose');
      return;
    }

    // Pull the chat model
    setStep('pulling');
    setProgress(0);
    setStatusText('Downloading chat model...');

    const pullResult = await window.electronAPI.pullModel('llama3.2');

    if (!pullResult.success) {
      setError(pullResult.error || 'Model download failed');
      setStep('choose');
      return;
    }

    // Pull the embedding model
    setProgress(0);
    setStatusText('Downloading embedding model...');

    const embedResult = await window.electronAPI.pullModel('nomic-embed-text');

    if (!embedResult.success) {
      setError(embedResult.error || 'Embedding model download failed');
      setStep('choose');
      return;
    }

    setStep('done');
  };

  if (step === 'check') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-[400px]">
          <CardHeader>
            <CardTitle>Setting up Think...</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Checking for local AI...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'choose') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-[400px]">
          <CardHeader>
            <CardTitle>{ollamaInstalled ? 'Start Ollama' : 'Choose Your AI Provider'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground mb-4">
              {ollamaInstalled
                ? 'Ollama is installed but not running. Start it to use local AI.'
                : 'Think works with local AI (Ollama) or cloud providers (OpenAI, Claude).'}
            </p>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button className="w-full" onClick={installOllama}>
              {ollamaInstalled ? 'Start Ollama' : 'Install Ollama (Free, Private)'}
            </Button>
            <Button variant="secondary" className="w-full" onClick={onComplete}>
              Use Cloud API Only
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'installing' || step === 'pulling') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-[400px]">
          <CardHeader>
            <CardTitle>
              {step === 'installing' ? 'Installing Ollama' : 'Downloading AI Model'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={progress} className="w-full" />
            <p className="text-sm text-muted-foreground">{statusText}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <Card className="w-[400px]">
        <CardHeader>
          <CardTitle>You're All Set!</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground">Ollama is running. You can now use local AI.</p>
          <Button className="w-full" onClick={onComplete}>
            Get Started
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
