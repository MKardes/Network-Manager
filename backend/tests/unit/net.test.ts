import { describe, it, expect } from 'vitest';
import {
  parseCidr,
  cidrsOverlap,
  serverAddress,
  allocateAddress,
  addressInRange,
} from '../../src/servers/net.js';

describe('CIDR utilities', () => {
  it('parses a CIDR to its network base', () => {
    const c = parseCidr('10.0.0.5/24');
    expect(c.prefix).toBe(24);
    // base should be 10.0.0.0
    expect(c.base >>> 0).toBe(((10 << 24) | 0) >>> 0);
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
  });
});
