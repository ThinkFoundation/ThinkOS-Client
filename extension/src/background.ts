/**
 * Background service worker for Think extension.
 * Handles native messaging since content scripts can't use chrome.runtime.connectNative.
 */

import { nativeClient, type ChatResponse, type SaveConversationResult, type SummarizeChatResult, type SaveMemoryResult } from './native-client';

// Keep service worker alive during long operations
let keepAliveInterval: ReturnType<typeof setInterval> | null = null;

function startKeepAlive() {
  if (keepAliveInterval) return;
  // Ping every 20 seconds to keep service worker alive
  keepAliveInterval = setInterval(() => {
    console.log('[Think] Keepalive ping');
  }, 20000);
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CHAT_MESSAGE') {
    // Handle chat message via native messaging
    // Start keepalive to prevent service worker termination during long AI calls
    startKeepAlive();
    nativeClient
      .request<ChatResponse>('chat.message', message.data)
      .then((result) => {
        stopKeepAlive();
        sendResponse({ success: true, result });
      })
      .catch((error) => {
        stopKeepAlive();
        console.error('[Think] Chat error:', error.message);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (message.type === 'SAVE_CONVERSATION') {
    // Save conversation to app
    nativeClient
      .request<SaveConversationResult>('conversations.save', message.data)
      .then((result) => {
        sendResponse({ success: true, result });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (message.type === 'SUMMARIZE_CHAT') {
    // Summarize chat and save as memory
    nativeClient
      .request<SummarizeChatResult>('chat.summarize', message.data)
      .then((result) => {
        sendResponse({ success: true, result });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (message.type === 'SAVE_MEMORY') {
    // Save page as memory
    nativeClient
      .request<SaveMemoryResult>('memories.create', message.data)
      .then((result) => {
        sendResponse({ success: true, result });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (message.type === 'NATIVE_REQUEST') {
    // Generic native messaging request
    nativeClient
      .request(message.method, message.params)
      .then((result) => {
        sendResponse({ success: true, result });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});

// Log when service worker starts
console.log('Think background service worker started');
