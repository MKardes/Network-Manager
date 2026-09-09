import type { ReactNode } from 'react';

/**
 * Bordered content block used across Overview and Device detail. `meta` is the
 * right-aligned annotation next to the title; `intro` the explanatory paragraph
 * some panels carry above their rows.
 */
export function Panel({
  title,
  meta,
  intro,
  actions,
  className = '',
  children,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  intro?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={`panel ${className}`.trim()}>
      {(title || meta || actions) && (
        <div className="panel__head">
          {title && <h2 className="panel__title">{title}</h2>}
          {meta && <span className="panel__meta">{meta}</span>}
          {actions}
        </div>
      )}
      {intro && <p className="panel__body">{intro}</p>}
      {children}
    </section>
  );
}
