'use client';

import { Suspense } from 'react';
import SignInForm from './SignInForm';

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="dashboard-shell min-h-screen text-[var(--text-main)] flex items-center justify-center" data-theme="light">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--btn-primary)] mx-auto mb-4"></div>
          <p className="text-[var(--text-muted)]">Loading...</p>
        </div>
      </div>
    }>
      <SignInForm />
    </Suspense>
  );
} 
