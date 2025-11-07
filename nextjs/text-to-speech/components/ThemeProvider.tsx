'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');
  const [userPreference, setUserPreference] = useState<Theme | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const stored = window.localStorage.getItem('theme');

    if (stored === 'light' || stored === 'dark') {
      setTheme(stored);
      setUserPreference(stored);
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyMediaPreference = (matches: boolean) => {
      setTheme(matches ? 'dark' : 'light');
    };

    applyMediaPreference(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => {
      if (userPreference) {
        return;
      }
      applyMediaPreference(event.matches);
    };

    mediaQuery.addEventListener('change', handler);

    return () => {
      mediaQuery.removeEventListener('change', handler);
    };
  }, [userPreference]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.body.classList.remove('light', 'dark');
    document.body.classList.add(theme);
    document.documentElement.style.setProperty('color-scheme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';

      if (typeof window !== 'undefined') {
        window.localStorage.setItem('theme', next);
      }

      setUserPreference(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return value;
}

