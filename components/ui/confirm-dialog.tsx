'use client';

import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { Button } from './button';

/** An accessible confirmation dialog (Radix): focus trap, Escape to close, labelled. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  confirmVariant = 'danger',
  onConfirm,
  busy = false,
  extraAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  confirmVariant?: 'danger' | 'primary';
  onConfirm: () => void;
  busy?: boolean;
  extraAction?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="bg-background text-foreground border-border fixed inset-x-4 bottom-4 z-50 mx-auto max-w-lg rounded-xl border-2 p-5 shadow-xl sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2">
          <Dialog.Title className="text-xl font-bold">{title}</Dialog.Title>
          <Dialog.Description asChild>
            <div className="text-muted mt-2 space-y-2">{children}</div>
          </Dialog.Description>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row-reverse">
            <Button variant={confirmVariant} onClick={onConfirm} disabled={busy}>
              {confirmLabel}
            </Button>
            {extraAction}
            <Dialog.Close asChild>
              <Button variant="secondary">Cancel</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
