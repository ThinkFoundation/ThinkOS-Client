import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { API_BASE_URL } from './constants';
import './index.css';

interface DuplicateInfo {
  id: number;
  title: string;
  created_at: string;
}

interface PendingNote {
  url: string;
  title: string;
  content: string;
}

function Popup() {
  const [status, setStatus] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const [pending, setPending] = useState<PendingNote | null>(null);

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

      const noteData = {
        url: tab.url,
        title: tab.title,
        content: result.result
      };

      const response = await fetch(`${API_BASE_URL}/api/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(noteData)
      });

      if (response.ok) {
        const data = await response.json();
        if (data.duplicate) {
          setDuplicate(data.existing_note);
          setPending(noteData as PendingNote);
          setStatus('');
        } else {
          setStatus('Saved!');
        }
      } else {
        setStatus('Error saving. Is the app running?');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setStatus('Error: ' + message);
    } finally {
      setSaving(false);
    }
  };

  const updateExisting = async () => {
    if (!duplicate || !pending) return;
    setSaving(true);
    setStatus('Updating...');

    try {
      const response = await fetch(`${API_BASE_URL}/api/notes/${duplicate.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending)
      });

      if (response.ok) {
        setStatus('Updated!');
      } else {
        setStatus('Error updating.');
      }
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
      <div className="p-4">
        <h1 className="text-lg font-semibold mb-3">Think</h1>
        <p className="text-sm mb-3">This page was saved on {date}.</p>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={updateExisting} disabled={saving}>
            Update
          </Button>
          <Button className="flex-1" variant="outline" onClick={cancelUpdate} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold mb-3">Think</h1>
      <Button className="w-full" onClick={savePage} disabled={saving}>
        {saving ? 'Saving...' : 'Save This Page'}
      </Button>
      {status && (
        <p className="mt-3 text-sm text-muted-foreground">{status}</p>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
);
