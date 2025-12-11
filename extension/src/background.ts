/**
 * Background service worker for Think extension.
 * Handles native messaging since content scripts can't use chrome.runtime.connectNative.
 */

import { nativeClient, type ChatResponse, type SaveConversationResult, type SummarizeChatResult, type SaveMemoryResult } from './native-client';

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CHAT_MESSAGE') {
    // Handle chat message via native messaging
    nativeClient
      .request<ChatResponse>('chat.message', message.data)
      .then((result) => {
        sendResponse({ success: true, result });
      })
      .catch((error) => {
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
