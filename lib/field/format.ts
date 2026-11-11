/** Display helpers. Times are stored as ISO 8601 UTC and shown in the device's locale and zone. */

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const timeOnly = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateTime.format(date);
}

export function formatTime(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : timeOnly.format(date);
}

/** A number with its unit, exactly as entered. Units are never converted. */
export function formatReading(value: number, unit: string | undefined): string {
  return unit ? `${value} ${unit}` : String(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
