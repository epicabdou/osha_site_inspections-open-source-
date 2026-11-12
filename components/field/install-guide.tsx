'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncExternalStore } from 'react';
import { getMeta, setMeta } from '@/lib/db';
import { isIos, isStandalone } from '@/lib/field/storage';

/** Platform facts that never change while the page is open need no subscription. */
const noSubscription = () => () => {};

/**
 * First-run install guide for iPhone and iPad. Safari can clear the storage of sites
 * that are not on the home screen after seven days without use, which would lose
 * unsynced work. Shown until the app runs in standalone mode (or is dismissed).
 */
export function InstallGuide() {
  const show = useSyncExternalStore(
    noSubscription,
    () => isIos() && !isStandalone(),
    () => false,
  );
  const dismissed = useLiveQuery(async () => (await getMeta('installGuideDismissed')) ?? false, []);

  if (!show || dismissed !== false) return null;
  return (
    <section
      aria-labelledby="install-guide-title"
      className="border-accent bg-surface rounded-lg border-2 p-4"
    >
      <h2 id="install-guide-title" className="text-lg font-bold">
        Add this app to your Home Screen
      </h2>
      <p className="mt-1">
        Safari can delete saved work for websites you have not opened for a week. Installed apps
        keep theirs.
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-6">
        <li>
          Tap the <strong>Share</strong> button in Safari&apos;s toolbar.
        </li>
        <li>
          Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
        </li>
        <li>Open Inspections from your Home Screen from now on.</li>
      </ol>
      <button
        type="button"
        className="text-accent mt-2 min-h-11 font-semibold underline"
        onClick={() => void setMeta('installGuideDismissed', true)}
      >
        Not now
      </button>
    </section>
  );
}
