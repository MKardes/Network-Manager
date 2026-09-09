import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * 34×32 icon button. Every instance carries `label` (the accessible name) and
 * `hint` (why it does or doesn't work) — together they form the tooltip
 * "Label — explanation", so a disabled button always explains itself.
 */
export function IconButton({
  icon: Icon,
  label,
  hint,
  variant = 'outline',
  disabled,
  onClick,
  className = '',
  children,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  variant?: 'outline' | 'primary' | 'accent' | 'danger';
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const tip = `${label} — ${hint}`;
  const variantClass = variant === 'outline' ? '' : `icon-btn--${variant}`;
  return (
    <button
      type="button"
      className={`icon-btn ${variantClass} ${children ? 'icon-btn--labelled' : ''} ${className}`.trim()}
      title={tip}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={14} strokeWidth={1.5} aria-hidden />
      {children}
    </button>
  );
}
