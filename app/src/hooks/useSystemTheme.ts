import { useEffect } from 'react';

export type Theme = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'think_theme';

function applyTheme(theme: Theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else if (theme === 'light') {
    document.documentElement.classList.remove('dark');
  } else {
    // 'system' - follow OS preference
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', isDark);
  }
}

export function useSystemTheme() {
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    const theme = stored || 'system';

    applyTheme(theme);

    // Listen for system changes (only matters when theme === 'system')
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = () => {
      if ((localStorage.getItem(STORAGE_KEY) || 'system') === 'system') {
        applyTheme('system');
      }
    };

    // Listen for manual theme changes from Settings
    const handleThemeChange = () => {
      const newTheme = localStorage.getItem(STORAGE_KEY) as Theme || 'system';
      applyTheme(newTheme);
    };

    mediaQuery.addEventListener('change', handleSystemChange);
    window.addEventListener('themechange', handleThemeChange);

    return () => {
      mediaQuery.removeEventListener('change', handleSystemChange);
      window.removeEventListener('themechange', handleThemeChange);
    };
  }, []);
}

export function setTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  window.dispatchEvent(new Event('themechange'));
}

export function getTheme(): Theme {
  return (localStorage.getItem(STORAGE_KEY) as Theme) || 'system';
}
