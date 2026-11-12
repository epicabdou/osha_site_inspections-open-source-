'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncExternalStore } from 'react';
import { reduceAnswers } from '@/lib/answers/reduce';
import { db, getMeta, type LastUser } from '@/lib/db';
import { getDemoSettings, subscribeDemoSettings } from '@/lib/demo/settings';
import { syncEngine, type SyncSnapshot } from '@/lib/sync/engine';

/** The last signed-in user saved on this device: undefined while loading, null if none. */
export function useLastUser(): LastUser | null | undefined {
  return useLiveQuery(async () => (await getMeta('lastUser')) ?? null, [], undefined);
}

/** The sync engine's state. */
export function useSyncStatus(): SyncSnapshot {
  return useSyncExternalStore(syncEngine.subscribe, syncEngine.getSnapshot, syncEngine.getSnapshot);
}

/** Demo chaos settings currently in effect. */
export function useDemoSettings() {
  return useSyncExternalStore(subscribeDemoSettings, getDemoSettings, getDemoSettings);
}

/** How many changes on this device the server has not answered for yet. */
export function usePendingCount(): number {
  return (
    useLiveQuery(async () => {
      const [outbox, photos] = await Promise.all([
        db.outbox.count(),
        db.photos.where('uploadState').anyOf(['pending', 'uploading']).count(),
      ]);
      return outbox + photos;
    }, []) ?? 0
  );
}

/** One inspection with its template, events and current answers, live from Dexie. */
export function useInspectionData(id: string) {
  return useLiveQuery(async () => {
    const inspection = await db.inspections.get(id);
    if (!inspection) return null;
    const [template, events, correctiveActions] = await Promise.all([
      db.templates.get([inspection.templateId, inspection.templateVersion]),
      db.answerEvents.where('inspectionId').equals(id).toArray(),
      db.correctiveActions.where('inspectionId').equals(id).toArray(),
    ]);
    return {
      inspection,
      template: template ?? null,
      events,
      answers: reduceAnswers(events),
      correctiveActions,
    };
  }, [id]);
}
