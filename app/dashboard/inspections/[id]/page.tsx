import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { isCriticalFailure, isFailure } from '@/lib/answers/evaluate';
import { reduceAnswers } from '@/lib/answers/reduce';
import { REJECT_REASON_TEXT, type AnswerValue, type TemplateItem, uuidV7 } from '@/lib/schemas';
import { CancelInspectionForm, CloseActionForm } from '@/components/dashboard/action-forms';
import { PhotoGallery } from '@/components/dashboard/photo-gallery';
import { LocalTime } from '@/components/ui/local-time';
import { requireSupervisor } from '@/server/auth';
import { getDb } from '@/server/db/client';
import { displayNames } from '@/server/dashboard/people';
import { getInspectionDetail } from '@/server/dashboard/queries';

export const metadata: Metadata = { title: 'Inspection' };

const STATUS_TEXT = {
  draft: 'In progress',
  submitted: 'Submitted',
  cancelled: 'Cancelled',
  closed: 'Closed',
};

export default function InspectionPage({ params }: PageProps<'/dashboard/inspections/[id]'>) {
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <InspectionDetail params={params} />
    </Suspense>
  );
}

function describe(item: TemplateItem, value: AnswerValue, photoCount: number): string {
  const photos = photoCount ? ` + ${photoCount} photo${photoCount === 1 ? '' : 's'}` : '';
  switch (value.kind) {
    case 'pass_fail_na':
      return `${value.result === 'na' ? 'N/A' : value.result === 'pass' ? 'Pass' : 'Fail'}${photos}`;
    case 'number':
      // Shown in the template's unit, exactly as recorded. Never converted.
      return `${value.value} ${item.unit ?? ''}${photos}`.trim();
    case 'text':
      return `“${value.value}”${photos}`;
    case 'photo':
      return `${photoCount} photo${photoCount === 1 ? '' : 's'}`;
    case 'cleared':
      return 'Answer cleared';
  }
}

