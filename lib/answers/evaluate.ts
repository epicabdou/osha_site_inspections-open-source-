import type { AnswerValue, Template, TemplateItem } from '@/lib/schemas';
import type { ItemAnswer, ReducibleEvent } from './reduce';

/**
 * True when a value counts as a fail for its item: a "fail" result, or a reading
 * outside the item's min..max. Units are never converted: the limits are in the
 * template's unit and so is the reading.
 */
export function isFailure(item: TemplateItem, value: AnswerValue | undefined): boolean {
  if (!value) return false;
  if (value.kind === 'pass_fail_na') return value.result === 'fail';
  if (value.kind === 'number') {
    if (item.min !== undefined && value.value < item.min) return true;
    if (item.max !== undefined && value.value > item.max) return true;
  }
  return false;
}

/** True when a value is a fail on a critical item. */
export function isCriticalFailure(item: TemplateItem, value: AnswerValue | undefined): boolean {
  return item.critical === true && isFailure(item, value);
}

/** Checks whether a value has the shape its item expects (or clears it). */
export function valueMatchesItem(item: TemplateItem, value: AnswerValue): boolean {
  return value.kind === 'cleared' || value.kind === item.kind;
}

export type SubmitProblem = {
  itemId: string;
  prompt: string;
  problem: 'unanswered' | 'needs_note' | 'needs_photo';
};

/**
 * What stops an inspection from being submitted: every item needs an answer, and an
 * item with `photoOnFail` that failed needs a note and at least one photo.
 */
export function submitProblems(
  template: Template,
  answers: Map<string, ItemAnswer<ReducibleEvent>>,
): SubmitProblem[] {
  const problems: SubmitProblem[] = [];
  for (const section of template.sections) {
    for (const item of section.items) {
      const current = answers.get(item.id)?.current;
      if (!current) {
        problems.push({ itemId: item.id, prompt: item.prompt, problem: 'unanswered' });
        continue;
      }
      if (item.photoOnFail && isFailure(item, current.value)) {
        if (!current.note?.trim()) {
          problems.push({ itemId: item.id, prompt: item.prompt, problem: 'needs_note' });
        }
        if (current.photoHashes.length === 0) {
          problems.push({ itemId: item.id, prompt: item.prompt, problem: 'needs_photo' });
        }
      }
    }
  }
  return problems;
}

/** Critical items whose current answer is a fail, in template order. */
export function failingCriticalItems(
  template: Template,
  answers: Map<string, ItemAnswer<ReducibleEvent>>,
): TemplateItem[] {
  const failing: TemplateItem[] = [];
  for (const section of template.sections) {
    for (const item of section.items) {
      if (isCriticalFailure(item, answers.get(item.id)?.current?.value)) failing.push(item);
    }
  }
  return failing;
}

/** Counts answered items, for progress display. */
export function progress(
  template: Template,
  answers: Map<string, ItemAnswer<ReducibleEvent>>,
): { answered: number; total: number } {
  let answered = 0;
  let total = 0;
  for (const section of template.sections) {
    for (const item of section.items) {
      total += 1;
      if (answers.get(item.id)?.current) answered += 1;
    }
  }
  return { answered, total };
}
