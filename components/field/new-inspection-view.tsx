'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useState } from 'react';
import { db, isQuotaExceeded, type LastUser } from '@/lib/db';
import { createInspection, FieldActionError } from '@/lib/field/actions';
import { navigate } from '@/lib/field/navigation';
import { requestPersistentStorage } from '@/lib/field/storage';
import { Button } from '@/components/ui/button';
import { useSyncStatus } from './hooks';

const DEFAULT_SITES = ['Warehouse A', 'Plant room B2', 'Loading dock'];

export function NewInspectionView({ user }: { user: LastUser }) {
  const siteId = useId();
  const [site, setSite] = useState('');
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sync = useSyncStatus();

  const data = useLiveQuery(async () => {
    const all = await db.templates.toArray();
    // Offer the latest version of each template; older versions stay for old inspections.
    const latest = new Map<string, (typeof all)[number]>();
    for (const template of all) {
      const seen = latest.get(template.id);
      if (!seen || template.version > seen.version) latest.set(template.id, template);
    }
    const inspections = await db.inspections.orderBy('updatedAt').reverse().toArray();
    const recent = [...new Set([...inspections.map((i) => i.site), ...DEFAULT_SITES])].slice(0, 8);
    return {
      templates: [...latest.values()].sort((a, b) => a.title.localeCompare(b.title)),
      recent,
    };
  }, []);

  const selected = data?.templates.find((t) => `${t.id}@${t.version}` === templateKey);

  async function start() {
    setError(null);
    if (!site.trim()) return setError('Enter the site you are inspecting.');
    if (!selected) return setError('Choose a checklist.');
    setBusy(true);
    try {
      const inspection = await createInspection(
        { templateId: selected.id, templateVersion: selected.version, site },
        user,
      );
      void requestPersistentStorage();
      navigate({ view: 'inspection', id: inspection.id }, { replace: true });
    } catch (caught) {
      setError(
        isQuotaExceeded(caught)
          ? 'This device is out of storage. Free some space; nothing you saved has been lost.'
          : caught instanceof FieldActionError
            ? caught.message
            : 'Could not start the inspection.',
      );
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <h1 className="text-2xl font-bold">New inspection</h1>

      <div className="flex flex-col gap-2">
        <label htmlFor={siteId} className="text-lg font-semibold">
          Site
        </label>
        <input
          id={siteId}
          name="site"
          value={site}
          onChange={(event) => setSite(event.target.value)}
          list={`${siteId}-recent`}
          autoComplete="off"
          className="border-border bg-background min-h-12 rounded-lg border-2 px-3 text-lg"
          placeholder="e.g. Plant room B2"
        />
        <datalist id={`${siteId}-recent`}>
          {data?.recent.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <div className="flex flex-wrap gap-2" aria-label="Recent sites">
          {data?.recent.slice(0, 4).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setSite(name)}
              className="border-border min-h-11 rounded-full border-2 px-3 text-sm"
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-lg font-semibold">Checklist</legend>
        {data === undefined ? (
          <p role="status" className="text-muted">
            Loading…
          </p>
        ) : data.templates.length === 0 ? (
          <p className="border-border rounded-lg border-2 border-dashed p-4">
            {sync.phase === 'syncing'
              ? 'Downloading checklists…'
              : 'No checklists on this device yet. Connect once and they download automatically.'}
          </p>
        ) : (
          data.templates.map((template) => {
            const key = `${template.id}@${template.version}`;
            const count = template.sections.reduce((n, s) => n + s.items.length, 0);
            return (
              <label
                key={key}
                className="border-border has-[:checked]:border-accent has-[:checked]:bg-surface flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border-2 p-3"
              >
                <input
                  type="radio"
                  name="template"
                  value={key}
                  checked={templateKey === key}
                  onChange={() => setTemplateKey(key)}
                  className="size-6"
                />
                <span className="flex flex-col">
                  <span className="font-semibold">{template.title}</span>
                  <span className="text-muted text-sm">
                    {count} items · version {template.version}
                  </span>
                </span>
              </label>
            );
          })
        )}
      </fieldset>

      {error && (
        <p role="alert" className="text-danger font-semibold">
          {error}
        </p>
      )}

      <div className="bg-background/95 border-border fixed inset-x-0 bottom-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-2xl gap-3">
          <Button variant="secondary" onClick={() => navigate({ view: 'home' })}>
            Back
          </Button>
          <Button type="submit" className="flex-1 text-lg" disabled={busy}>
            Start inspection
          </Button>
        </div>
      </div>
    </form>
  );
}
