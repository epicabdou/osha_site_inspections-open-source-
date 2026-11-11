'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useId, useMemo, useState } from 'react';
import { isFailure } from '@/lib/answers/evaluate';
import type { ItemAnswer } from '@/lib/answers/reduce';
import { db, isQuotaExceeded, type LastUser, type LocalAnswerEvent } from '@/lib/db';
import { FieldActionError, recordAnswer } from '@/lib/field/actions';
import { formatDateTime, formatReading } from '@/lib/field/format';
import { addPhoto, removePhoto } from '@/lib/field/photos';
import { type AnswerValue, REJECT_REASON_TEXT, type TemplateItem } from '@/lib/schemas';
import { Button } from '@/components/ui/button';
import { SyncStateLabel } from './sync-badge';

type Props = {
  user: LastUser;
  inspectionId: string;
  item: TemplateItem;
  answer: ItemAnswer<LocalAnswerEvent> | undefined;
  editable: boolean;
};

/** Describes a value in words, with its unit. */
export function describeValue(item: TemplateItem, event: LocalAnswerEvent): string {
  const v = event.value;
  const photos = event.photoHashes.length
    ? ` + ${event.photoHashes.length} photo${event.photoHashes.length === 1 ? '' : 's'}`
    : '';
  switch (v.kind) {
    case 'pass_fail_na':
      return `${v.result === 'na' ? 'N/A' : v.result === 'pass' ? 'Pass' : 'Fail'}${photos}`;
    case 'number':
      return `${formatReading(v.value, item.unit)}${photos}`;
    case 'text':
      return `“${v.value}”${photos}`;
    case 'photo':
      return `${event.photoHashes.length} photo${event.photoHashes.length === 1 ? '' : 's'}`;
    case 'cleared':
      return 'Answer cleared';
  }
}

/**
 * One checklist item. Every tap records a new answer event on the device at once;
 * nothing waits for the network.
 */
