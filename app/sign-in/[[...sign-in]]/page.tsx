import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignIn } from '@clerk/nextjs';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-start justify-center px-4 py-10">
      {/* <SignIn> reads the URL (path routing), so it renders after prerendering. */}
      <Suspense fallback={<p role="status">Loading sign-in…</p>}>
        <SignIn />
      </Suspense>
    </main>
  );
}
