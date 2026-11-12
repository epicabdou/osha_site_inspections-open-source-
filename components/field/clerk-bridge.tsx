'use client';

import { useAuth, useClerk, useUser } from '@clerk/nextjs';
import { useEffect, useRef, useState } from 'react';
import { parseRole } from '@/lib/auth/roles';
import { getMeta, type LastUser, setMeta } from '@/lib/db';
import { countUnsynced, downloadLocalData, wipeLocalData } from '@/lib/field/export';
import { setTokenProvider } from '@/lib/sync/api';
import { syncEngine } from '@/lib/sync/engine';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';

/**
 * Connects Clerk to the field app, when Clerk is available.
 *
 * The field app never waits for Clerk: it runs from `meta.lastUser`. Once Clerk has
 * loaded with a session, this saves the user (id, display name, role only), hands the
 * sync engine a token provider, and guards against a different user inheriting
 * someone else's unsynced work on a shared device.
 */
export function ClerkBridge() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [blocked, setBlocked] = useState<{ previous: LastUser; unsynced: number } | null>(null);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn || !userId) {
      setTokenProvider(null);
      void syncEngine.syncNow();
      return;
    }
    setTokenProvider(() => getToken());

    if (!user || handled.current === userId) return;
    handled.current = userId;
    const candidate: LastUser = {
      userId,
      displayName: user.fullName || user.firstName || user.username || 'Inspector',
      role: parseRole(user.publicMetadata.role),
    };

    void (async () => {
      const previous = await getMeta('lastUser');
      if (previous && previous.userId !== candidate.userId) {
        const unsynced = await countUnsynced();
        if (unsynced > 0) {
          setTokenProvider(null);
          setBlocked({ previous, unsynced });
          return;
        }
        await wipeLocalData();
        window.location.reload();
        return;
      }
      await setMeta('lastUser', candidate);
      void syncEngine.syncNow();
    })();
  }, [isLoaded, isSignedIn, userId, user, getToken]);

  if (!blocked) return null;
  return (
    <ConfirmDialog
      open
      onOpenChange={() => {}}
      title="Another user's work is still on this device"
      confirmLabel="Delete it and continue"
      onConfirm={() => {
        void wipeLocalData().then(() => window.location.reload());
      }}
      extraAction={
        <Button variant="secondary" onClick={() => void downloadLocalData()}>
          Export it as JSON
        </Button>
      }
    >
      <p>
        {blocked.previous.displayName} has {blocked.unsynced} change
        {blocked.unsynced === 1 ? '' : 's'} that never reached the server.
      </p>
      <p>
        Export the data first if it matters, or sign out and let {blocked.previous.displayName} sign
        in to sync it. Continuing deletes it from this device.
      </p>
      <p>
        <button className="text-accent min-h-11 underline" onClick={() => void signOut()}>
          Sign out instead
        </button>
      </p>
    </ConfirmDialog>
  );
}
