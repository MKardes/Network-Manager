/**
 * The one nav definition both shells render. `end` marks routes that should
 * only match exactly (Overview lives at "/", which prefixes everything else).
 */
export interface NavEntry {
  to: string;
  label: string;
  end?: boolean;
  /** Which counter, if any, sits to the right of the label. */
  count?: 'devices';
}

export const NAV: NavEntry[] = [
  { to: '/', label: 'Overview', end: true },
  { to: '/devices', label: 'Devices', count: 'devices' },
  { to: '/servers', label: 'Servers' },
  { to: '/ssh-targets', label: 'SSH targets' },
  { to: '/audit', label: 'Audit' },
  { to: '/settings', label: 'Settings' },
];
