'use client';

import { useSyncExternalStore } from 'react';

const noSubscription = () => () => {};

/**
 * A timestamp stored as ISO 8601 UTC, shown in the viewer's own locale and time zone.
 * The server render shows UTC; the browser switches to local time after hydration.
 */
export function LocalTime({
  iso,
  dateOnly = false,
}: {
  iso: string | Date | null | undefined;
  dateOnly?: boolean;
}) {
  const value = iso instanceof Date ? iso.toISOString() : iso;
  const text = useSyncExternalStore(
    noSubscription,
    () => (value ? format(value, dateOnly) : '—'),
    () =>
      value
        ? `${value.slice(0, dateOnly ? 10 : 16).replace('T', ' ')}${dateOnly ? '' : ' UTC'}`
        : '—',
  );
  return value ? <time dateTime={value}>{text}</time> : <span>—</span>;
}

function format(iso: string, dateOnly: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(
    undefined,
    dateOnly ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'medium' },
  ).format(date);
}
