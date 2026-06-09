'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppFrame from '../../components/AppFrame';

interface AccountOverview {
  user: {
    id: string;
    email: string;
    name: string;
    credits: number;
    createdAt: string;
  };
  transactions: Array<{
    id: string;
    delta: number;
    balanceAfter: number;
    reason: string;
    createdAt: string;
  }>;
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : '-';
}

export default function AccountPage() {
  const { status } = useSession();
  const router = useRouter();
  const [data, setData] = useState<AccountOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/auth/signin?callbackUrl=/account');
    }
  }, [router, status]);

  useEffect(() => {
    if (status !== 'authenticated') {
      return;
    }
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/account/overview', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Failed to load account');
        }
        setData(payload.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [status]);

  if (status === 'loading' || status === 'unauthenticated') {
    return (
      <AppFrame currentLabel="Profile" showViewTabs={false} mainClassName="flex min-h-[70vh] items-center justify-center px-4">
        <div className="text-center text-[var(--text-muted)]">Loading...</div>
      </AppFrame>
    );
  }

  return (
    <AppFrame currentLabel="Profile" showViewTabs={false}>
        <div className="space-y-5">
          {error && <div className="rounded-lg border border-[#d8b7b7] bg-[#fff5f5] p-4 text-sm text-[var(--danger)]">{error}</div>}

          {isLoading ? (
            <div className="dashboard-panel rounded-lg p-10 text-center text-[var(--text-muted)]">Loading...</div>
          ) : data ? (
            <>
              <section className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
                <div className="dashboard-panel rounded-lg p-5">
                  <div className="text-xs font-semibold uppercase text-[var(--text-muted)]">Signed in</div>
                  <h1 className="mt-2 text-2xl font-semibold text-[var(--heading)]">{data.user.name || data.user.email}</h1>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">{data.user.email}</p>
                  <p className="mt-4 text-xs text-[var(--text-muted)]">Member since {formatDate(data.user.createdAt)}</p>
                </div>

                <div className="dashboard-panel rounded-lg p-5">
                  <div className="text-xs font-semibold uppercase text-[var(--text-muted)]">SRT credits</div>
                  <div className="mt-2 text-4xl font-semibold text-[var(--heading)]">{data.user.credits}</div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link href="/account/credits" className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm font-medium hover:bg-[var(--paper-muted)]">Credit ledger</Link>
                    <Link href="/account/mcp" className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm font-medium hover:bg-[var(--paper-muted)]">MCP tokens</Link>
                    <Link href="/pricing" className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm font-medium hover:bg-[var(--paper-muted)]">Pricing</Link>
                  </div>
                </div>
              </section>

              <section className="dashboard-panel rounded-lg p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-[var(--heading)]">Recent Credit Activity</h2>
                  <Link href="/account/credits" className="text-sm font-medium text-[var(--link)] hover:text-[var(--link-hover)]">All activity</Link>
                </div>
                <div className="space-y-2">
                  {data.transactions.length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)]">No credit activity yet.</p>
                  ) : (
                    data.transactions.slice(0, 8).map((tx) => (
                      <div key={tx.id} className="flex flex-col gap-1 rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="font-medium text-[var(--text-main)]">{tx.reason}</div>
                          <div className="text-xs text-[var(--text-muted)]">{formatDate(tx.createdAt)}</div>
                        </div>
                        <div className="text-right">
                          <div className={tx.delta >= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-[var(--danger)]'}>{tx.delta > 0 ? `+${tx.delta}` : tx.delta}</div>
                          <div className="text-xs text-[var(--text-muted)]">balance {tx.balanceAfter}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </>
          ) : null}
        </div>
    </AppFrame>
  );
}
