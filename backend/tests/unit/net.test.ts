import { describe, it, expect } from 'vitest';
import {
  parseCidr,
  cidrsOverlap,
  serverAddress,
  networkCidr,
  allocateAddress,
  addressInRange,
  addressCovered,
  addressOutOfRange,
  validateAssignableAddress,
} from '../../src/servers/net.js';

describe('CIDR utilities', () => {
  it('parses a CIDR to its network base', () => {
    const c = parseCidr('10.0.0.5/24');
    expect(c.prefix).toBe(24);
    // base should be 10.0.0.0
    expect(c.base >>> 0).toBe(((10 << 24) | 0) >>> 0);
  });

  it('normalizes a range to its network CIDR', () => {
    expect(networkCidr('10.0.0.0/24')).toBe('10.0.0.0/24');
    expect(networkCidr('10.0.0.1/24')).toBe('10.0.0.0/24');
    expect(networkCidr('192.168.7.130/25')).toBe('192.168.7.128/25');
  });

  it('detects overlapping ranges', () => {
    expect(cidrsOverlap('10.0.0.0/24', '10.0.0.128/25')).toBe(true);
    expect(cidrsOverlap('10.0.0.0/24', '10.0.1.0/24')).toBe(false);
    expect(cidrsOverlap('10.0.0.0/8', '10.5.5.0/24')).toBe(true);
  });

  it('computes the server address as .1', () => {
    expect(serverAddress('10.0.0.0/24')).toBe('10.0.0.1/24');
  });

  it('allocates the next free host, skipping network/.1/used', () => {
    const first = allocateAddress('10.0.0.0/24', []);
    expect(first).toBe('10.0.0.2');
    const second = allocateAddress('10.0.0.0/24', ['10.0.0.2']);
    expect(second).toBe('10.0.0.3');
  });

  it('throws when the range is exhausted', () => {
    // /30 has hosts .1 (server) .2 .3(broadcast excluded); only .2 allocatable
    expect(allocateAddress('10.0.0.0/30', [])).toBe('10.0.0.2');
    expect(() => allocateAddress('10.0.0.0/30', ['10.0.0.2'])).toThrow();
  });

  it('validates address membership', () => {
    expect(addressInRange('10.0.0.42', '10.0.0.0/24')).toBe(true);
    expect(addressInRange('10.0.1.1', '10.0.0.0/24')).toBe(false);
    expect(addressOutOfRange('10.0.1.1', '10.0.0.0/24')).toBe(true);
  });
});

describe('subnet-aware address usage (feature 002)', () => {
  it('treats a used subnet as fully covered', () => {
    expect(addressCovered('10.0.0.40', ['10.0.0.32/27'])).toBe(true); // .32-.63
    expect(addressCovered('10.0.0.64', ['10.0.0.32/27'])).toBe(false);
    expect(addressCovered('10.0.0.5', ['10.0.0.5'])).toBe(true); // bare host = /32
  });

  it('ignores non-IPv4 used entries', () => {
    expect(addressCovered('10.0.0.5', ['fd00::/64', '10.0.0.6/32'])).toBe(false);
  });

  it('allocateAddress skips a subnet-covered range', () => {
    // .2 and .3 are inside the used /29 (.0-.7); next free is .8
    expect(allocateAddress('10.0.0.0/24', ['10.0.0.0/29'])).toBe('10.0.0.8');
  });

  it('validateAssignableAddress distinguishes rejection reasons', () => {
    const range = '10.0.0.0/24';
    expect(validateAssignableAddress(range, '10.0.0.50', []).ok).toBe(true);
    expect(validateAssignableAddress(range, 'not-an-ip', []).reason).toBe('malformed');
    expect(validateAssignableAddress(range, '10.0.0.50/24', []).reason).toBe('malformed');
    expect(validateAssignableAddress(range, '10.0.9.9', []).reason).toBe('out_of_range');
    expect(validateAssignableAddress(range, '10.0.0.1', []).reason).toBe('reserved'); // server .1
    expect(validateAssignableAddress(range, '10.0.0.0', []).reason).toBe('reserved'); // network
    expect(validateAssignableAddress(range, '10.0.0.255', []).reason).toBe('reserved'); // broadcast
    expect(validateAssignableAddress(range, '10.0.0.40', ['10.0.0.32/27']).reason).toBe('in_use');
  });
});
