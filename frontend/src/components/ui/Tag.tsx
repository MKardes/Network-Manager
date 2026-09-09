import type { ReactNode } from 'react';

/**
 * The four states the whole app speaks in: a device/server that is up, one that
 * is down, one we have never heard from, and an imported peer awaiting adoption.
 * Styling hangs off the `data-state` attribute (see styles.css).
 */
export type TagState = 'connected' | 'offline' | 'unknown' | 'review';

const LABELS: Record<TagState, string> = {
  connected: 'connected',
  offline: 'offline',
  unknown: 'unknown',
  review: 'needs review',
};

export function Tag({
  state,
  children,
  className,
}: {
  state: TagState;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span data-state={state} className={className}>
      {children ?? LABELS[state]}
    </span>
  );
}

/** Map a device's reachability + management state onto a tag state. */
export function deviceState(device: {
  reachability: 'connected' | 'offline' | 'unknown';
  managementState: 'managed' | 'needs_review';
}): TagState {
  if (device.managementState === 'needs_review') return 'review';
  return device.reachability;
}
