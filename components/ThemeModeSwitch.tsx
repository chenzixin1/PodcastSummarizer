'use client';

type ThemeMode = 'light' | 'dark';

interface ThemeModeSwitchProps {
  themeMode: ThemeMode;
  onToggle: (nextMode: ThemeMode) => void;
  className?: string;
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path d="M12 2.5V5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 18.5V21.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M2.5 12H5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M18.5 12H21.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M5.3 5.3L7.4 7.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M16.6 16.6L18.7 18.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M16.6 7.4L18.7 5.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M5.3 18.7L7.4 16.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <path
        d="M15.5 3.5A8.5 8.5 0 1 0 20.5 15a7 7 0 0 1-5-11.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ThemeModeSwitch({ themeMode, onToggle, className = '' }: ThemeModeSwitchProps) {
  const isDark = themeMode === 'dark';
  const nextMode: ThemeMode = isDark ? 'light' : 'dark';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={() => onToggle(nextMode)}
      className={[
        'relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border border-[var(--border-soft)]',
        'bg-[var(--paper-muted)] p-1 transition-colors hover:bg-[var(--paper-base)]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--btn-primary)]',
        'focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]',
        className,
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none inline-flex h-6 w-6 items-center justify-center rounded-full',
          'transform transition-transform duration-200',
          isDark
            ? 'translate-x-6 bg-[var(--text-main)] text-[var(--background)] shadow-[0_2px_8px_rgba(0,0,0,0.35)]'
            : 'translate-x-0 bg-[var(--btn-primary)] text-[var(--btn-primary-text)] shadow-[0_2px_8px_rgba(47,102,86,0.35)]',
        ].join(' ')}
      >
        {isDark ? <MoonIcon /> : <SunIcon />}
      </span>
      <span className="sr-only">{isDark ? 'Dark mode enabled' : 'Light mode enabled'}</span>
    </button>
  );
}
