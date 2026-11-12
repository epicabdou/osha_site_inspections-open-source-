import { describe, expect, it } from 'vitest';
import { templateSchema } from '@/lib/schemas';
import { SEED_TEMPLATES } from '@/server/seed/templates';

describe('seed templates', () => {
  it.each(SEED_TEMPLATES.map((t) => [t.title, t] as const))(
    '%s is a valid template',
    (_, template) => {
      expect(() => templateSchema.parse(template)).not.toThrow();
    },
  );

  it.each(SEED_TEMPLATES.map((t) => [t.title, t] as const))(
    '%s has 10 to 15 items and 2 or 3 critical items',
    (_, template) => {
      const items = template.sections.flatMap((s) => s.items);
      expect(items.length).toBeGreaterThanOrEqual(10);
      expect(items.length).toBeLessThanOrEqual(15);
      const critical = items.filter((i) => i.critical).length;
      expect(critical).toBeGreaterThanOrEqual(2);
      expect(critical).toBeLessThanOrEqual(3);
    },
  );

  it('uses every item kind, including a number with a unit and limits', () => {
    const items = SEED_TEMPLATES.flatMap((t) => t.sections.flatMap((s) => s.items));
    expect(new Set(items.map((i) => i.kind))).toEqual(
      new Set(['pass_fail_na', 'number', 'text', 'photo']),
    );
    expect(
      items.some(
        (i) => i.kind === 'number' && i.unit && i.min !== undefined && i.max !== undefined,
      ),
    ).toBe(true);
  });
});
