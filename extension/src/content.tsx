import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { ChatSidebar } from './sidebar/ChatSidebar';
// Import CSS as string for Shadow DOM injection
import contentStyles from './content.css?inline';

// Global state for sidebar visibility
let sidebarVisible = false;
let toggleCallback: ((visible: boolean) => void) | null = null;

// Set up message listener IMMEDIATELY (outside React)
chrome.runtime.onMessage.addListener(
  (message: { action: string }, _sender, sendResponse) => {
    if (message.action === 'openSidebar' || message.action === 'toggleSidebar') {
      sidebarVisible = message.action === 'openSidebar' ? true : !sidebarVisible;
      if (toggleCallback) {
        toggleCallback(sidebarVisible);
      }
      sendResponse({ success: true });
    } else if (message.action === 'closeSidebar') {
      sidebarVisible = false;
      if (toggleCallback) {
        toggleCallback(false);
      }
      sendResponse({ success: true });
    }
    return true;
  }
);

// Get shadow host reference for dark mode class
let shadowHostRef: HTMLElement | null = null;

// Check initial dark mode state synchronously
const getInitialDarkMode = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

function SidebarApp() {
  const [isOpen, setIsOpen] = useState(sidebarVisible);
  const [isDark, setIsDark] = useState(getInitialDarkMode);
  const [pageData, setPageData] = useState({
    content: '',
    url: window.location.href,
    title: document.title,
  });

  useEffect(() => {
    // Register toggle callback
    toggleCallback = (visible: boolean) => {
      setIsOpen(visible);
      if (visible) {
        setPageData({
          content: document.body.innerText,
          url: window.location.href,
          title: document.title,
        });
      }
    };

    // Handle system theme - apply class to shadow host for :host(.dark) CSS variables
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = (dark: boolean) => {
      setIsDark(dark);
      if (shadowHostRef) {
        shadowHostRef.classList.toggle('dark', dark);
      }
    };

    const handleThemeChange = (e: MediaQueryListEvent) => applyTheme(e.matches);
    mediaQuery.addEventListener('change', handleThemeChange);

    return () => {
      toggleCallback = null;
      mediaQuery.removeEventListener('change', handleThemeChange);
    };
  }, []);

  const handleClose = () => {
    sidebarVisible = false;
    setIsOpen(false);
  };

  return (
    <div
      id="think-sidebar-wrapper"
      className={`${isDark ? 'dark' : ''} ${isOpen ? '' : 'hidden'} bg-background text-foreground flex flex-col`}
    >
      {isOpen && (
        <ChatSidebar
          pageContent={pageData.content}
          pageUrl={pageData.url}
          pageTitle={pageData.title}
          onClose={handleClose}
        />
      )}
    </div>
  );
}

// Create shadow DOM container and render
function init() {
  // Check if already initialized
  if (document.getElementById('think-sidebar-root')) return;

  const container = document.createElement('div');
  container.id = 'think-sidebar-root';
  document.body.appendChild(container);

  // Store reference for dark mode class management
  shadowHostRef = container;

  // Apply dark mode immediately before React renders (prevents flash)
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    container.classList.add('dark');
  }

  const shadow = container.attachShadow({ mode: 'open' });

  // Inject Tailwind CSS (compiled with rem→px) as inline styles
  const styleEl = document.createElement('style');
  styleEl.textContent = contentStyles;
  shadow.appendChild(styleEl);

  // Create React root in shadow DOM
  const reactRoot = document.createElement('div');
  reactRoot.id = 'think-sidebar-react';
  shadow.appendChild(reactRoot);

  ReactDOM.createRoot(reactRoot).render(
    <React.StrictMode>
      <SidebarApp />
    </React.StrictMode>
  );
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
