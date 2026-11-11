import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-foreground border-2 border-accent',
  secondary: 'bg-surface text-foreground border-2 border-border',
  danger: 'bg-danger text-white border-2 border-danger',
  ghost: 'bg-transparent text-accent border-2 border-transparent underline',
};

/** Class names for a button-styled element: at least 48 px tall for gloved hands. */
export function buttonClass(variant: Variant = 'primary', extra = ''): string {
  return [
    'inline-flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-lg px-4 text-base font-semibold',
    'disabled:cursor-not-allowed disabled:opacity-50',
    VARIANTS[variant],
    extra,
  ].join(' ');
}

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}
