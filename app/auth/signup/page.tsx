'use client';

import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AppFrame from '@/components/AppFrame';
import { normalizeAuthCallbackUrl } from '@/lib/authCallbackUrl';

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

function SignUpForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = normalizeAuthCallbackUrl(searchParams.get('callbackUrl'), '/upload');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          name,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Registration failed');
        return;
      }

      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
        callbackUrl,
      });

      if (result?.error) {
        setError('Registration successful, but auto-login failed. Please sign in manually.');
      } else {
        router.push(callbackUrl);
      }
    } catch {
      setError('An error occurred during registration');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setError('');
    setIsLoading(true);

    try {
      await signIn('google', {
        callbackUrl,
      });
    } catch {
      setError('An error occurred during Google sign up');
      setIsLoading(false);
    }
  };

  return (
    <AppFrame currentLabel="Sign up" showViewTabs={false} mainClassName="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-6 lg:px-8">
      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div className="hidden pt-8 lg:block">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">PodSum.cc</p>
          <h1 className="mt-4 max-w-md text-4xl font-semibold leading-tight text-[var(--heading)]">
            Create a place for your listening notes.
          </h1>
          <p className="mt-4 max-w-sm text-base text-[var(--text-secondary)]">
            Upload from the global action, then review everything from the homepage My Summaries view.
          </p>
        </div>

        <div className="dashboard-panel rounded-lg p-5 sm:p-7">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-[var(--heading)]">Create account</h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Already have one?{' '}
              <Link href={`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`} className="font-semibold text-[var(--link)] hover:text-[var(--link-hover)]">
                Sign in
              </Link>
            </p>
          </div>

          <button
            type="button"
            onClick={handleGoogleSignUp}
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
              <label htmlFor="name" className="block text-sm font-semibold text-[var(--text-secondary)]">
                Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 block w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2.5 text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:border-[var(--btn-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]"
                placeholder="Your name"
              />
            </div>

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

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-[var(--text-secondary)]">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-2 block w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2.5 text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:border-[var(--btn-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]"
                  placeholder="Min 6 characters"
                />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-semibold text-[var(--text-secondary)]">
                  Confirm
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-2 block w-full rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2.5 text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:border-[var(--btn-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]"
                  placeholder="Repeat password"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-[var(--btn-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--btn-primary-text)] transition-colors hover:bg-[var(--btn-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? 'Creating account...' : 'Create account'}
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

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <div className="dashboard-shell flex min-h-screen items-center justify-center text-[var(--text-main)]" data-theme="light">
          <div className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-[var(--btn-primary)]"></div>
            <p className="text-[var(--text-muted)]">Loading...</p>
          </div>
        </div>
      }
    >
      <SignUpForm />
    </Suspense>
  );
}
