import { z } from 'zod';
import { slug } from './common';

export const ITEM_KINDS = ['pass_fail_na', 'number', 'text', 'photo'] as const;
export const itemKind = z.enum(ITEM_KINDS);
export type ItemKind = z.infer<typeof itemKind>;

/**
 * One question in a template. `id` stays the same across template versions
 * for as long as the item's meaning is unchanged.
 */
export const templateItemSchema = z
  .object({
    id: slug,
    prompt: z.string().min(1).max(500),
    kind: itemKind,
    /** A fail raises a critical finding. */
    critical: z.boolean().optional(),
    /** Unit for kind 'number', shown with every reading. Never converted. */
    unit: z.string().min(1).max(32).optional(),
    /** For kind 'number': a reading outside min..max counts as a fail. */
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    /** A fail needs a note and at least one photo before submission. */
    photoOnFail: z.boolean().optional(),
    guidance: z.string().min(1).max(2000).optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    const numeric = item.kind === 'number';
    if (!numeric) {
      for (const key of ['unit', 'min', 'max'] as const) {
        if (item[key] !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `'${key}' only applies to number items`,
          });
        }
      }
    }
    if (numeric && item.unit === undefined) {
      ctx.addIssue({ code: 'custom', path: ['unit'], message: 'Number items need a unit' });
    }
    if (item.min !== undefined && item.max !== undefined && item.min > item.max) {
      ctx.addIssue({ code: 'custom', path: ['min'], message: 'min must not exceed max' });
    }
    const canFail = item.kind === 'pass_fail_na' || item.kind === 'number';
    if (!canFail && (item.critical || item.photoOnFail)) {
      ctx.addIssue({
        code: 'custom',
        path: [item.critical ? 'critical' : 'photoOnFail'],
        message: 'Only pass/fail/N/A and number items can fail',
      });
    }
  });
export type TemplateItem = z.infer<typeof templateItemSchema>;

export const templateSectionSchema = z
  .object({
    id: slug,
    title: z.string().min(1).max(200),
    items: z.array(templateItemSchema).min(1),
  })
  .strict();
export type TemplateSection = z.infer<typeof templateSectionSchema>;

/**
 * A published template. Immutable once published: a change is a new version,
 * and an inspection stays locked to the version it started with.
 */
export const templateSchema = z
  .object({
    id: slug,
    version: z.number().int().positive(),
    title: z.string().min(1).max(200),
    sections: z.array(templateSectionSchema).min(1),
  })
  .strict()
  .superRefine((template, ctx) => {
    const sectionIds = new Set<string>();
    const itemIds = new Set<string>();
    template.sections.forEach((section, s) => {
      if (sectionIds.has(section.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sections', s, 'id'],
          message: `Duplicate section id '${section.id}'`,
        });
      }
      sectionIds.add(section.id);
      section.items.forEach((item, i) => {
        if (itemIds.has(item.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['sections', s, 'items', i, 'id'],
            message: `Duplicate item id '${item.id}'`,
          });
        }
        itemIds.add(item.id);
      });
    });
  });
export type Template = z.infer<typeof templateSchema>;

/** Finds an item anywhere in a template, or returns undefined. */
export function findTemplateItem(template: Template, itemId: string): TemplateItem | undefined {
  for (const section of template.sections) {
    const item = section.items.find((candidate) => candidate.id === itemId);
    if (item) return item;
  }
  return undefined;
}
