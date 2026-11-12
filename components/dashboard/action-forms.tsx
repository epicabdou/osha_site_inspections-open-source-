'use client';

import { useActionState, useId } from 'react';
import {
  type ActionState,
  cancelInspectionAction,
  closeCorrectiveActionAction,
} from '@/app/dashboard/actions';
import { Button } from '@/components/ui/button';

/** Cancel an inspection; a reason is required. Drives the rejection demo. */
export function CancelInspectionForm({ inspectionId }: { inspectionId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    cancelInspectionAction,
    {},
  );
  const id = useId();
  if (state.ok) {
    return (
      <p role="status" className="font-semibold">
        Inspection cancelled. The inspector&apos;s device learns this on its next sync.
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="inspectionId" value={inspectionId} />
      <label htmlFor={id} className="font-semibold">
        Reason for cancelling
      </label>
      <textarea
        id={id}
        name="reason"
        required
        minLength={3}
        rows={2}
        className="border-border bg-background rounded-lg border-2 p-2"
      />
      {state.error && (
        <p role="alert" className="text-danger font-semibold">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="danger" className="self-start" disabled={pending}>
        Cancel inspection
      </Button>
    </form>
  );
}

/** Close a corrective action; a note is required, so the record says how it was resolved. */
export function CloseActionForm({
  actionId,
  inspectionId,
  label,
}: {
  actionId: string;
  inspectionId: string;
  label: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    closeCorrectiveActionAction,
    {},
  );
  const id = useId();
  if (state.ok) {
    return (
      <p role="status" className="font-semibold">
        Corrective action closed.
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="actionId" value={actionId} />
      <input type="hidden" name="inspectionId" value={inspectionId} />
      <label htmlFor={id} className="text-sm font-semibold">
        How was “{label}” resolved?
      </label>
      <textarea
        id={id}
        name="note"
        required
        minLength={3}
        rows={2}
        className="border-border bg-background rounded-lg border-2 p-2"
      />
      {state.error && (
        <p role="alert" className="text-danger font-semibold">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="secondary" className="self-start" disabled={pending}>
        Close corrective action
      </Button>
    </form>
  );
}
