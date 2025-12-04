import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { saveMemory, updateMemory, type SaveMemoryResult } from './native-client';
import { useSystemTheme } from '@/hooks/useSystemTheme';
import './index.css';

interface DuplicateInfo {
  id: number;
  title: string;
  created_at: string;
}

interface PendingMemory {
  url: string;
  title: string;
  content: string;
}

function PopupHeader() {
  return (
    <div className="flex items-center justify-center mb-6">
       <img src="branding/Think_OS_Full_Word_Mark-lightmode.svg" alt="Think" className="h-6 dark:hidden" />
       <img src="branding/Think_OS_Full_Word_Mark.svg" alt="Think" className="h-6 hidden dark:block" />
    </div>
  );
}

function Popup() {
  const [status, setStatus] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const [pending, setPending] = useState<PendingMemory | null>(null);

  useSystemTheme();

  const savePage = async () => {
    setSaving(true);
    setStatus('Saving...');
    setDuplicate(null);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        func: () => document.body.innerText
      });

      const memoryData = {
        url: tab.url,
        title: tab.title || '',
        content: result.result as string
      };

      const response = await saveMemory(memoryData) as SaveMemoryResult;

      if ('duplicate' in response && response.duplicate) {
        setDuplicate(response.existing_memory);
        setPending(memoryData as PendingMemory);
        setStatus('');
      } else {
        setStatus('Saved!');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      // Provide helpful message for common errors
      if (message.includes('not running') || message.includes('connect') || message.includes('exited')) {
        setStatus('Please open the Think app first');
      } else {
        setStatus('Error: ' + message);
      }
    } finally {
      setSaving(false);
    }
  };

  const updateExisting = async () => {
    if (!duplicate || !pending) return;
    setSaving(true);
    setStatus('Updating...');

    try {
      await updateMemory(duplicate.id, pending);
      setStatus('Updated!');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setStatus('Error: ' + message);
    } finally {
      setSaving(false);
      setDuplicate(null);
      setPending(null);
    }
  };

  const cancelUpdate = () => {
    setDuplicate(null);
    setPending(null);
    setStatus('');
  };

  if (duplicate) {
    const date = new Date(duplicate.created_at).toLocaleDateString();
    return (
      <div className="p-4 w-full bg-background min-h-[200px]">
        <PopupHeader />
        <div className="bg-secondary/30 p-3 rounded-md mb-4 border border-border text-center">
           <p className="text-sm font-medium mb-1">Page already saved</p>
           <p className="text-xs text-muted-foreground">Saved on {date}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button className="w-full" onClick={updateExisting} disabled={saving}>
            {saving ? 'Updating...' : 'Update'}
          </Button>
          <Button className="w-full" variant="outline" onClick={cancelUpdate} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 w-full bg-background min-h-[200px]">
      <PopupHeader />
      <div className="space-y-4">
          <Button className="w-full h-10 font-medium shadow-sm hover:shadow-md transition-all" onClick={savePage} disabled={saving}>
            {saving ? (
              <div className="flex items-center gap-2">
                 <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                 Saving...
              </div>
            ) : (
              'Save This Page'
            )}
          </Button>
          {status && (
            <div className={`text-sm p-2 rounded-md text-center animate-in fade-in slide-in-from-bottom-2 ${status.includes('Error') || status.includes('Please') ? 'bg-destructive/10 text-destructive' : 'bg-green-500/10 text-green-600'}`}>
               {status}
            </div>
          )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
);