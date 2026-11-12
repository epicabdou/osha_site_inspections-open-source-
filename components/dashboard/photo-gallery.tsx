'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';

/**
 * Thumbnails that open in an accessible lightbox. A photo the device has not uploaded yet
 * shows a placeholder instead: the answer that references it synced first, by design.
 */
export function PhotoGallery({
  photos,
  label,
}: {
  photos: { hash: string; uploaded: boolean }[];
  label: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (photos.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label={`Photos for ${label}`}>
      {photos.map((photo, index) =>
        photo.uploaded ? (
          <li key={photo.hash}>
            <button
              type="button"
              onClick={() => setOpen(photo.hash)}
              className="border-border block rounded border-2"
              aria-label={`Open photo ${index + 1} for ${label}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- streamed from the authenticated photo route */}
              <img
                src={`/api/photos/${photo.hash}`}
                alt=""
                className="size-24 object-cover"
                loading="lazy"
              />
            </button>
          </li>
        ) : (
          <li
            key={photo.hash}
            className="border-border bg-surface flex size-24 items-center justify-center rounded border-2 border-dashed p-1 text-center text-xs"
            data-testid="photo-pending"
          >
            Photo pending upload from device
          </li>
        ),
      )}
      <Dialog.Root open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/80" />
          <Dialog.Content className="fixed inset-4 z-50 flex flex-col items-center justify-center gap-3">
            <Dialog.Title className="sr-only">Photo for {label}</Dialog.Title>
            <Dialog.Description className="sr-only">
              Full-size photo. Press Escape to close.
            </Dialog.Description>
            {open && (
              // eslint-disable-next-line @next/next/no-img-element -- streamed from the authenticated photo route
              <img
                src={`/api/photos/${open}`}
                alt={`Photo for ${label}`}
                className="max-h-[85vh] max-w-full rounded"
              />
            )}
            <Dialog.Close className="min-h-12 rounded-lg bg-white px-5 font-semibold text-black">
              Close
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ul>
  );
}
