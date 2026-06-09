'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import AppFrame from '../../components/AppFrame';

const navItems = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/credits', label: 'Credits' },
  { href: '/admin/jobs', label: 'Jobs' },
  { href: '/admin/podcasts', label: 'Podcasts' },
];

export default function AdminChrome({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <AppFrame currentLabel={title} showViewTabs={false}>
      <div className="space-y-5">
        <nav className="flex gap-2 overflow-x-auto pb-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--paper-muted)] hover:text-[var(--heading)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
    </AppFrame>
  );
}
