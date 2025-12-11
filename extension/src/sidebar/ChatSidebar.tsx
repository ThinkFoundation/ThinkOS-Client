import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { BookOpen, ExternalLink, FileText, Bookmark, Save, Sparkles, MoreHorizontal, Check, Send, Loader2 } from 'lucide-react';
import type { ChatMessageData, SourceMemory, SaveConversationResult, SummarizeChatResult, MemoryData } from '../native-client';

// Helper to send messages via background script
function sendToBackground<T>(type: string, data: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.success) {
        resolve(response.result);
      } else {
        reject(new Error(response?.error || 'Unknown error'));
      }
    });
  });
}

// Send chat message via background script (content scripts can't use connectNative)
async function sendChatMessageViaBackground(data: ChatMessageData): Promise<{ response: string; sources?: SourceMemory[] }> {
  return sendToBackground('CHAT_MESSAGE', data);
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatSidebarProps {
  pageContent: string;
  pageUrl: string;
  pageTitle: string;
  onClose: () => void;
}

export function ChatSidebar({ pageContent, pageUrl, pageTitle, onClose }: ChatSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceMemory[]>([]);
  const [showActions, setShowActions] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setError(null);
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const data: ChatMessageData = {
        message: userMessage,
        page_content: pageContent,
        page_url: pageUrl,
        page_title: pageTitle,
        history: messages,
      };

      const response = await sendChatMessageViaBackground(data);
      setMessages(prev => [...prev, { role: 'assistant', content: response.response }]);

      // Accumulate unique sources
      if (response.sources?.length) {
        setSources(prev => {
          const existingIds = new Set(prev.map(s => s.id));
          const newSources = response.sources!.filter(s => !existingIds.has(s.id));
          return [...prev, ...newSources];
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send message';
      // Check for native app connection errors specifically
      if (message.includes('Think app is not running') || message.includes('Native host')) {
        setError('Please open the Think app first');
      } else if (message.includes('Database not unlocked')) {
        setError('Please unlock the Think app first');
      } else if (message.includes('Connection refused') || message.includes('localhost:11434')) {
        setError('AI service not available. Please start Ollama or configure OpenAI.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const showSuccessTemporarily = (action: string) => {
    setActionSuccess(action);
    setTimeout(() => setActionSuccess(null), 2000);
  };

  const handleSaveToApp = async () => {
    if (messages.length === 0 || actionLoading) return;
    setActionLoading('saveToApp');
    try {
      await sendToBackground<SaveConversationResult>('SAVE_CONVERSATION', {
        messages,
        page_title: pageTitle,
        page_url: pageUrl,
      });
      showSuccessTemporarily('saveToApp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save conversation');
    } finally {
      setActionLoading(null);
      setShowActions(false);
    }
  };

  const handleSavePage = async () => {
    if (actionLoading) return;
    setActionLoading('savePage');
    try {
      await sendToBackground('SAVE_MEMORY', {
        url: pageUrl,
        title: pageTitle,
        content: pageContent,
      });
      showSuccessTemporarily('savePage');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save page');
    } finally {
      setActionLoading(null);
      setShowActions(false);
    }
  };

  const handleSummarize = async () => {
    if (messages.length === 0 || actionLoading) return;
    setActionLoading('summarize');
    try {
      await sendToBackground<SummarizeChatResult>('SUMMARIZE_CHAT', {
        messages,
        page_title: pageTitle,
        page_url: pageUrl,
      });
      showSuccessTemporarily('summarize');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create summary');
    } finally {
      setActionLoading(null);
      setShowActions(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <img src={chrome.runtime.getURL('branding/Think_OS_Full_Word_Mark-lightmode.svg')} alt="Think" className="h-5 dark:hidden" />
          <img src={chrome.runtime.getURL('branding/Think_OS_Full_Word_Mark.svg')} alt="Think" className="h-5 hidden dark:block" />
        </div>
        <div className="flex items-center gap-1">
          {/* Actions menu */}
          <div className="relative">
            <button
              onClick={() => setShowActions(!showActions)}
              className="p-1.5 rounded hover:bg-secondary transition-colors"
              aria-label="Actions"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {showActions && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white/70 dark:bg-white/5 backdrop-blur-xl border border-white/60 dark:border-white/10 rounded-lg shadow-lg shadow-black/10 dark:shadow-black/30 z-10 py-1">
                <button
                  onClick={handleSavePage}
                  disabled={!!actionLoading}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  {actionLoading === 'savePage' ? (
                    <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
                  ) : actionSuccess === 'savePage' ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Bookmark className="w-4 h-4" />
                  )}
                  <span>Save Page</span>
                </button>
                <button
                  onClick={handleSaveToApp}
                  disabled={messages.length === 0 || !!actionLoading}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  {actionLoading === 'saveToApp' ? (
                    <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
                  ) : actionSuccess === 'saveToApp' ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>Save Chat to App</span>
                </button>
                <button
                  onClick={handleSummarize}
                  disabled={messages.length === 0 || !!actionLoading}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  {actionLoading === 'summarize' ? (
                    <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
                  ) : actionSuccess === 'summarize' ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  <span>Summarize & Save</span>
                </button>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-secondary transition-colors"
            aria-label="Close sidebar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      {/* Page context indicator */}
      <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border truncate">
        Chatting about: {pageTitle || pageUrl}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground text-sm py-8">
            Ask me anything about this page or your saved memories
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex animate-slide-up ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg p-3 text-sm ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start animate-slide-up">
            <div className="bg-muted text-foreground rounded-lg p-3 text-sm">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="text-sm p-2 rounded-md text-center bg-destructive/10 text-destructive">
            {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Sources panel */}
      {sources.length > 0 && (
        <div className="px-4 py-3 border-t border-border bg-muted/30">
          <div className="flex items-center gap-2 mb-2 text-xs font-medium text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            <span>Sources ({sources.length})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {sources.map((source) => (
              <a
                key={source.id}
                href={source.url || `think://memories/${source.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-background rounded-md border hover:bg-accent transition-colors group"
                title={source.title}
              >
                {source.url ? (
                  <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
                ) : (
                  <FileText className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
                )}
                <span className="truncate max-w-[200px]">{source.title}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-border">
        <div className="relative flex items-center gap-2 p-2 rounded-full bg-white/70 dark:bg-white/5 backdrop-blur-xl border border-white/60 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this page..."
            disabled={loading}
            className="flex-1 bg-transparent px-3 py-1 text-sm placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-50"
          />
          <Button
            size="icon"
            className="h-8 w-8 rounded-full shrink-0"
            onClick={sendMessage}
            disabled={loading || !input.trim()}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
