/**
 * Minimal IPv4 CIDR helpers for address allocation and overlap detection (FR-007).
 * (IPv6 tunnel ranges are accepted as opaque strings; allocation targets IPv4.)
 */

export interface Cidr {
  base: number; // network address as uint32
  prefix: number;
}

/** Parse a dotted-quad to a uint32, or null when it is not a valid IPv4 host. */
function ipToIntSafe(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number.parseInt(p, 10));
  if (nums.some((n, i) => Number.isNaN(n) || n < 0 || n > 255 || String(n) !== parts[i].trim())) {
    return null;
  }
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

/** True when `ip` is a syntactically valid dotted-quad IPv4 host address. */
export function isIpv4(ip: string): boolean {
  return ipToIntSafe(ip) !== null;
}

function ipToInt(ip: string): number {
  const n = ipToIntSafe(ip);
  if (n === null) throw new Error(`Invalid IPv4 address: ${ip}`);
  return n;
}

function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function parseCidr(cidr: string): Cidr {
  const [ip, prefixStr] = cidr.split('/');
  const prefix = Number.parseInt(prefixStr, 10);
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid CIDR prefix: ${cidr}`);
  }
  const ipInt = ipToInt(ip);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { base: (ipInt & mask) >>> 0, prefix };
}

export function cidrRange(cidr: Cidr): { first: number; last: number } {
  const size = 2 ** (32 - cidr.prefix);
  return { first: cidr.base, last: (cidr.base + size - 1) >>> 0 };
}

/** True if two CIDRs overlap at all. */
export function cidrsOverlap(a: string, b: string): boolean {
  const ra = cidrRange(parseCidr(a));
  const rb = cidrRange(parseCidr(b));
  return ra.first <= rb.last && rb.first <= ra.last;
}

/**
 * Normalize a range to its network CIDR (e.g. `10.0.0.1/24` -> `10.0.0.0/24`).
 * Used as the split-tunnel route pushed to clients, so only tunnel traffic is
 * routed over WireGuard.
 */
export function networkCidr(range: string): string {
  const c = parseCidr(range);
  return `${intToIp(c.base)}/${c.prefix}`;
}

/** The server's own address is host .1 in the range. */
export function serverAddress(range: string): string {
  const c = parseCidr(range);
  return `${intToIp((c.base + 1) >>> 0)}/${c.prefix}`;
}

/**
 * Parse "used" entries into IPv4 ranges. Each entry is a CIDR (e.g. 10.0.5.0/24)
 * or a bare host (treated as /32). Non-IPv4 / malformed entries are skipped so a
 * peer advertising IPv6 AllowedIPs doesn't break allocation.
 */
function usedRanges(used: string[]): { first: number; last: number }[] {
  const ranges: { first: number; last: number }[] = [];
  for (const entry of used) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [ip, prefixStr] = trimmed.split('/');
    if (ipToIntSafe(ip) === null) continue; // skip IPv6/garbage
    try {
      const cidr = parseCidr(prefixStr === undefined ? `${ip}/32` : trimmed);
      ranges.push(cidrRange(cidr));
    } catch {
      // ignore unparseable entry
    }
  }
  return ranges;
}

/** True if `address` (bare host or with mask) is covered by any used range. */
export function addressCovered(address: string, used: string[]): boolean {
  const a = ipToIntSafe(address.split('/')[0]);
  if (a === null) return false;
  return usedRanges(used).some((r) => a >= r.first && a <= r.last);
}

/**
 * Allocate the next free host address in `range`, skipping the network address,
 * the server (.1), the broadcast address, and any address covered by `used`
 * (bare hosts as /32 and full CIDR ranges alike).
 */
export function allocateAddress(range: string, used: string[]): string {
  const c = parseCidr(range);
  const { first, last } = cidrRange(c);
  const ranges = usedRanges(used);
  const serverInt = (c.base + 1) >>> 0;
  const covered = (n: number) => ranges.some((r) => n >= r.first && n <= r.last);
  for (let candidate = first + 2; candidate < last; candidate++) {
    if (candidate === serverInt) continue;
    if (!covered(candidate >>> 0)) {
      return intToIp(candidate >>> 0);
    }
  }
  throw new Error(`No free addresses in range ${range}`);
}

/** Validate that an address falls within the range (inclusive of network/broadcast). */
export function addressInRange(address: string, range: string): boolean {
  const c = parseCidr(range);
  const { first, last } = cidrRange(c);
  const a = ipToIntSafe(address.split('/')[0]);
  if (a === null) return false;
  return a >= first && a <= last;
}

/** True if the address is NOT within the server's configured range (FR-009a). */
export function addressOutOfRange(address: string, range: string): boolean {
  return !addressInRange(address, range);
}

export type AddressRejection = 'malformed' | 'out_of_range' | 'reserved' | 'in_use';

export interface AddressCheck {
  ok: boolean;
  reason?: AddressRejection;
}

/**
 * Validate an operator-supplied tunnel address for a new client (FR-008). Pure:
 * returns a discriminated result; the caller maps the reason to an API error.
 * Accepts a bare host or a "/32"; anything else is malformed.
 */
export function validateAssignableAddress(
  range: string,
  address: string,
  used: string[],
): AddressCheck {
  const [ip, prefix] = address.trim().split('/');
  const a = ipToIntSafe(ip);
  if (a === null || (prefix !== undefined && prefix !== '32')) {
    return { ok: false, reason: 'malformed' };
  }
  const c = parseCidr(range);
  const { first, last } = cidrRange(c);
  if (a < first || a > last) return { ok: false, reason: 'out_of_range' };
  const serverInt = (c.base + 1) >>> 0;
  if (a === first || a === last || a === serverInt) return { ok: false, reason: 'reserved' };
  if (addressCovered(ip, used)) return { ok: false, reason: 'in_use' };
  return { ok: true };
}
