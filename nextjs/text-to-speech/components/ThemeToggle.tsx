'use client';

import { useEffect, useState } from 'react';
import { useTheme } from './ThemeProvider';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted ? theme === 'dark' : false;

  const lightIconClasses = `flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 ${
    isDark
      ? 'text-slate-500 dark:text-slate-400'
      : 'bg-amber-500 text-white shadow-sm dark:bg-slate-700/70 dark:text-amber-300'
  }`;

  const darkIconClasses = `flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 ${
    isDark
      ? 'bg-slate-900 text-blue-200 shadow-sm dark:bg-slate-200 dark:text-blue-600'
      : 'text-slate-500 dark:text-slate-400'
  }`;

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="group inline-flex items-center gap-1 rounded-full border border-slate-200/80 bg-white/80 p-1 text-slate-600 shadow-sm backdrop-blur transition-all duration-200 hover:border-blue-500 hover:text-blue-600 hover:shadow-md dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-blue-400 dark:hover:text-blue-200"
      aria-label="Toggle dark mode"
    >
      <span className="sr-only">Toggle dark mode</span>
      <span className={lightIconClasses} aria-hidden="true">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="h-5 w-5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      </span>
      <span className={darkIconClasses} aria-hidden="true">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="h-5 w-5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
          />
        </svg>
      </span>
    </button>
  );
}

