'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import type { SignInResponse } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AppFrame from '@/components/AppFrame';
import { normalizeAuthCallbackUrl } from '@/lib/authCallbackUrl';

const AUTH_DEBUG_ENABLED = process.env.NEXT_PUBLIC_DEBUG_LOGS === 'true';

function logAuthDebug(message: string, payload?: unknown) {
  if (!AUTH_DEBUG_ENABLED) {
    return;
  }
  console.log(message, payload ?? '');
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function DebugBlock({ data }: { data: SignInResponse | { error: string } | null }) {
  if (!AUTH_DEBUG_ENABLED || !data) {
    return null;
  }
  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-muted)] p-3 text-left">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">Debug</h3>
      <pre className="overflow-auto text-xs text-[var(--text-secondary)]">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

export default function SignInForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loginStatus, setLoginStatus] = useState<'idle' | 'success' | 'failed'>('idle');
  const [debugInfo, setDebugInfo] = useState<SignInResponse | { error: string } | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = normalizeAuthCallbackUrl(searchParams.get('callbackUrl'), '/?view=my');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    setLoginStatus('idle');
    setDebugInfo(null);

    try {
      logAuthDebug('Starting credentials sign in, callbackUrl:', callbackUrl);
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
        callbackUrl,
      });

      logAuthDebug('Credentials sign in result:', result);
      setDebugInfo(result ?? null);

      if (result?.error) {
        setError('Invalid email or password');
        setLoginStatus('failed');
      } else if (result?.url) {
        setLoginStatus('success');
        setTimeout(() => {
          if (result.url) {
            window.location.href = result.url;
          }
        }, 700);
      } else if (result?.ok) {
        setLoginStatus('success');
        setTimeout(() => {
          router.push(callbackUrl);
        }, 700);
      } else {
        setError('We could not finish sign in. Please try again.');
        setLoginStatus('failed');
      }
    } catch (signInError) {
      console.error('Sign in exception:', signInError);
      setError('An error occurred during sign in');
      setLoginStatus('failed');
      setDebugInfo({ error: String(signInError) });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setIsLoading(true);
    setLoginStatus('idle');
    setDebugInfo(null);

    try {
      logAuthDebug('Starting Google sign in, callbackUrl:', callbackUrl);
      await signIn('google', {
        callbackUrl,
      });
    } catch (signInError) {
      console.error('Google sign in exception:', signInError);
      setError('An error occurred during Google sign in');
      setLoginStatus('failed');
      setDebugInfo({ error: String(signInError) });
      setIsLoading(false);
    }
  };

  if (loginStatus === 'success' || loginStatus === 'failed') {
    const isSuccess = loginStatus === 'success';
    return (
      <AppFrame currentLabel={isSuccess ? 'Signed in' : 'Sign in'} showViewTabs={false} mainClassName="mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-[720px] items-center px-4 py-8 sm:px-6 lg:px-8">
        <section className="dashboard-panel w-full rounded-lg p-6 text-center sm:p-8">
          <div className={[
            'mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border text-2xl font-bold',
            isSuccess
              ? 'border-[#9bc8b6] bg-[var(--accent-soft)] text-[var(--heading)]'
              : 'border-[#d8b7b7] bg-[#fff5f5] text-[var(--danger)]',
          ].join(' ')}
          >
            {isSuccess ? '✓' : '!'}
          </div>
          <h1 className="text-2xl font-semibold text-[var(--heading)]">
            {isSuccess ? 'Signed in' : 'Sign in failed'}
          </h1>
          <p className="mt-3 text-sm text-[var(--text-secondary)]">
            {isSuccess ? (
              <>
                Opening <span className="font-semibold text-[var(--heading)]">{callbackUrl}</span>
              </>
            ) : (
              error
            )}
          </p>
          <div className="mx-auto mt-5 h-1.5 w-32 overflow-hidden rounded-full bg-[var(--paper-muted)]">
            <div className={[
              'h-full rounded-full',
              isSuccess ? 'animate-pulse bg-[var(--btn-primary)]' : 'bg-[var(--danger)]',
            ].join(' ')}
            />
          </div>

          <div className="mt-6 space-y-3">
            {isSuccess ? (
              <button
                type="button"
                onClick={() => router.push(callbackUrl)}
                className="w-full rounded-lg bg-[var(--btn-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--btn-primary-text)] transition-colors hover:bg-[var(--btn-primary-hover)]"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setLoginStatus('idle');
                  setError('');
                  setDebugInfo(null);
                }}
                className="w-full rounded-lg bg-[var(--btn-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--btn-primary-text)] transition-colors hover:bg-[var(--btn-primary-hover)]"
              >
                Try again
              </button>
            )}
            <Link href="/" className="inline-flex text-sm font-medium text-[var(--text-muted)] hover:text-[var(--heading)]">
              Back to home
            </Link>
          </div>

          <div className="mt-5">
            <DebugBlock data={debugInfo} />
          </div>
        </section>
      </AppFrame>
    );
  }

  return (
    <AppFrame currentLabel="Sign in" showViewTabs={false} mainClassName="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-6 lg:px-8">
      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div className="hidden pt-8 lg:block">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">PodSum.cc</p>
          <h1 className="mt-4 max-w-md text-4xl font-semibold leading-tight text-[var(--heading)]">
            Welcome back to your summaries.
          </h1>
          <p className="mt-4 max-w-sm text-base text-[var(--text-secondary)]">
            Sign in to open the same homepage workspace, with My Summaries kept as the first filter.
          </p>
        </div>

        <div className="dashboard-panel rounded-lg p-5 sm:p-7">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-[var(--heading)]">Sign in</h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              New here?{' '}
              <Link href={`/auth/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`} className="font-semibold text-[var(--link)] hover:text-[var(--link-hover)]">
                Create an account
              </Link>
            </p>
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-[var(--border-medium)] bg-[var(--paper-base)] px-4 py-2.5 text-sm font-semibold text-[var(--heading)] transition-colors hover:bg-[var(--paper-muted)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <GoogleIcon />
            {isLoading ? 'Opening Google...' : 'Continue with Google'}
          </button>

          <div className="my-6 flex items-center gap-3 text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
            <span className="h-px flex-1 bg-[var(--border-soft)]" />
            Email
            <span className="h-px flex-1 bg-[var(--border-soft)]" />
          </div>

          {error && (
            <div className="mb-5 rounded-lg border border-[#d8b7b7] bg-[#fff5f5] px-4 py-3 text-sm text-[var(--danger)]">
              {error}
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-[var(--text-secondary)]">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 block w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2.5 text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:border-[var(--btn-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-[var(--text-secondary)]">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 block w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2.5 text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:border-[var(--btn-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]"
                placeholder="Password"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-[var(--btn-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--btn-primary-text)] transition-colors hover:bg-[var(--btn-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--text-muted)]">
            <Link href="/" className="font-medium hover:text-[var(--heading)]">
              Back to home
            </Link>
            <span className="truncate">
              Opens <span className="font-semibold text-[var(--heading)]">{callbackUrl}</span>
            </span>
          </div>
        </div>
      </section>
    </AppFrame>
  );
}
