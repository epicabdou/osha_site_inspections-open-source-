'use client';

import { useState } from 'react';
import { failingCriticalItems, progress, submitProblems } from '@/lib/answers/evaluate';
import type { LastUser } from '@/lib/db';
import { FieldActionError, submitInspection } from '@/lib/field/actions';
import { downloadLocalData } from '@/lib/field/export';
import { formatDateTime } from '@/lib/field/format';
import { navigate } from '@/lib/field/navigation';
import { REJECT_REASON_TEXT } from '@/lib/schemas';
import { Button } from '@/components/ui/button';
import { useInspectionData } from './hooks';
import { ItemCard } from './item-card';
import { StatusChip } from './status-chip';

const PROBLEM_TEXT = {
  unanswered: 'not answered',
  needs_note: 'needs a note (it failed)',
  needs_photo: 'needs a photo (it failed)',
} as const;

export function InspectionView({
  user,
  id,
  section,
}: {
  user: LastUser;
  id: string;
  section?: string | undefined;
}) {
  const data = useInspectionData(id);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (data === undefined) {
    return (
      <p role="status" className="text-muted">
        Loading…
      </p>
    );
  }
  if (data === null) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Inspection not found</h1>
        <p>This inspection is not on this device.</p>
        <Button variant="secondary" onClick={() => navigate({ view: 'home' })}>
          Back to inspections
        </Button>
      </div>
    );
  }

  const { inspection, template, answers, events, correctiveActions } = data;
  if (!template) {
    return (
      <p className="border-border rounded-lg border-2 p-4">
        The checklist for this inspection has not downloaded yet. Connect once to fetch it.
      </p>
    );
  }

  const editable = inspection.status === 'draft';
  const sections = template.sections;
  const index = Math.max(
    0,
    sections.findIndex((s) => s.id === section),
  );
  const current = sections[index]!;
  const failingCritical = failingCriticalItems(template, answers);
  const problems = submitProblems(template, answers);
  const counts = progress(template, answers);
  const rejected = events.filter((event) => event.syncState === 'rejected');
  const openActions = correctiveActions.filter((action) => action.status === 'open');

  const goToSection = (sectionId: string) =>
    navigate({ view: 'inspection', id, section: sectionId }, { replace: true });

  async function submit() {
    setError(null);
    try {
      await submitInspection(id);
      setReviewing(false);
    } catch (caught) {
      setError(caught instanceof FieldActionError ? caught.message : 'Could not submit.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{inspection.site}</h1>
          <StatusChip status={inspection.status} />
        </div>
        <p>{template.title}</p>
        <p className="text-muted text-sm">
          Started {formatDateTime(inspection.createdAtDevice)} · {counts.answered} of {counts.total}{' '}
          answered
          {inspection.submittedAtDevice
            ? ` · submitted ${formatDateTime(inspection.submittedAtDevice)}`
            : ''}
        </p>
      </header>

      {inspection.status === 'cancelled' && (
        <div role="alert" className="border-danger bg-danger-surface rounded-lg border-2 p-4">
          <p className="font-bold">A supervisor cancelled this inspection.</p>
          {inspection.cancelReason && <p className="mt-1">Reason: {inspection.cancelReason}</p>}
          <p className="mt-1">
            New answers will not be accepted. Everything you recorded stays on this device.
          </p>
          <Button variant="secondary" className="mt-3" onClick={() => void downloadLocalData()}>
            Export my data as JSON
          </Button>
        </div>
      )}

      {inspection.syncState === 'rejected' && inspection.rejectReason && (
        <div role="alert" className="border-danger bg-danger-surface rounded-lg border-2 p-4">
          <p className="font-bold">The server rejected this inspection.</p>
          <p className="mt-1">{REJECT_REASON_TEXT[inspection.rejectReason]}</p>
        </div>
      )}

      {failingCritical.map((item) => (
        <div
          key={item.id}
          role="alert"
          className="bg-danger rounded-lg p-4 font-semibold text-white"
          data-testid="critical-banner"
        >
          Critical item failed: {item.prompt}. Follow your site&apos;s stop-work procedure.
        </div>
      ))}
      {inspection.hasCriticalFailure && failingCritical.length === 0 && (
        <div className="border-danger rounded-lg border-2 p-4" data-testid="critical-banner">
          A critical item failed earlier in this inspection. Its history shows the details.
        </div>
      )}
      {openActions.length > 0 && (
        <p className="border-border bg-surface rounded-lg border-2 p-3">
          {openActions.length} corrective action{openActions.length === 1 ? ' is' : 's are'} open
          for this inspection. A supervisor closes them.
        </p>
      )}

      {rejected.length > 0 && (
        <div className="border-danger rounded-lg border-2 p-4">
          <p className="font-bold">
            {rejected.length} answer{rejected.length === 1 ? ' was' : 's were'} rejected by the
            server.
          </p>
          <p className="mt-1">They stay on this device, marked with the reason.</p>
          <Button variant="secondary" className="mt-3" onClick={() => void downloadLocalData()}>
            Export my data as JSON
          </Button>
        </div>
      )}

      <nav aria-label="Sections" className="-mx-4 overflow-x-auto px-4">
        <ul className="flex gap-2">
          {sections.map((s, i) => {
            const done = s.items.every((item) => answers.get(item.id)?.current);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={i === index ? 'page' : undefined}
                  onClick={() => goToSection(s.id)}
                  className={`min-h-11 rounded-full border-2 px-4 text-sm font-semibold whitespace-nowrap ${
                    i === index ? 'border-accent bg-accent text-accent-foreground' : 'border-border'
                  }`}
                >
                  {s.title}
                  {done ? ' ✓' : ''}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <section aria-labelledby="section-title" className="flex flex-col gap-4">
        <h2 id="section-title" className="text-xl font-bold">
          {current.title}
        </h2>
        {current.items.map((item) => (
          <ItemCard
            key={item.id}
            user={user}
            inspectionId={id}
            item={item}
            answer={answers.get(item.id)}
            editable={editable}
          />
        ))}
      </section>

      {reviewing && (
        <section
          aria-labelledby="review-title"
          className="border-accent rounded-lg border-2 p-4"
          data-testid="review"
        >
          <h2 id="review-title" className="text-xl font-bold">
            Review and submit
          </h2>
          {problems.length === 0 ? (
            <p className="mt-2">
              Every item is answered. Submitting works offline: it waits on this device until there
              is a connection.
            </p>
          ) : (
            <>
              <p className="mt-2">These items need attention before you can submit:</p>
              <ul className="mt-2 list-disc space-y-1 pl-6">
                {problems.map((problem) => (
                  <li key={`${problem.itemId}-${problem.problem}`}>
                    {problem.prompt}: {PROBLEM_TEXT[problem.problem]}
                  </li>
                ))}
              </ul>
            </>
          )}
          {error && (
            <p role="alert" className="text-danger mt-2 font-semibold">
              {error}
            </p>
          )}
          <Button
            className="mt-4 w-full text-lg"
            disabled={problems.length > 0}
            onClick={() => void submit()}
          >
            Submit inspection
          </Button>
        </section>
      )}

      <div className="bg-background/95 border-border fixed inset-x-0 bottom-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-2xl gap-3">
          <Button
            variant="secondary"
            disabled={index === 0}
            onClick={() => goToSection(sections[index - 1]!.id)}
          >
            Previous
          </Button>
          {index < sections.length - 1 ? (
            <Button className="flex-1" onClick={() => goToSection(sections[index + 1]!.id)}>
              Next section
            </Button>
          ) : editable ? (
            <Button className="flex-1" onClick={() => setReviewing(true)}>
              Review and submit
            </Button>
          ) : (
            <Button
              className="flex-1"
              variant="secondary"
              onClick={() => navigate({ view: 'home' })}
            >
              Back to inspections
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
