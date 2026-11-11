import { describe, expect, it } from 'vitest';
import {
  answerEventSchema,
  answerValueSchema,
  findTemplateItem,
  inspectionSchema,
  isoUtc,
  REJECT_REASON_TEXT,
  REJECT_REASONS,
  templateItemSchema,
  templateSchema,
  type Template,
} from '@/lib/schemas';

const UUID_V7 = '01935c4e-8f4b-7c3a-9d2e-1a2b3c4d5e6f';
const UUID_V7_B = '01935c4e-8f4b-7c3a-9d2e-1a2b3c4d5e70';
const UUID_V4 = '9b2f8a4e-3c1d-4e5f-8a9b-0c1d2e3f4a5b';
const HASH = 'a'.repeat(64);

const validTemplate: Template = {
  id: 'scaffold-inspection',
  version: 1,
  title: 'Scaffold pre-use inspection',
  sections: [
    {
      id: 'base',
      title: 'Base',
      items: [
        { id: 'base-plates', prompt: 'Base plates sit on firm ground', kind: 'pass_fail_na' },
        {
          id: 'guardrail-height',
          prompt: 'Top guardrail height',
          kind: 'number',
          unit: 'mm',
          min: 950,
          max: 1200,
          critical: true,
          photoOnFail: true,
        },
      ],
    },
    {
      id: 'notes',
      title: 'Notes',
      items: [
        { id: 'general-notes', prompt: 'Anything else', kind: 'text' },
        { id: 'overview-photo', prompt: 'Overview photo', kind: 'photo' },
      ],
    },
  ],
};

describe('templateSchema', () => {
  it('accepts a well-formed template', () => {
    expect(templateSchema.parse(validTemplate)).toEqual(validTemplate);
  });

  it('rejects duplicate item ids across sections', () => {
    const duplicate = structuredClone(validTemplate);
    duplicate.sections[1]!.items[0]!.id = 'base-plates';
    const result = templateSchema.safeParse(duplicate);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/Duplicate item id/);
  });

  it('rejects duplicate section ids', () => {
    const duplicate = structuredClone(validTemplate);
    duplicate.sections[1]!.id = 'base';
    expect(templateSchema.safeParse(duplicate).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(templateSchema.safeParse({ ...validTemplate, owner: 'x' }).success).toBe(false);
  });

  it('rejects a non-positive version and a non-slug id', () => {
    expect(templateSchema.safeParse({ ...validTemplate, version: 0 }).success).toBe(false);
    expect(templateSchema.safeParse({ ...validTemplate, id: 'Scaffold Inspection' }).success).toBe(
      false,
    );
  });

  it('finds items in any section', () => {
    expect(findTemplateItem(validTemplate, 'overview-photo')?.kind).toBe('photo');
    expect(findTemplateItem(validTemplate, 'missing')).toBeUndefined();
  });
});

describe('templateItemSchema', () => {
  const base = { id: 'reading', prompt: 'Reading' };

  it('requires a unit on number items', () => {
    expect(templateItemSchema.safeParse({ ...base, kind: 'number' }).success).toBe(false);
    expect(templateItemSchema.safeParse({ ...base, kind: 'number', unit: 'kPa' }).success).toBe(
      true,
    );
  });

  it('rejects unit, min and max on non-number items', () => {
    expect(templateItemSchema.safeParse({ ...base, kind: 'text', unit: 'mm' }).success).toBe(false);
    expect(templateItemSchema.safeParse({ ...base, kind: 'pass_fail_na', min: 1 }).success).toBe(
      false,
    );
  });

  it('rejects min greater than max', () => {
    const item = { ...base, kind: 'number', unit: 'mm', min: 10, max: 5 };
    expect(templateItemSchema.safeParse(item).success).toBe(false);
  });

  it('only lets items that can fail be critical or need a photo on fail', () => {
    expect(templateItemSchema.safeParse({ ...base, kind: 'text', critical: true }).success).toBe(
      false,
    );
    expect(
      templateItemSchema.safeParse({ ...base, kind: 'photo', photoOnFail: true }).success,
    ).toBe(false);
    expect(
      templateItemSchema.safeParse({ ...base, kind: 'pass_fail_na', critical: true }).success,
    ).toBe(true);
  });
});

describe('isoUtc', () => {
  it('accepts UTC timestamps only', () => {
    expect(isoUtc.safeParse('2026-11-11T09:30:00.000Z').success).toBe(true);
    expect(isoUtc.safeParse('2026-11-11T09:30:00+01:00').success).toBe(false);
    expect(isoUtc.safeParse('2026-11-11').success).toBe(false);
  });
});

describe('inspectionSchema', () => {
  const inspection = {
    id: UUID_V7,
    templateId: 'scaffold-inspection',
    templateVersion: 1,
    site: 'Plant room B2',
    status: 'draft',
    createdBy: 'user_123',
    createdAtDevice: '2026-11-11T09:30:00.000Z',
    hasCriticalFailure: false,
  };

  it('accepts a draft inspection', () => {
    expect(inspectionSchema.parse(inspection)).toEqual(inspection);
  });

  it('requires a UUIDv7 id', () => {
    expect(inspectionSchema.safeParse({ ...inspection, id: UUID_V4 }).success).toBe(false);
  });

  it('rejects an empty site and an unknown status', () => {
    expect(inspectionSchema.safeParse({ ...inspection, site: '   ' }).success).toBe(false);
    expect(inspectionSchema.safeParse({ ...inspection, status: 'deleted' }).success).toBe(false);
  });
});

describe('answer schemas', () => {
  const event = {
    id: UUID_V7,
    inspectionId: UUID_V7_B,
    itemId: 'guardrail-height',
    value: { kind: 'number', value: 1010 },
    photoHashes: [HASH],
    hlc: '000001234567890:0000:device-a',
    deviceId: 'device-a',
    authorId: 'user_123',
    deviceTime: '2026-11-11T09:31:00.000Z',
  };

  it('accepts every answer value kind', () => {
    for (const value of [
      { kind: 'pass_fail_na', result: 'fail' },
      { kind: 'number', value: -3.5 },
      { kind: 'text', value: 'Loose clamp on level 2' },
      { kind: 'photo' },
      { kind: 'cleared' },
    ]) {
      expect(answerValueSchema.safeParse(value).success).toBe(true);
    }
  });

  it('rejects malformed values', () => {
    expect(answerValueSchema.safeParse({ kind: 'number', value: Infinity }).success).toBe(false);
    expect(answerValueSchema.safeParse({ kind: 'pass_fail_na', result: 'maybe' }).success).toBe(
      false,
    );
    expect(answerValueSchema.safeParse({ kind: 'number', value: '12' }).success).toBe(false);
    expect(answerValueSchema.safeParse({ kind: 'photo', value: 1 }).success).toBe(false);
  });

  it('accepts a wire answer event and rejects local-only fields', () => {
    expect(answerEventSchema.parse(event)).toEqual(event);
    expect(answerEventSchema.safeParse({ ...event, syncState: 'queued' }).success).toBe(false);
  });

  it('rejects photo hashes that are not SHA-256 hex', () => {
    expect(answerEventSchema.safeParse({ ...event, photoHashes: ['abc'] }).success).toBe(false);
  });
});

describe('reject reasons', () => {
  it('has user-facing text for every reason', () => {
    for (const reason of REJECT_REASONS) {
      expect(REJECT_REASON_TEXT[reason].length).toBeGreaterThan(0);
    }
  });
});
