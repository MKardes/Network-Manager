/**
 * Minimal IPv4 CIDR helpers for address allocation and overlap detection (FR-007).
 * (IPv6 tunnel ranges are accepted as opaque strings; allocation targets IPv4.)
 */

export interface Cidr {
  base: number; // network address as uint32
  prefix: number;
}

function ipToInt(ip: string): number {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    throw new Error(`Invalid IPv4 address: ${ip}`);
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
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

/** The server's own address is host .1 in the range. */
export function serverAddress(range: string): string {
  const c = parseCidr(range);
  return `${intToIp((c.base + 1) >>> 0)}/${c.prefix}`;
}

/**
 * Allocate the next free host address in `range`, skipping the network address,
 * the server (.1), the broadcast address, and any already-used addresses.
 */
export function allocateAddress(range: string, used: string[]): string {
  const c = parseCidr(range);
  const { first, last } = cidrRange(c);
  const usedInts = new Set(used.map((u) => ipToInt(u.split('/')[0])));
  const serverInt = (c.base + 1) >>> 0;
  for (let candidate = first + 2; candidate < last; candidate++) {
    if (candidate === serverInt) continue;
    if (!usedInts.has(candidate >>> 0)) {
      return intToIp(candidate >>> 0);
    }
  }
  throw new Error(`No free addresses in range ${range}`);
}

/** Validate that an address falls within the range. */
export function addressInRange(address: string, range: string): boolean {
  const c = parseCidr(range);
  const { first, last } = cidrRange(c);
  const a = ipToInt(address.split('/')[0]);
  return a >= first && a <= last;
}
