import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { ChatSidebar } from './sidebar/ChatSidebar';
// Import CSS as string for Shadow DOM injection
import contentStyles from './content.css?inline';

// Global state for sidebar visibility
let sidebarVisible = false;
let toggleCallback: ((visible: boolean, width: number) => void) | null = null;

// Width constants
const DEFAULT_WIDTH = 350;
const MIN_WIDTH = 300;
const MAX_WIDTH = 600;
const STORAGE_KEY = 'thinkSidebarWidth';

// Storage helpers
async function loadWidthFromStorage(): Promise<number> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const savedWidth = result[STORAGE_KEY];
      if (typeof savedWidth === 'number' && savedWidth >= MIN_WIDTH && savedWidth <= MAX_WIDTH) {
        resolve(savedWidth);
      } else {
        resolve(DEFAULT_WIDTH);
      }
    });
  });
}

function saveWidthToStorage(width: number): void {
  chrome.storage.local.set({ [STORAGE_KEY]: width });
}

// Page margin functions (push content aside)
function setPageMargin(width: number) {
  const html = document.documentElement;
  html.style.marginRight = `${width}px`;
  html.style.transition = 'margin-right 0.3s ease';
}

function clearPageMargin() {
  const html = document.documentElement;
  html.style.transition = 'margin-right 0.3s ease';
  html.style.marginRight = '';
  setTimeout(() => {
    html.style.transition = '';
  }, 300);
}

// Set up message listener IMMEDIATELY (outside React)
chrome.runtime.onMessage.addListener(
  (message: { action: string }, _sender, sendResponse) => {
    if (message.action === 'openSidebar' || message.action === 'toggleSidebar') {
      sidebarVisible = message.action === 'openSidebar' ? true : !sidebarVisible;
      if (toggleCallback) {
        // Load width and pass to callback
        loadWidthFromStorage().then((width) => {
          toggleCallback?.(sidebarVisible, width);
        });
      }
      sendResponse({ success: true });
    } else if (message.action === 'closeSidebar') {
      sidebarVisible = false;
      if (toggleCallback) {
        toggleCallback(false, DEFAULT_WIDTH);
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
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const sidebarWidthRef = useRef(sidebarWidth);
  const [pageData, setPageData] = useState({
    content: '',
    url: window.location.href,
    title: document.title,
  });

  // Load saved width on mount
  useEffect(() => {
    loadWidthFromStorage().then(setSidebarWidth);
  }, []);

  // Keep ref in sync with state for use in event handlers
  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    // Register toggle callback
    toggleCallback = (visible: boolean, width: number) => {
      setIsOpen(visible);
      if (visible) {
        setSidebarWidth(width);
        setPageMargin(width);
        setPageData({
          content: document.body.innerText,
          url: window.location.href,
          title: document.title,
        });
      } else {
        clearPageMargin();
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

  // Drag resize logic
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - e.clientX));
      setSidebarWidth(newWidth);
      if (isOpen) {
        setPageMargin(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      saveWidthToStorage(sidebarWidthRef.current);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isOpen]);

  const handleClose = () => {
    clearPageMargin();
    sidebarVisible = false;
    setIsOpen(false);
  };

  return (
    <div
      id="think-sidebar-wrapper"
      className={`${isDark ? 'dark' : ''} ${isOpen ? '' : 'hidden'} ${isDragging ? 'is-dragging' : ''} bg-background text-foreground flex flex-col`}
      style={{ width: `${sidebarWidth}px` }}
    >
      <div className="resize-handle" onMouseDown={handleMouseDown} />
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

  // Get font URLs using chrome.runtime.getURL
  const interUrl = chrome.runtime.getURL('fonts/InterVariable.ttf');
  const goudyUrl = chrome.runtime.getURL('fonts/GoudyBookletter1911-Regular.ttf');

  // Build @font-face CSS
  const fontFaceCSS =
    '@font-face {' +
    "font-family: 'Inter';" +
    "src: url('" + interUrl + "') format('truetype');" +
    'font-weight: 100 900;' +
    'font-display: swap;' +
    '}' +
    '@font-face {' +
    "font-family: 'Goudy Bookletter 1911';" +
    "src: url('" + goudyUrl + "') format('truetype');" +
    'font-weight: 400;' +
    'font-display: swap;' +
    '}';

  // Inject fonts into document head for broader compatibility
  if (!document.getElementById('think-fonts')) {
    const fontStyleEl = document.createElement('style');
    fontStyleEl.id = 'think-fonts';
    fontStyleEl.textContent = fontFaceCSS;
    document.head.appendChild(fontStyleEl);
  }

  const shadow = container.attachShadow({ mode: 'open', delegatesFocus: true });

  // Stop focus events from propagating to host document
  shadow.addEventListener('focusin', (e) => e.stopPropagation());
  shadow.addEventListener('focusout', (e) => e.stopPropagation());

  // Stop keyboard events from being captured by host page (e.g., Claude.ai)
  // Claude.ai uses global keyboard listeners that intercept keystrokes
  shadow.addEventListener('keydown', (e) => e.stopPropagation());
  shadow.addEventListener('keyup', (e) => e.stopPropagation());
  shadow.addEventListener('keypress', (e) => e.stopPropagation());

  // Inject @font-face + Tailwind CSS into Shadow DOM
  // Fonts must be in Shadow DOM to work reliably across browsers
  const styleEl = document.createElement('style');
  styleEl.textContent = fontFaceCSS + contentStyles;
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
