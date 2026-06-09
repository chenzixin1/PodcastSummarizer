'use client';

import { useEffect, useState } from 'react';
import AppHeader from './AppHeader';

type ThemeMode = 'light' | 'dark';
type MainView = 'my' | 'explore' | 'topics';

interface AppFrameProps {
  children: React.ReactNode;
  activeView?: MainView;
  currentLabel?: string;
  showViewTabs?: boolean;
  mainClassName?: string;
}

export default function AppFrame({
  children,
  activeView,
  currentLabel,
  showViewTabs = true,
  mainClassName = 'mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8',
}: AppFrameProps) {
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storedTheme = window.localStorage.getItem('podsum-dashboard-theme');
    if (storedTheme === 'light' || storedTheme === 'dark') {
      setThemeMode(storedTheme);
      return;
    }
    setThemeMode(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('podsum-dashboard-theme', themeMode);
  }, [themeMode]);

  return (
    <div className="dashboard-shell min-h-screen text-[var(--text-main)]" data-theme={themeMode}>
      <AppHeader
        activeView={activeView}
        currentLabel={currentLabel}
        themeMode={themeMode}
        onThemeToggle={setThemeMode}
        showViewTabs={showViewTabs}
      />
      <main className={mainClassName}>{children}</main>
    </div>
  );
}
