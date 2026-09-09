import type { DeviceRow } from './useServerData';

export type Filter = 'all' | 'connected' | 'offline' | 'review';

export const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'connected', label: 'Connected' },
  { value: 'offline', label: 'Offline' },
  { value: 'review', label: 'Needs review' },
];

/** Substring match over name, tunnel address, allowed IPs and MAC. */
export function matchesQuery(d: DeviceRow, query: string): boolean {
  if (!query) return true;
  const hay = `${d.name} ${d.tunnelAddress ?? ''} ${d.allowedIps ?? ''} ${d.macAddress ?? ''}`;
  return hay.toLowerCase().includes(query);
}

export function passesFilter(d: DeviceRow, filter: Filter): boolean {
  switch (filter) {
    case 'connected':
      return d.reachability === 'connected' && d.managementState === 'managed';
    // "Offline" covers everything not currently up, including never-seen devices.
    case 'offline':
      return d.reachability !== 'connected' && d.managementState === 'managed';
    case 'review':
      return d.managementState === 'needs_review';
    default:
      return true;
  }
}

export function visible(d: DeviceRow, filter: Filter, query: string): boolean {
  return passesFilter(d, filter) && matchesQuery(d, query);
}