async function InspectionDetail({
  params,
}: {
  params: PageProps<'/dashboard/inspections/[id]'>['params'];
}) {
  await requireSupervisor();
  const { id } = await params;
  if (!uuidV7.safeParse(id).success) notFound();
  const detail = await getInspectionDetail(getDb(), id);
  if (!detail || !detail.template) notFound();
  const { inspection, template, events, uploadedPhotos, correctiveActions } = detail;
  const answers = reduceAnswers(events);
  const names = await displayNames([
    inspection.createdBy,
    ...events.map((e) => e.authorId),
    ...correctiveActions.flatMap((a) => (a.closedBy ? [a.closedBy] : [])),
  ]);
  const actionsByItem = new Map<string, typeof correctiveActions>();
  for (const action of correctiveActions) {
    actionsByItem.set(action.itemId, [...(actionsByItem.get(action.itemId) ?? []), action]);
  }
  const conflicts = [...answers.values()].filter((a) => a.conflicting).length;

  return (
    <>
      <nav aria-label="Breadcrumb">
        <Link href="/dashboard" className="text-accent inline-flex min-h-11 items-center underline">
          ← All inspections
        </Link>
      </nav>
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{inspection.site}</h1>
          <span
            className="border-border rounded border-2 px-2 py-0.5 text-sm font-semibold"
            data-testid="inspection-status"
          >
            {STATUS_TEXT[inspection.status]}
          </span>
          {inspection.hasCriticalFailure && (
            <span className="bg-danger rounded px-2 py-0.5 text-sm font-bold text-white">
              Critical
            </span>
          )}
        </div>
        <p>
          {template.title} (version {template.version}) ·{' '}
          {names.get(inspection.createdBy) ?? 'Unknown inspector'}
        </p>
        <p className="text-muted text-sm">
          Started on the device <LocalTime iso={inspection.createdAtDevice} /> · received{' '}
          <LocalTime iso={inspection.serverReceivedAt} />
          {inspection.submittedAtDevice && (
            <>
              {' '}
              · submitted on the device <LocalTime iso={inspection.submittedAtDevice} />
            </>
          )}
        </p>
        {inspection.status === 'cancelled' && (
          <p className="border-danger rounded-lg border-2 p-3">
            Cancelled <LocalTime iso={inspection.cancelledAt} />. Reason: {inspection.cancelReason}
          </p>
        )}
        {conflicts > 0 && (
          <p className="rounded-lg border-2 border-amber-600 p-3 font-semibold" role="note">
            {conflicts} item{conflicts === 1 ? ' has' : 's have'} conflicting answers from different
            devices. The most recent answer is shown; the history lists every entry.
          </p>
        )}
      </header>

      {template.sections.map((section) => (
        <section
          key={section.id}
          aria-labelledby={`section-${section.id}`}
          className="flex flex-col gap-3"
        >
          <h2 id={`section-${section.id}`} className="text-xl font-bold">
            {section.title}
          </h2>
          {section.items.map((item) => {
            const answer = answers.get(item.id);
            const current = answer?.current;
            const failing = current ? isFailure(item, current.value) : false;
            const itemActions = actionsByItem.get(item.id) ?? [];
            return (
              <article
                key={item.id}
                aria-labelledby={`item-${item.id}`}
                className={`rounded-lg border-2 p-4 ${current && isCriticalFailure(item, current.value) ? 'border-danger' : 'border-border'}`}
                data-testid={`dashboard-item-${item.id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 id={`item-${item.id}`} className="font-semibold">
                    {item.prompt}
                  </h3>
                  <div className="flex gap-2">
                    {item.critical && (
                      <span className="border-danger text-danger rounded border-2 px-2 py-0.5 text-xs font-bold uppercase">
                        Critical
                      </span>
                    )}
                    {answer?.conflicting && (
                      <span
                        className="rounded border-2 border-amber-600 px-2 py-0.5 text-xs font-bold"
                        data-testid="conflict-flag"
                      >
                        Conflicting answers
                      </span>
                    )}
                  </div>
                </div>
                <p
                  className={`mt-1 text-lg ${failing ? 'text-danger font-bold' : ''}`}
                  data-testid="current-answer"
                >
                  {current
                    ? describe(item, current.value, current.photoHashes.length)
                    : 'Not answered'}
                </p>
                {current?.note && <p className="text-muted">Note: {current.note}</p>}
                {current && current.photoHashes.length > 0 && (
                  <div className="mt-2">
                    <PhotoGallery
                      label={item.prompt}
                      photos={current.photoHashes.map((hash) => ({
                        hash,
                        uploaded: uploadedPhotos.has(hash),
                      }))}
                    />
                  </div>
                )}

                {itemActions.map((action) => (
                  <div
                    key={action.id}
                    className="border-border bg-surface mt-3 rounded-lg border-2 p-3"
                  >
                    <p className="font-semibold">
                      Corrective action {action.status === 'open' ? 'open' : 'closed'} · raised{' '}
                      <LocalTime iso={action.createdAt} />
                    </p>
                    {action.status === 'open' ? (
                      <CloseActionForm
                        actionId={action.id}
                        inspectionId={inspection.id}
                        label={item.prompt}
                      />
                    ) : (
                      <p className="text-sm">
                        Closed <LocalTime iso={action.closedAt} /> by{' '}
                        {names.get(action.closedBy ?? '') ?? 'a supervisor'}: {action.closeNote}
                      </p>
                    )}
                  </div>
                ))}

                {answer && answer.history.length > 0 && (
                  <details className="mt-3" open={answer.conflicting}>
                    <summary className="text-accent min-h-11 cursor-pointer py-2 text-sm font-semibold">
                      History ({answer.history.length}{' '}
                      {answer.history.length === 1 ? 'entry' : 'entries'})
                    </summary>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm" data-testid="history">
                        <caption className="sr-only">
                          Every answer recorded for this item, oldest first
                        </caption>
                        <thead>
                          <tr className="border-border border-b">
                            <th scope="col" className="p-1">
                              Answer
                            </th>
                            <th scope="col" className="p-1">
                              Device time
                            </th>
                            <th scope="col" className="p-1">
                              Received by server
                            </th>
                            <th scope="col" className="p-1">
                              Device
                            </th>
                            <th scope="col" className="p-1">
                              Author
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {answer.history.map((event) => (
                            <tr
                              key={event.id}
                              className={`border-border border-b ${event.id === current?.id ? 'font-semibold' : ''}`}
                              data-device={event.deviceId}
                            >
                              <td className="p-1">
                                {describe(item, event.value, event.photoHashes.length)}
                                {event.note ? ` — ${event.note}` : ''}
                                {event.id === current?.id ? ' (current)' : ''}
                              </td>
                              <td className="p-1">
                                <LocalTime iso={event.deviceTime} />
                              </td>
                              <td className="p-1">
                                <LocalTime iso={event.serverReceivedAt} />
                              </td>
                              <td className="p-1 font-mono">…{event.deviceId.slice(-6)}</td>
                              <td className="p-1">{names.get(event.authorId) ?? event.authorId}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </article>
            );
          })}
        </section>
      ))}

      {(inspection.status === 'draft' || inspection.status === 'submitted') && (
        <section
          aria-labelledby="cancel-title"
          className="border-border flex flex-col gap-2 rounded-lg border-2 p-4"
        >
          <h2 id="cancel-title" className="text-lg font-bold">
            Cancel this inspection
          </h2>
          <p className="text-muted text-sm">
            The inspector&apos;s device is told on its next sync; answers sent after that are
            rejected with the reason “{REJECT_REASON_TEXT.inspection_cancelled}”
          </p>
          <CancelInspectionForm inspectionId={inspection.id} />
        </section>
      )}
    </>
  );
}
