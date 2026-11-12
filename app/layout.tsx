import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { DisclaimerFooter } from '@/components/ui/disclaimer';
import { ServiceWorkerRegistration } from '@/components/ui/service-worker';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Field Inspections',
    template: '%s · Field Inspections',
  },
  description:
    'An open-source, offline-first safety inspection app that shows device-to-server sync done correctly.',
  applicationName: 'Field Inspections',
  appleWebApp: { capable: true, title: 'Inspections', statusBarStyle: 'default' },
  icons: { apple: '/icons/apple-touch-icon.png' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0f14' },
  ],
};

/**
 * ClerkProvider is used without the `dynamic` prop, so it reads no request data
 * and every route below it can still be prerendered. On /field the Clerk browser
 * script may never load (offline cold start); the field app does not wait for it.
 */
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <ClerkProvider signInUrl="/sign-in" signInFallbackRedirectUrl="/">
          <div className="flex flex-1 flex-col">{children}</div>
          <DisclaimerFooter />
          <ServiceWorkerRegistration />
        </ClerkProvider>
      </body>
    </html>
  );
}
