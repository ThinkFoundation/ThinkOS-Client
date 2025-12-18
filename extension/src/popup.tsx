import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { saveMemory, updateMemory, type SaveMemoryResult } from './native-client';
import { useSystemTheme } from '@/hooks/useSystemTheme';
import { Bookmark, RefreshCw, X } from 'lucide-react';
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

function Popup() {
  const [status, setStatus] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const [pending, setPending] = useState<PendingMemory | null>(null);
  const [pageTitle, setPageTitle] = useState<string>('');

  useSystemTheme();

  // Ensure fonts are loaded
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime && !document.getElementById('think-fonts')) {
      const goudyUrl = chrome.runtime.getURL('fonts/GoudyBookletter1911-Regular.ttf');
      const interUrl = chrome.runtime.getURL('fonts/Inter-VariableFont_slnt,wght.ttf');
      
      const fontFaceCSS = `
        @font-face {
          font-family: 'Goudy Bookletter 1911';
          src: url('${goudyUrl}') format('truetype');
          font-weight: 400;
          font-display: swap;
        }
        @font-face {
          font-family: 'Inter';
          src: url('${interUrl}') format('truetype');
          font-weight: 100 900;
          font-style: oblique -10deg 0deg;
          font-display: swap;
        }
      `;
      
      const styleEl = document.createElement('style');
      styleEl.id = 'think-fonts';
      styleEl.textContent = fontFaceCSS;
      document.head.appendChild(styleEl);
    }
  }, []);

  // Fetch current page title
  useEffect(() => {
    const fetchPageTitle = async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab.title) {
          setPageTitle(tab.title);
        }
      } catch (err) {
        console.error('Failed to fetch page title:', err);
      }
    };
    fetchPageTitle();
  }, []);

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
      <div className="flex flex-col items-center justify-between px-5 py-6 w-full min-h-[200px]">
        {/* Icon */}
        <div className="mb-6">
          <img 
            src={chrome.runtime.getURL('icons/think-os-agent-grey-blue.svg')} 
            alt="Think" 
            className="h-11 dark:hidden" 
          />
          <img 
            src={chrome.runtime.getURL('icons/think-os-agent-dark-mode-filled.svg')} 
            alt="Think" 
            className="h-11 hidden dark:block" 
          />
        </div>
        
        {/* Title */}
        <h1 className="font-heading text-2xl leading-[0.9] tracking-[-0.96px] mb-4 text-center">
          <span className="bg-gradient-to-b from-foreground to-foreground/80 dark:text-foreground dark:bg-none bg-clip-text text-transparent">
            Page already saved
          </span>
        </h1>
        
        <p className="text-xs text-muted-foreground mb-6 text-center">Saved on {date}</p>
        
        <div className="flex gap-2.5 w-full">
          <Button className="flex-1 basis-0 h-10" onClick={updateExisting} disabled={saving}>
            <div className="flex items-center gap-2">
              {saving ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span>{saving ? 'Updating...' : 'Update'}</span>
            </div>
          </Button>
          <Button className="flex-1 basis-0 h-10 bg-muted dark:bg-secondary text-foreground hover:bg-muted/80 dark:hover:bg-secondary/80" onClick={cancelUpdate} disabled={saving}>
            <div className="flex items-center gap-2">
              <X className="w-4 h-4" />
              <span>Cancel</span>
            </div>
          </Button>
        </div>
        
        {/* Footer */}
        <p className="text-[11.338px] leading-[2.8] mt-auto pt-4 text-center">
          <span className="font-normal bg-gradient-to-b from-foreground to-foreground/80 dark:text-foreground dark:bg-none bg-clip-text text-transparent">Powered by </span>
          <button
            onClick={() => {
              // Try to open the app via protocol handler
              window.location.href = 'think://app';
            }}
            className="font-bold text-primary hover:text-primary/80 transition-colors cursor-pointer"
            title="Open Think app"
          >
            THINK
          </button>
        </p>
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
    <div className="flex flex-col items-center justify-between px-5 py-6 w-full min-h-[200px]">
      {/* Icon */}
      <div className="mb-6">
        <img 
          src={chrome.runtime.getURL('icons/think-os-agent-grey-blue.svg')} 
          alt="Think" 
          className="h-11 dark:hidden" 
        />
        <img 
          src={chrome.runtime.getURL('icons/think-os-agent-dark-mode-filled.svg')} 
          alt="Think" 
          className="h-11 hidden dark:block" 
        />
      </div>

      {/* Title */}
      <h1 className="font-heading text-2xl leading-[0.9] tracking-[-0.96px] mb-6 text-center">
        <span className="bg-gradient-to-b from-foreground to-foreground/80 dark:text-foreground dark:bg-none bg-clip-text text-transparent">
          What would you like to do?
        </span>
      </h1>

      {/* Page Title */}
      {pageTitle && (
        <div className="flex items-start justify-center mb-6 w-full max-w-[226px] min-h-[22px]">
          <p className="font-medium italic text-sm leading-[1.5] text-center overflow-hidden text-ellipsis line-clamp-2">
            <span className="bg-gradient-to-b from-foreground to-foreground/80 dark:text-foreground dark:bg-none bg-clip-text text-transparent">
              {pageTitle}
            </span>
          </p>
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-2.5 w-full mb-4">
        <Button 
          className="flex-1 basis-0 min-w-0 h-[38px] px-7 rounded-md font-medium text-base leading-[38px] bg-primary text-primary-foreground hover:bg-primary/90" 
          onClick={savePage} 
          disabled={saving}
        >
          {saving ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Saving...</span>
            </div>
          ) : (
            'Save Memory'
          )}
        </Button>
        <button 
          className="flex-1 basis-0 min-w-0 h-[38px] px-7 rounded-md font-medium text-base leading-[38px] bg-muted dark:bg-secondary hover:bg-muted/80 dark:hover:bg-secondary/80 transition-colors"
          onClick={openChat}
        >
          <span className="bg-gradient-to-b from-foreground to-foreground/80 dark:text-foreground dark:bg-none bg-clip-text text-transparent">
            Chat
          </span>
        </button>
      </div>

      {/* Status message */}
      {status && (
        <div className={`text-sm p-2.5 rounded-md text-center mb-4 w-full ${status.includes('Error') || status.includes('Please') ? 'bg-destructive/10 text-destructive' : 'bg-green-500/10 text-green-600 dark:text-green-400'}`}>
          {status}
        </div>
      )}

      {/* Footer */}
      <p className="text-[11.338px] leading-[2.8] mt-auto text-center">
        <span className="font-normal bg-gradient-to-b from-foreground to-foreground/80 dark:text-foreground dark:bg-none bg-clip-text text-transparent">Powered by </span>
        <button
          onClick={() => {
            // Try to open the app via protocol handler
            window.location.href = 'think://app';
          }}
          className="font-bold text-primary hover:text-primary/80 transition-colors cursor-pointer"
          title="Open Think app"
        >
          THINK
        </button>
      </p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
);