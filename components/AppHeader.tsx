'use client';

import Image from 'next/image';
import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import ThemeModeSwitch from './ThemeModeSwitch';

type ThemeMode = 'light' | 'dark';
type MainView = 'my' | 'explore' | 'topics';

interface AppHeaderProps {
  activeView?: MainView;
  currentLabel?: string;
  themeMode: ThemeMode;
  onThemeToggle: (nextMode: ThemeMode) => void;
  showViewTabs?: boolean;
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M6.5 8L10 11.5L13.5 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RowChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-[var(--text-muted)]" fill="none" aria-hidden="true">
      <path d="M8 5.5L12 10L8 14.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M10 13V4.8M6.8 8L10 4.8L13.2 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 12.5V15.5H15V12.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SignInIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M8.5 5H5.5V15H8.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 10H15.5M12.8 6.8L15.8 10L12.8 13.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MenuIcon({ type }: { type: 'profile' | 'credits' | 'pricing' | 'mcp' | 'extension' | 'explore' | 'about' | 'signout' }) {
  const common = 'currentColor';
  if (type === 'profile') {
    return (
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
        <circle cx="10" cy="7" r="3" stroke={common} strokeWidth="1.6" />
        <path d="M4.5 16C5.4 13.9 7.4 12.7 10 12.7S14.6 13.9 15.5 16" stroke={common} strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'credits') {
    return (
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="5.8" stroke={common} strokeWidth="1.6" />
        <path d="M10 6.8V13.2M7.4 9.2H12.6" stroke={common} strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'pricing') {
    return (
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
        <path d="M4.5 6.5H15.5V14.5H4.5V6.5Z" stroke={common} strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M6.5 9.2H13.5M6.5 12H10.5" stroke={common} strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'mcp') {
    return (
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
        <path d="M5.5 7.5H14.5M5.5 12.5H14.5M7.5 5.5V14.5M12.5 5.5V14.5" stroke={common} strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'extension') {
    return (
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
        <path d="M7 4.5H13V7H15.5V13H13V15.5H7V13H4.5V7H7V4.5Z" stroke={common} strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === 'explore') {
    return (
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
        <path d="M10 3.8L15.5 16.2L10 13.5L4.5 16.2L10 3.8Z" stroke={common} strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === 'about') {
    return (
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="6.2" stroke={common} strokeWidth="1.6" />
        <path d="M10 9.2V13M10 6.8H10.01" stroke={common} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M8.5 5H5.5V15H8.5M10.5 10H16M13.5 7L16.5 10L13.5 13" stroke={common} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NavTab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={[
        'whitespace-nowrap rounded-lg px-5 py-2 text-sm font-semibold transition-colors sm:min-w-32 sm:text-center',
        active
          ? 'bg-[var(--btn-primary)] text-[var(--btn-primary-text)] shadow-[0_10px_24px_-18px_rgba(47,102,86,0.8)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--paper-muted)] hover:text-[var(--heading)]',
      ].join(' ')}
    >
      {children}
    </Link>
  );
}

function MenuRow({ href, icon, label }: { href: string; icon: Parameters<typeof MenuIcon>[0]['type']; label: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium text-[var(--text-main)] hover:bg-[var(--paper-muted)]">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] text-[var(--heading)]">
        <MenuIcon type={icon} />
      </span>
      <span className="flex-1">{label}</span>
      <RowChevronIcon />
    </Link>
  );
}

export default function AppHeader({
  activeView,
  currentLabel,
  themeMode,
  onThemeToggle,
  showViewTabs = true,
}: AppHeaderProps) {
  const { data: session, status } = useSession();
  const isAuthenticated = status === 'authenticated';
  const email = session?.user?.email || '';
  const initials = (session?.user?.name || email || 'PS')
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'PS';

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border-soft)] bg-[var(--header-bg)] backdrop-blur-xl">
      <div className="mx-auto grid w-full max-w-[1600px] gap-3 px-4 py-3 sm:px-6 lg:px-8 xl:grid-cols-[minmax(220px,1fr)_auto_minmax(220px,1fr)] xl:items-center">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <nav className="app-breadcrumb-nav min-w-0">
            <Link href="/" className="app-breadcrumb-link">
              <Image src="/podcast-summarizer-icon.png" alt="PodSum logo" width={36} height={36} className="app-breadcrumb-logo" />
              <span>PodSum.cc</span>
            </Link>
            {currentLabel && (
              <>
                <span className="app-breadcrumb-divider">/</span>
                <span className="app-breadcrumb-current text-base sm:text-lg">{currentLabel}</span>
              </>
            )}
          </nav>
        </div>

        {showViewTabs ? (
          <nav className="flex w-full items-center gap-1 overflow-x-auto rounded-xl border border-[var(--border-soft)] bg-[var(--paper-base)] p-1 xl:w-auto">
            <NavTab href="/?view=my" active={activeView === 'my'}>My Summaries</NavTab>
            <NavTab href="/?view=explore" active={activeView === 'explore'}>Explore</NavTab>
            <NavTab href="/?view=topics" active={activeView === 'topics'}>Topics</NavTab>
          </nav>
        ) : (
          <div className="hidden xl:block" />
        )}

        <div className="flex items-center justify-end gap-2">
          <ThemeModeSwitch themeMode={themeMode} onToggle={onThemeToggle} />
          <Link
            href="/upload"
            className={[
              'inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors sm:px-4',
              isAuthenticated
                ? 'bg-[var(--btn-primary)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)]'
                : 'border border-[var(--border-soft)] bg-[var(--paper-base)] text-[var(--heading)] hover:bg-[var(--paper-muted)]',
            ].join(' ')}
          >
            <UploadIcon />
            Upload
          </Link>

          {status === 'loading' ? (
            <span className="h-10 w-20 rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)]" aria-label="Loading account status" />
          ) : isAuthenticated ? (
            <div className="group relative">
              <button
                type="button"
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-2.5 text-sm font-semibold text-[var(--heading)] transition-colors hover:bg-[var(--paper-muted)]"
                aria-haspopup="menu"
                aria-label="Account menu"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-bold text-[var(--heading)]">
                  {initials}
                </span>
                <ChevronIcon />
              </button>

              <div className="invisible absolute right-0 top-[calc(100%+0.6rem)] w-[300px] translate-y-1 rounded-xl border border-[var(--border-soft)] bg-[var(--paper-base)] p-2 text-left opacity-0 shadow-[0_18px_45px_-30px_rgba(87,71,45,0.65)] transition-all group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                <div className="flex items-center gap-3 rounded-lg bg-[var(--paper-muted)] px-3 py-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent-soft)] text-sm font-bold text-[var(--heading)]">
                    {initials}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--heading)]">
                      {email || 'PodSum user'}
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">PodSum</div>
                  </div>
                </div>

                <div className="mt-2 px-2 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">Account</div>
                <MenuRow href="/account" icon="profile" label="Profile" />
                <MenuRow href="/account/credits" icon="credits" label="Credits" />
                <MenuRow href="/pricing" icon="pricing" label="Pricing" />

                <div className="mt-2 border-t border-[var(--border-soft)] px-2 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">Integrations</div>
                <MenuRow href="/account/mcp" icon="mcp" label="MCP" />
                <MenuRow href="/chrome-extension" icon="extension" label="Extension" />

                <div className="mt-2 border-t border-[var(--border-soft)] px-2 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">Discover</div>
                <MenuRow href="/?view=explore" icon="explore" label="Explore" />
                <MenuRow href="/about" icon="about" label="About" />

                <button
                  type="button"
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className="mt-2 flex w-full items-center gap-3 rounded-lg border-t border-[var(--border-soft)] px-2.5 py-2 text-sm font-medium text-[var(--danger)] hover:bg-[#fff5f5]"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#d8b7b7] bg-[var(--paper-base)]">
                    <MenuIcon type="signout" />
                  </span>
                  <span className="flex-1 text-left">Sign out</span>
                </button>
              </div>
            </div>
          ) : (
            <Link
              href="/auth/signin?callbackUrl=/"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--btn-primary)] px-4 text-sm font-semibold text-[var(--btn-primary-text)] transition-colors hover:bg-[var(--btn-primary-hover)]"
            >
              <SignInIcon />
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
