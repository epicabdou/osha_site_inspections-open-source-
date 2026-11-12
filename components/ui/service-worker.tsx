'use client';

import * as Toast from '@radix-ui/react-toast';
import { useEffect, useRef, useState } from 'react';
import { Button } from './button';

/**
 * Registers the service worker (production builds only) and offers updates.
 *
 * `updateViaCache: 'none'` makes the browser always revalidate /sw.js. A new version
 * waits until the user taps "Update"; it is never activated automatically, so an
 * inspection in progress is never swapped out underneath the inspector.
 */
export function ServiceWorkerRegistration() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const updateRequested = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    let registration: ServiceWorkerRegistration | undefined;

    const track = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        installing?.addEventListener('statechange', () => {
          // Only an update (a page already controlled) needs the toast.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            setWaiting(installing);
          }
        });
      });
    };

    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((reg) => {
        registration = reg;
        track(reg);
      })
      .catch((error: unknown) => console.warn('Service worker registration failed', error));

    const checkForUpdate = () => {
      if (document.visibilityState === 'visible') void registration?.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', checkForUpdate);

    // Reload only after the user asked for the update. The first install also fires
    // `controllerchange` (clientsClaim), and that must never reload the page.
    let reloading = false;
    const onControllerChange = () => {
      if (reloading || !updateRequested.current) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => {
      document.removeEventListener('visibilitychange', checkForUpdate);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  return (
    <Toast.Provider swipeDirection="down" duration={Infinity}>
      <Toast.Root
        open={waiting !== null}
        onOpenChange={(open) => !open && setWaiting(null)}
        className="bg-foreground text-background fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl p-4 shadow-lg"
      >
        <div className="flex-1">
          <Toast.Title className="font-semibold">Update available</Toast.Title>
          <Toast.Description className="text-sm opacity-90">
            Your saved work is kept. Update when you are ready.
          </Toast.Description>
        </div>
        <Toast.Action altText="Update the app now" asChild>
          <Button
            onClick={() => {
              updateRequested.current = true;
              waiting?.postMessage({ type: 'SKIP_WAITING' });
            }}
          >
            Update
          </Button>
        </Toast.Action>
        <Toast.Close aria-label="Later" className="min-h-12 min-w-12 text-sm underline">
          Later
        </Toast.Close>
      </Toast.Root>
      <Toast.Viewport />
    </Toast.Provider>
  );
}
