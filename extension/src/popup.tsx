import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { saveMemory, updateMemory, type SaveMemoryResult } from './native-client';
import { useSystemTheme } from '@/hooks/useSystemTheme';
import { Bookmark, MessageCircle, Sparkles, RefreshCw, X } from 'lucide-react';
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
        <div className="bg-white/70 dark:bg-white/5 backdrop-blur-xl p-3.5 rounded-lg mb-4 border border-white/60 dark:border-white/10 shadow-sm shadow-black/5 dark:shadow-black/20 text-center">
           <Bookmark className="w-5 h-5 mx-auto mb-2 text-primary" />
           <p className="text-sm font-medium mb-1">Page already saved</p>
           <p className="text-xs text-muted-foreground">Saved on {date}</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Button className="w-full h-10" onClick={updateExisting} disabled={saving}>
            <div className="flex items-center gap-2">
              {saving ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span>{saving ? 'Updating...' : 'Update'}</span>
            </div>
          </Button>
          <Button className="w-full h-10" variant="outline" onClick={cancelUpdate} disabled={saving}>
            <div className="flex items-center gap-2">
              <X className="w-4 h-4" />
              <span>Cancel</span>
            </div>
          </Button>
        </div>
      </div>
    );
  }

  const openChat = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id || !tab.url) {
        setStatus('Cannot chat on this page');
        return;
      }

      // Check if it's a restricted page
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://')) {
        setStatus('Cannot chat on browser pages');
        return;
      }

      try {
        // Try to send message to existing content script
        await chrome.tabs.sendMessage(tab.id, { action: 'openSidebar' });
        window.close();
      } catch {
        // Content script not loaded, inject it first
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        });
        // Wait a bit for script to initialize
        await new Promise(resolve => setTimeout(resolve, 100));
        await chrome.tabs.sendMessage(tab.id, { action: 'openSidebar' });
        window.close();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('Cannot access')) {
        setStatus('Cannot chat on this page');
      } else {
        setStatus('Could not open chat');
      }
    }
  };

  return (
    <div className="p-4 w-full bg-background min-h-[200px]">
      <PopupHeader />

      {/* Intro section */}
      <div className="flex items-center gap-2 mb-4 p-2.5 rounded-lg bg-white/70 dark:bg-white/5 backdrop-blur-xl border border-white/60 dark:border-white/10 shadow-sm shadow-black/5 dark:shadow-black/20">
        <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Save pages to your knowledge base or chat with AI about the content.
        </p>
      </div>

      <div className="space-y-2.5">
          <Button className="w-full h-11 font-medium shadow-sm hover:shadow-md transition-all justify-start px-4" onClick={savePage} disabled={saving}>
            {saving ? (
              <div className="flex items-center gap-3">
                 <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                 <span>Saving...</span>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Bookmark className="w-4 h-4" />
                <span>Save to Think</span>
              </div>
            )}
          </Button>
          <Button className="w-full h-11 font-medium shadow-sm hover:shadow-md transition-all justify-start px-4" variant="outline" onClick={openChat}>
            <div className="flex items-center gap-3">
              <MessageCircle className="w-4 h-4" />
              <span>Chat with Page</span>
            </div>
          </Button>
          {status && (
            <div className={`text-sm p-2.5 rounded-md text-center animate-in fade-in slide-in-from-bottom-2 ${status.includes('Error') || status.includes('Please') ? 'bg-destructive/10 text-destructive' : 'bg-green-500/10 text-green-600 dark:text-green-400'}`}>
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