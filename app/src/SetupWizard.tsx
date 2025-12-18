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
      onBackendReady: (callback: (data?: { token?: string }) => void) => void;
      onBackendError: (callback: (data: { message: string }) => void) => void;
      removeBackendListeners: () => void;
      // App token for API authentication
      getAppToken: () => string | null;
    };
  }
}

function WizardLayout({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="relative flex items-center justify-center min-h-screen bg-background p-4">
      {/* Animated gradient background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-80 h-80 bg-primary/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -right-40 w-80 h-80 bg-primary/15 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      <div className="relative w-full max-w-[320px] space-y-8">
        <div className="flex justify-center">
          <img src="./branding/Think_OS_Full_Word_Mark-lightmode.svg" alt="Think" className="h-8 dark:hidden" />
          <img src="./branding/Think_OS_Full_Word_Mark.svg" alt="Think" className="h-8 hidden dark:block" />
        </div>
        <Card className="shadow-large">
          <CardHeader className="pb-2">
            {title && <CardTitle className="text-center text-lg font-semibold">{title}</CardTitle>}
          </CardHeader>
          <CardContent>
            {children}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const formatPullStatus = (status: string): string => {
  if (status.startsWith('pulling manifest')) return 'Preparing download...';
  if (status.startsWith('pulling ')) return 'Downloading model...';
  if (status.startsWith('verifying')) return 'Verifying download...';
  if (status.startsWith('writing')) return 'Finalizing...';
  if (status === 'success') return 'Complete!';
  return status;
};

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
        setStatusText(formatPullStatus(data.status));
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
        const hasChatModel = models.some((n: string) => n.startsWith('llama3.2'));
        const hasEmbedding = models.some((n: string) => n.startsWith('mxbai-embed-large'));

        if ((!hasChatModel || !hasEmbedding) && window.electronAPI) {
          setStep('pulling');

          // Pull chat model if missing
          if (!hasChatModel) {
            setProgress(0);
            setStatusText('Downloading chat model...');
            const chatResult = await window.electronAPI.pullModel('llama3.2');
            if (!chatResult.success) {
              setError(chatResult.error || 'Chat model download failed');
              setStep('choose');
              return;
            }
          }

          // Pull embedding model if missing
          if (!hasEmbedding) {
            setProgress(0);
            setStatusText('Downloading embedding model...');
            const embedResult = await window.electronAPI.pullModel('mxbai-embed-large');
            if (!embedResult.success) {
              setError(embedResult.error || 'Embedding model download failed');
              setStep('choose');
              return;
            }
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

    const embedResult = await window.electronAPI.pullModel('mxbai-embed-large');

    if (!embedResult.success) {
      setError(embedResult.error || 'Embedding model download failed');
      setStep('choose');
      return;
    }

    setStep('done');
  };

  if (step === 'check') {
    return (
      <WizardLayout title="Setting up Think...">
        <div className="flex flex-col items-center justify-center py-6">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-muted-foreground">Checking for local AI...</p>
        </div>
      </WizardLayout>
    );
  }

  if (step === 'choose') {
    return (
      <WizardLayout title={ollamaInstalled ? 'Start Ollama' : 'Choose Your AI Provider'}>
          <p className="text-muted-foreground text-center mb-6 text-sm">
            {ollamaInstalled
              ? 'Ollama is installed but not running. Start it to use local AI.'
              : 'Think works best with local AI (Ollama) for privacy and speed. You can also use cloud providers.'}
          </p>
          <div className="space-y-3">
            {error && <p className="text-destructive text-sm text-center bg-destructive/10 p-2 rounded-md">{error}</p>}
            <Button className="w-full" onClick={installOllama}>
              {ollamaInstalled ? 'Start Ollama' : 'Install Ollama (Recommended)'}
            </Button>
            <Button variant="ghost" className="w-full text-muted-foreground hover:text-foreground" onClick={onComplete}>
              Skip and use Cloud API only
            </Button>
          </div>
      </WizardLayout>
    );
  }

  if (step === 'installing' || step === 'pulling') {
    return (
      <WizardLayout title={step === 'installing' ? 'Installing Ollama' : 'Downloading AI Model'}>
          <div className="py-4 space-y-4">
            <Progress value={progress} className="w-full h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
               <span>{statusText}</span>
               <span>{Math.round(progress)}%</span>
            </div>
          </div>
      </WizardLayout>
    );
  }

  return (
    <WizardLayout title="You're All Set!">
        <div className="space-y-6 text-center">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-muted-foreground">
            Ollama is running and models are ready. <br/>
            You can now use Think with local AI.
          </p>
          <Button className="w-full" onClick={onComplete}>
            Get Started
          </Button>
        </div>
    </WizardLayout>
  );
}