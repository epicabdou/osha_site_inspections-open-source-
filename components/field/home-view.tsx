'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { progress } from '@/lib/answers/evaluate';
import { reduceAnswers } from '@/lib/answers/reduce';
import { db } from '@/lib/db';
import { formatDateTime } from '@/lib/field/format';
import { fieldHref, navigate } from '@/lib/field/navigation';
import { Button } from '@/components/ui/button';
import { InstallGuide } from './install-guide';
import { StatusChip } from './status-chip';

export function HomeView() {
  const rows = useLiveQuery(async () => {
    const inspections = await db.inspections.orderBy('updatedAt').reverse().toArray();
    return Promise.all(
      inspections.map(async (inspection) => {
        const [template, events, rejected] = await Promise.all([
          db.templates.get([inspection.templateId, inspection.templateVersion]),
          db.answerEvents.where('inspectionId').equals(inspection.id).toArray(),
          db.answerEvents
            .where('inspectionId')
            .equals(inspection.id)
            .filter((event) => event.syncState === 'rejected')
            .count(),
        ]);
        const counts = template ? progress(template, reduceAnswers(events)) : undefined;
        return { inspection, title: template?.title ?? inspection.templateId, counts, rejected };
      }),
    );
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <InstallGuide />
      <h1 className="text-2xl font-bold">Your inspections</h1>

      {rows === undefined ? (
        <p role="status" className="text-muted">
          Loading…
        </p>
      ) : rows.length === 0 ? (
        <div className="border-border rounded-lg border-2 border-dashed p-6 text-center">
          <p className="text-lg font-semibold">No inspections yet</p>
          <p className="text-muted mt-1">Start one below. It works without signal.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Inspections">
          {rows.map(({ inspection, title, counts, rejected }) => (
            <li key={inspection.id}>
              <a
                href={fieldHref({ view: 'inspection', id: inspection.id })}
                onClick={(event) => {
                  event.preventDefault();
                  navigate({ view: 'inspection', id: inspection.id });
                }}
                className="border-border bg-surface flex min-h-20 flex-col gap-1 rounded-lg border-2 p-4"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold">{inspection.site}</span>
                  <StatusChip status={inspection.status} />
                  {inspection.hasCriticalFailure && (
                    <span className="bg-danger rounded px-2 py-0.5 text-sm font-bold text-white">
                      Critical
                    </span>
                  )}
                  {rejected > 0 && (
                    <span className="border-danger text-danger rounded border-2 px-2 py-0.5 text-sm font-bold">
                      {rejected} rejected
                    </span>
                  )}
                </span>
                <span>{title}</span>
                <span className="text-muted text-sm">
                  {counts ? `${counts.answered} of ${counts.total} answered · ` : ''}
                  Updated {formatDateTime(inspection.updatedAt)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="bg-background/95 border-border fixed inset-x-0 bottom-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-2xl">
          <Button className="w-full text-lg" onClick={() => navigate({ view: 'new' })}>
            Start an inspection
          </Button>
        </div>
      </div>
    </div>
  );
}
