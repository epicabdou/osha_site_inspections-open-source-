import 'server-only';
import { and, asc, desc, eq, gte, ilike, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { findTemplateItem, inspectionStatus, type Template } from '@/lib/schemas';
import {
  answerEvents,
  correctiveActions,
  inspections,
  photos,
  templates,
} from '@/server/db/schema';
import type { Db } from '@/server/db/types';

/** Dashboard filters, read from the URL. Unknown or malformed values are ignored. */
export const dashboardFiltersSchema = z.object({
  status: inspectionStatus.optional().catch(undefined),
  site: z.string().trim().max(200).optional().catch(undefined),
  template: z.string().trim().max(64).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
});
export type DashboardFilters = z.infer<typeof dashboardFiltersSchema>;

/** Parses URL search params into filters, dropping empty values. */
export function parseFilters(
  params: Record<string, string | string[] | undefined>,
): DashboardFilters {
  const flat = Object.fromEntries(
    Object.entries(params)
      .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
      .filter(([, value]) => value !== undefined && value !== ''),
  );
  return dashboardFiltersSchema.parse(flat);
}

const lastSyncedAt = sql<Date>`greatest(${inspections.serverReceivedAt}, (
  select max(${answerEvents.serverReceivedAt}) from ${answerEvents}
  where ${answerEvents.inspectionId} = ${inspections.id}
))`.mapWith((value: string | Date) => new Date(value));

/** Inspections newest first, filtered, with their template title and last sync time. */
export async function listInspections(db: Db, filters: DashboardFilters, limit = 100) {
  const conditions = [
    filters.status ? eq(inspections.status, filters.status) : undefined,
    filters.site
      ? ilike(inspections.site, `%${filters.site.replace(/[%_\\]/g, '\\$&')}%`)
      : undefined,
    filters.template ? eq(inspections.templateId, filters.template) : undefined,
    filters.from
      ? gte(inspections.createdAtDevice, new Date(`${filters.from}T00:00:00.000Z`))
      : undefined,
    filters.to
      ? lt(
          inspections.createdAtDevice,
          new Date(Date.parse(`${filters.to}T00:00:00.000Z`) + 86_400_000),
        )
      : undefined,
  ].filter((condition) => condition !== undefined);

  return db
    .select({
      id: inspections.id,
      site: inspections.site,
      status: inspections.status,
      createdBy: inspections.createdBy,
      createdAtDevice: inspections.createdAtDevice,
      submittedAtDevice: inspections.submittedAtDevice,
      hasCriticalFailure: inspections.hasCriticalFailure,
      templateTitle: templates.title,
      templateVersion: inspections.templateVersion,
      lastSyncedAt,
    })
    .from(inspections)
    .innerJoin(
      templates,
      and(
        eq(templates.id, inspections.templateId),
        eq(templates.version, inspections.templateVersion),
      ),
    )
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(inspections.createdAtDevice))
    .limit(limit);
}

/** Open corrective actions with the item prompt and inspection site, newest first. */
export async function listOpenFindings(db: Db) {
  const rows = await db
    .select({
      id: correctiveActions.id,
      itemId: correctiveActions.itemId,
      createdAt: correctiveActions.createdAt,
      inspectionId: inspections.id,
      site: inspections.site,
      createdBy: inspections.createdBy,
      definition: templates.definition,
    })
    .from(correctiveActions)
    .innerJoin(inspections, eq(inspections.id, correctiveActions.inspectionId))
    .innerJoin(
      templates,
      and(
        eq(templates.id, inspections.templateId),
        eq(templates.version, inspections.templateVersion),
      ),
    )
    .where(eq(correctiveActions.status, 'open'))
    .orderBy(desc(correctiveActions.createdAt));
  return rows.map(({ definition, ...row }) => ({
    ...row,
    prompt: findTemplateItem(definition, row.itemId)?.prompt ?? row.itemId,
    templateTitle: definition.title,
  }));
}

/** Values for the filter controls. */
export async function filterOptions(db: Db) {
  const [sites, templateRows] = await Promise.all([
    db
      .selectDistinct({ site: inspections.site })
      .from(inspections)
      .orderBy(asc(inspections.site))
      .limit(200),
    db
      .selectDistinct({ id: templates.id, title: templates.title })
      .from(templates)
      .orderBy(asc(templates.title)),
  ]);
  return { sites: sites.map((s) => s.site), templates: templateRows };
}

/** Everything the inspection detail page shows: answers with full history, photos, actions. */
export async function getInspectionDetail(db: Db, id: string) {
  const [inspection] = await db.select().from(inspections).where(eq(inspections.id, id)).limit(1);
  if (!inspection) return null;
  const [templateRow] = await db
    .select({ definition: templates.definition })
    .from(templates)
    .where(
      and(
        eq(templates.id, inspection.templateId),
        eq(templates.version, inspection.templateVersion),
      ),
    )
    .limit(1);
  const events = await db
    .select()
    .from(answerEvents)
    .where(eq(answerEvents.inspectionId, id))
    .orderBy(asc(answerEvents.hlc));
  const hashes = [...new Set(events.flatMap((event) => event.photoHashes))];
  const [photoRows, actions] = await Promise.all([
    hashes.length
      ? db.select().from(photos).where(inArray(photos.hash, hashes))
      : Promise.resolve([] as (typeof photos.$inferSelect)[]),
    db
      .select()
      .from(correctiveActions)
      .where(eq(correctiveActions.inspectionId, id))
      .orderBy(desc(correctiveActions.createdAt)),
  ]);
  return {
    inspection,
    template: (templateRow?.definition ?? null) as Template | null,
    // The shared reducer expects absent notes, not SQL nulls.
    events: events.map((event) => ({ ...event, note: event.note ?? undefined })),
    uploadedPhotos: new Set(photoRows.map((photo) => photo.hash)),
    correctiveActions: actions,
  };
}
