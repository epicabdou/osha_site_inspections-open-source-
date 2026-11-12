import type { Metadata } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { Suspense } from 'react';
import { INSPECTION_STATUSES } from '@/lib/schemas';
import { buttonClass } from '@/components/ui/button';
import { LocalTime } from '@/components/ui/local-time';
import { requireSupervisor } from '@/server/auth';
import { getDb } from '@/server/db/client';
import { displayNames } from '@/server/dashboard/people';
import {
  type DashboardFilters,
  filterOptions,
  listInspections,
  listOpenFindings,
  parseFilters,
} from '@/server/dashboard/queries';

export const metadata: Metadata = { title: 'Dashboard' };

const STATUS_TEXT = {
  draft: 'In progress',
  submitted: 'Submitted',
  cancelled: 'Cancelled',
  closed: 'Closed',
};

/**
 * Overview: open critical findings first, then inspections newest first. Filters live in
 * the URL. The heading is static; everything that reads the session or the database
 * streams in behind <Suspense> (Cache Components).
 */
export default function DashboardPage({ searchParams }: PageProps<'/dashboard'>) {
  return (
    <>
      <h1 className="text-2xl font-bold">Overview</h1>
      <Suspense fallback={<p role="status">Loading…</p>}>
        <Overview searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Overview({
  searchParams,
}: {
  searchParams: PageProps<'/dashboard'>['searchParams'];
}) {
  await requireSupervisor();
  const filters = parseFilters(await searchParams);
  const db = getDb();
  const [findings, inspections, options] = await Promise.all([
    listOpenFindings(db),
    listInspections(db, filters),
    filterOptions(db),
  ]);
  const names = await displayNames(
    inspections.map((i) => i.createdBy).concat(findings.map((f) => f.createdBy)),
  );

  return (
    <>
      <section aria-labelledby="findings-title" className="flex flex-col gap-3">
        <h2 id="findings-title" className="text-xl font-bold">
          Open critical findings ({findings.length})
        </h2>
        {findings.length === 0 ? (
          <p className="text-muted">No open corrective actions.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {findings.map((finding) => (
              <li
                key={finding.id}
                className="border-danger bg-danger-surface rounded-lg border-2 p-3"
              >
                <Link
                  href={`/dashboard/inspections/${finding.inspectionId}`}
                  className="font-semibold underline"
                >
                  {finding.prompt}
                </Link>
                <p className="text-sm">
                  {finding.site} · {finding.templateTitle} ·{' '}
                  {names.get(finding.createdBy) ?? 'Unknown inspector'} · raised{' '}
                  <LocalTime iso={finding.createdAt} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="inspections-title" className="flex flex-col gap-3">
        <h2 id="inspections-title" className="text-xl font-bold">
          Inspections
        </h2>
        <Filters filters={filters} options={options} />
        {inspections.length === 0 ? (
          <p className="text-muted">No inspections match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Inspections, newest first</caption>
              <thead>
                <tr className="border-border border-b-2">
                  <th scope="col" className="p-2">
                    Site
                  </th>
                  <th scope="col" className="p-2">
                    Checklist
                  </th>
                  <th scope="col" className="p-2">
                    Inspector
                  </th>
                  <th scope="col" className="p-2">
                    Status
                  </th>
                  <th scope="col" className="p-2">
                    Started (device)
                  </th>
                  <th scope="col" className="p-2">
                    Last synced
                  </th>
                </tr>
              </thead>
              <tbody>
                {inspections.map((inspection) => (
                  <tr key={inspection.id} className="border-border border-b">
                    <td className="p-2">
                      <Link
                        href={`/dashboard/inspections/${inspection.id}`}
                        className="font-semibold underline"
                      >
                        {inspection.site}
                      </Link>
                      {inspection.hasCriticalFailure && (
                        <span className="bg-danger ml-2 rounded px-2 py-0.5 text-xs font-bold text-white">
                          Critical
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      {inspection.templateTitle}{' '}
                      <span className="text-muted text-sm">v{inspection.templateVersion}</span>
                    </td>
                    <td className="p-2">
                      {names.get(inspection.createdBy) ?? 'Unknown inspector'}
                    </td>
                    <td className="p-2">{STATUS_TEXT[inspection.status]}</td>
                    <td className="p-2">
                      <LocalTime iso={inspection.createdAtDevice} />
                    </td>
                    <td className="p-2">
                      <LocalTime iso={inspection.lastSyncedAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Filters({
  filters,
  options,
}: {
  filters: DashboardFilters;
  options: Awaited<ReturnType<typeof filterOptions>>;
}) {
  const field = 'border-border bg-background min-h-11 rounded-lg border-2 px-2';
  return (
    <Form
      action="/dashboard"
      className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6"
      aria-label="Filter inspections"
    >
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Status
        <select name="status" defaultValue={filters.status ?? ''} className={field}>
          <option value="">Any</option>
          {INSPECTION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_TEXT[status]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Site
        <input
          name="site"
          defaultValue={filters.site ?? ''}
          list="dashboard-sites"
          className={field}
        />
        <datalist id="dashboard-sites">
          {options.sites.map((site) => (
            <option key={site} value={site} />
          ))}
        </datalist>
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Checklist
        <select name="template" defaultValue={filters.template ?? ''} className={field}>
          <option value="">Any</option>
          {options.templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.title}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        From
        <input type="date" name="from" defaultValue={filters.from ?? ''} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        To
        <input type="date" name="to" defaultValue={filters.to ?? ''} className={field} />
      </label>
      <div className="flex items-end gap-2">
        <button type="submit" className={buttonClass('primary')}>
          Filter
        </button>
        <Link href="/dashboard" className={buttonClass('secondary')}>
          Clear
        </Link>
      </div>
    </Form>
  );
}
