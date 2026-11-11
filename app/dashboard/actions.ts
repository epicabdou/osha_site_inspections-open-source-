'use server';

import { revalidatePath } from 'next/cache';
import { requireSupervisor } from '@/server/auth';
import { getDb } from '@/server/db/client';
import {
  cancelInspection,
  cancelInspectionInput,
  closeCorrectiveAction,
  closeCorrectiveActionInput,
} from '@/server/dashboard/mutations';

/**
 * Supervisor actions. Server Actions are fine here: the dashboard is online-only, unlike
 * the field app, whose writes go through the outbox and /api/sync/push.
 * Every action re-checks the role from the session and validates its input with Zod.
 */

export type ActionState = { ok?: boolean; error?: string };

export async function cancelInspectionAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSupervisor();
  const input = cancelInspectionInput.safeParse({
    inspectionId: form.get('inspectionId'),
    reason: form.get('reason'),
  });
  if (!input.success) return { error: input.error.issues[0]?.message ?? 'Invalid input.' };
  const outcome = await cancelInspection(getDb(), input.data);
  if (!outcome.ok) return { error: outcome.error };
  revalidatePath('/dashboard');
  revalidatePath(`/dashboard/inspections/${input.data.inspectionId}`);
  return { ok: true };
}

export async function closeCorrectiveActionAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const supervisor = await requireSupervisor();
  const input = closeCorrectiveActionInput.safeParse({
    actionId: form.get('actionId'),
    note: form.get('note'),
  });
  if (!input.success) return { error: input.error.issues[0]?.message ?? 'Invalid input.' };
  const outcome = await closeCorrectiveAction(getDb(), supervisor.userId, input.data);
  if (!outcome.ok) return { error: outcome.error };
  const inspectionId = form.get('inspectionId');
  revalidatePath('/dashboard');
  if (typeof inspectionId === 'string') revalidatePath(`/dashboard/inspections/${inspectionId}`);
  return { ok: true };
}
