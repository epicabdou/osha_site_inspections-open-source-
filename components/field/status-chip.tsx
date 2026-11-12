import type { InspectionStatus } from '@/lib/schemas';

const TEXT: Record<InspectionStatus, string> = {
  draft: 'In progress',
  submitted: 'Submitted',
  cancelled: 'Cancelled',
  closed: 'Closed',
};

const TONE: Record<InspectionStatus, string> = {
  draft: 'border-accent text-accent',
  submitted: 'border-ok text-ok',
  cancelled: 'border-danger text-danger',
  closed: 'border-border text-muted',
};

export function StatusChip({ status }: { status: InspectionStatus }) {
  return (
    <span className={`rounded border-2 px-2 py-0.5 text-sm font-semibold ${TONE[status]}`}>
      {TEXT[status]}
    </span>
  );
}