export function ItemCard({ user, inspectionId, item, answer, editable }: Props) {
  const headingId = useId();
  const current = answer?.current;
  const latest = answer?.history.at(-1);
  const [error, setError] = useState<string | null>(null);
  const failing = isFailure(item, current?.value);

  async function save(value: AnswerValue, changes: { note?: string; photoHashes?: string[] } = {}) {
    setError(null);
    try {
      const clearing = value.kind === 'cleared';
      await recordAnswer(
        {
          inspectionId,
          itemId: item.id,
          value,
          note: clearing ? undefined : (changes.note ?? current?.note),
          photoHashes: clearing ? [] : (changes.photoHashes ?? current?.photoHashes ?? []),
        },
        user,
      );
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      await addPhoto({ inspectionId, itemId: item.id, file }, user);
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  return (
    <article
      aria-labelledby={headingId}
      className={`rounded-lg border-2 p-4 ${failing && item.critical ? 'border-danger' : 'border-border'}`}
      data-testid={`item-${item.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={headingId} className="text-lg font-semibold">
          {item.prompt}
        </h3>
        <div className="flex flex-wrap gap-2">
          {item.critical && (
            <span className="border-danger text-danger rounded border-2 px-2 py-0.5 text-xs font-bold uppercase">
              Critical
            </span>
          )}
          {answer?.conflicting && (
            <span
              className="rounded border-2 border-amber-600 px-2 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-400"
              data-testid="conflict-flag"
            >
              Conflicting answers
            </span>
          )}
        </div>
      </div>
      {item.guidance && <p className="text-muted mt-1 text-sm">{item.guidance}</p>}

      <div className="mt-3">
        {item.kind === 'pass_fail_na' && (
          <PassFailNa
            labelledBy={headingId}
            value={current?.value.kind === 'pass_fail_na' ? current.value.result : undefined}
            disabled={!editable}
            onChange={(result) => void save({ kind: 'pass_fail_na', result })}
          />
        )}
        {item.kind === 'number' && (
          <NumberInput
            key={current?.id ?? 'empty'}
            item={item}
            value={current?.value.kind === 'number' ? current.value.value : undefined}
            disabled={!editable}
            onSave={(value) => void save({ kind: 'number', value })}
          />
        )}
        {item.kind === 'text' && (
          <TextInput
            key={current?.id ?? 'empty'}
            label={item.prompt}
            value={current?.value.kind === 'text' ? current.value.value : ''}
            disabled={!editable}
            onSave={(value) =>
              void save(value.trim() ? { kind: 'text', value } : { kind: 'cleared' })
            }
          />
        )}
      </div>

      {(item.kind === 'photo' || (current && (failing || current.photoHashes.length > 0))) && (
        <PhotoSection
          item={item}
          hashes={current?.photoHashes ?? []}
          editable={editable && (item.kind === 'photo' || Boolean(current))}
          required={item.photoOnFail === true && failing}
          onAdd={(file) => void onPhoto(file)}
          onRemove={(hash) =>
            void removePhoto({ inspectionId, itemId: item.id, hash }, user).catch(
              (caught: unknown) => setError(errorText(caught)),
            )
          }
        />
      )}

      {current && item.kind !== 'text' && (
        <NoteInput
          key={current.id}
          required={item.photoOnFail === true && failing}
          value={current.note ?? ''}
          disabled={!editable}
          onSave={(note) => void save(current.value, { note })}
        />
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm" data-testid="answer-state">
          {latest ? (
            <>
              <SyncStateLabel state={latest.syncState} />
              <span className="text-muted"> · {formatDateTime(latest.deviceTime)}</span>
              {latest.syncState === 'rejected' && latest.rejectReason && (
                <span className="text-danger block font-semibold" data-testid="reject-reason">
                  {REJECT_REASON_TEXT[latest.rejectReason]}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted">Not answered</span>
          )}
        </div>
        {editable && current && (
          <button
            type="button"
            className="text-accent min-h-11 text-sm font-semibold underline"
            onClick={() => void save({ kind: 'cleared' })}
          >
            Clear answer
          </button>
        )}
      </div>

      {answer && answer.history.length > 1 && <History item={item} events={answer.history} />}

      {error && (
        <p role="alert" className="text-danger mt-2 font-semibold">
          {error}
        </p>
      )}
    </article>
  );
}

function errorText(caught: unknown): string {
  if (isQuotaExceeded(caught)) {
    return 'This device is out of storage. Free some space; nothing already saved is lost.';
  }
  if (caught instanceof FieldActionError) return caught.message;
  return 'Could not save that answer.';
}

function PassFailNa({
  labelledBy,
  value,
  disabled,
  onChange,
}: {
  labelledBy: string;
  value: 'pass' | 'fail' | 'na' | undefined;
  disabled: boolean;
  onChange: (value: 'pass' | 'fail' | 'na') => void;
}) {
  const options = [
    { value: 'pass', label: 'Pass', on: 'bg-ok border-ok text-white dark:text-black' },
    { value: 'fail', label: 'Fail', on: 'bg-danger border-danger text-white dark:text-black' },
    { value: 'na', label: 'N/A', on: 'bg-foreground border-foreground text-background' },
  ] as const;
  return (
    <div role="group" aria-labelledby={labelledBy} className="grid grid-cols-3 gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={`min-h-14 rounded-lg border-2 text-lg font-bold disabled:opacity-60 ${
            value === option.value ? option.on : 'border-border bg-background'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function NumberInput({
  item,
  value,
  disabled,
  onSave,
}: {
  item: TemplateItem;
  value: number | undefined;
  disabled: boolean;
  onSave: (value: number) => void;
}) {
  const id = useId();
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const [invalid, setInvalid] = useState(false);

  const range =
    item.min !== undefined && item.max !== undefined
      ? `Expected ${item.min}–${item.max} ${item.unit ?? ''}`
      : item.min !== undefined
        ? `Expected at least ${item.min} ${item.unit ?? ''}`
        : item.max !== undefined
          ? `Expected at most ${item.max} ${item.unit ?? ''}`
          : undefined;

  function commit() {
    const normalised = text.trim().replace(',', '.');
    if (!normalised) return;
    const parsed = Number(normalised);
    if (!Number.isFinite(parsed)) return setInvalid(true);
    setInvalid(false);
    if (parsed !== value) onSave(parsed);
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        Reading ({item.unit})
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          disabled={disabled}
          aria-describedby={range ? `${id}-range` : undefined}
          aria-invalid={invalid || undefined}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), commit())}
          className="border-border bg-background min-h-12 w-40 rounded-lg border-2 px-3 text-lg"
        />
        <span className="text-lg font-semibold">{item.unit}</span>
        <Button variant="secondary" disabled={disabled} onClick={commit}>
          Save
        </Button>
      </div>
      {range && (
        <p id={`${id}-range`} className="text-muted text-sm">
          {range.trim()}
        </p>
      )}
      {invalid && (
        <p role="alert" className="text-danger text-sm font-semibold">
          Enter a number.
        </p>
      )}
      {value !== undefined && isFailure(item, { kind: 'number', value }) && (
        <p className="text-danger text-sm font-semibold">
          Outside the expected range: counts as a fail.
        </p>
      )}
    </div>
  );
}

function TextInput({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const commit = () => text !== value && onSave(text);
  return (
    <div className="flex flex-col gap-2">
      <textarea
        aria-label={label}
        value={text}
        disabled={disabled}
        rows={3}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        className="border-border bg-background rounded-lg border-2 p-3 text-base"
      />
      <Button
        variant="secondary"
        className="self-start"
        disabled={disabled || text === value}
        onClick={commit}
      >
        Save
      </Button>
    </div>
  );
}

function NoteInput({
  required,
  value,
  disabled,
  onSave,
}: {
  required: boolean;
  value: string;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(Boolean(value));
  const [text, setText] = useState(value);
  const open = expanded || required;

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setExpanded(true)}
        className="text-accent mt-2 min-h-11 text-sm font-semibold underline"
      >
        Add a note
      </button>
    );
  }
  const commit = () => text.trim() !== value && onSave(text.trim());
  return (
    <div className="mt-3 flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        Note{required ? ' (required for a fail)' : ''}
      </label>
      <textarea
        id={id}
        value={text}
        rows={2}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        className="border-border bg-background rounded-lg border-2 p-3"
      />
    </div>
  );
}

function PhotoSection({
  item,
  hashes,
  editable,
  required,
  onAdd,
  onRemove,
}: {
  item: TemplateItem;
  hashes: string[];
  editable: boolean;
  required: boolean;
  onAdd: (file: File | undefined) => void;
  onRemove: (hash: string) => void;
}) {
  const cameraId = useId();
  const libraryId = useId();
  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="text-sm font-semibold">
        Photos{required ? ' (at least one required for a fail)' : ''}
      </p>
      {hashes.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {hashes.map((hash) => (
            <li key={hash}>
              <PhotoThumb hash={hash} alt={`Photo for ${item.prompt}`} />
              {editable && (
                <button
                  type="button"
                  onClick={() => onRemove(hash)}
                  className="text-accent block min-h-11 text-sm underline"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="flex flex-wrap gap-2">
          <label
            htmlFor={cameraId}
            className="bg-accent text-accent-foreground inline-flex min-h-12 cursor-pointer items-center rounded-lg px-4 font-semibold"
          >
            Take photo
          </label>
          <input
            id={cameraId}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(event) => {
              onAdd(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <label
            htmlFor={libraryId}
            className="border-border inline-flex min-h-12 cursor-pointer items-center rounded-lg border-2 px-4 font-semibold"
          >
            Choose from library
          </label>
          <input
            id={libraryId}
            type="file"
            accept="image/*"
            className="sr-only"
            data-testid={`photo-input-${item.id}`}
            onChange={(event) => {
              onAdd(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
      )}
    </div>
  );
}

function PhotoThumb({ hash, alt }: { hash: string; alt: string }) {
  const photo = useLiveQuery(() => db.photos.get(hash), [hash]);
  const url = useMemo(
    () => (photo ? URL.createObjectURL(new Blob([photo.data], { type: photo.mime })) : null),
    [photo],
  );
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return (
    <figure className="flex w-24 flex-col gap-1">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local blob URL; next/image cannot optimise it
        <img src={url} alt={alt} className="border-border size-24 rounded border-2 object-cover" />
      ) : (
        <div className="bg-surface border-border flex size-24 items-center justify-center rounded border-2 text-center text-xs">
          {photo === undefined ? 'Loading' : 'Not on this device'}
        </div>
      )}
      <figcaption className="text-muted text-xs">
        {photo?.uploadState === 'uploaded' ? 'Uploaded' : photo ? 'Waiting to upload' : ''}
      </figcaption>
    </figure>
  );
}

function History({ item, events }: { item: TemplateItem; events: LocalAnswerEvent[] }) {
  return (
    <details className="mt-2">
      <summary className="text-accent min-h-11 cursor-pointer py-2 text-sm font-semibold">
        History ({events.length} entries)
      </summary>
      <ol className="mt-1 flex flex-col gap-1 text-sm">
        {events.map((event) => (
          <li key={event.id} className="border-border border-l-4 pl-2">
            <span className="font-semibold">{describeValue(item, event)}</span>
            {event.note ? <span> — {event.note}</span> : null}
            <span className="text-muted block">
              {formatDateTime(event.deviceTime)} · device {event.deviceId.slice(-6)} ·{' '}
              <SyncStateLabel state={event.syncState} />
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
