/** Small presentation helpers shared by the list and detail surfaces. */

/** "3 min ago" / "2 days ago" — coarse on purpose, the UI never shows seconds. */
export function relativeTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return 'never';
  const ms = typeof value === 'number' ? value * 1000 : Date.parse(value);
  if (!Number.isFinite(ms)) return 'never';
  const diff = Date.now() - ms;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Clock time for audit rows — the date is implied by "recent". */
export function shortTime(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Keys are 44 characters of base64 that never wrap usefully — show both ends so
 * the value stays identifiable without dominating the spec table.
 */
export function truncateMiddle(value: string | null, head = 4, tail = 4): string {
  if (!value) return '—';
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** What a device can be reached with, as shown in the list's Access column. */
export function accessSummary(device: {
  sshTargetId: string | null;
  macAddress: string | null;
}): string {
  if (device.sshTargetId) return 'ssh · terminal · files';
  if (device.macAddress) return 'wake-on-lan';
  return '—';
}
