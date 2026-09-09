import { describe, it, expect } from 'vitest';
import { matchesQuery, passesFilter, visible } from '../src/lib/deviceFilter';
import type { DeviceRow } from '../src/lib/useServerData';

function device(over: Partial<DeviceRow> = {}): DeviceRow {
  return {
    id: 'd1',
    serverId: 's1',
    name: 'workshop-pi',
    kind: 'peer',
    segmentId: null,
    isWakeController: false,
    macAddress: 'AA:BB:CC:DD:EE:FF',
    tunnelAddress: '10.0.0.12',
    peerPublicKey: 'kQ3f8Zt=',
    sshTargetId: null,
    reachability: 'connected',
    lastSeenAt: null,
    origin: 'created',
    managementState: 'managed',
    allowedIps: '10.0.0.12/32',
    segmentName: 'Office LAN',
    isController: false,
    controllerName: null,
    ...over,
  };
}

describe('matchesQuery', () => {
  it('matches on name, address and MAC, case-insensitively', () => {
    const d = device();
    expect(matchesQuery(d, 'workshop')).toBe(true);
    expect(matchesQuery(d, '10.0.0.12')).toBe(true);
    expect(matchesQuery(d, 'aa:bb')).toBe(true);
    expect(matchesQuery(d, 'warehouse')).toBe(false);
  });

  it('treats an empty query as "everything"', () => {
    expect(matchesQuery(device(), '')).toBe(true);
  });

  it('tolerates devices with no address or MAC', () => {
    const d = device({ tunnelAddress: null, macAddress: null, allowedIps: null });
    expect(matchesQuery(d, 'workshop')).toBe(true);
    expect(matchesQuery(d, '10.0.0')).toBe(false);
  });
});

describe('passesFilter', () => {
  it('keeps everything under "all"', () => {
    expect(passesFilter(device({ managementState: 'needs_review' }), 'all')).toBe(true);
  });

  it('counts unknown reachability as offline', () => {
    expect(passesFilter(device({ reachability: 'unknown' }), 'offline')).toBe(true);
    expect(passesFilter(device({ reachability: 'offline' }), 'offline')).toBe(true);
    expect(passesFilter(device({ reachability: 'connected' }), 'offline')).toBe(false);
  });

  it('separates imported peers from the connected/offline buckets', () => {
    const imported = device({ managementState: 'needs_review', reachability: 'connected' });
    expect(passesFilter(imported, 'review')).toBe(true);
    expect(passesFilter(imported, 'connected')).toBe(false);
    expect(passesFilter(imported, 'offline')).toBe(false);
  });
});

describe('visible', () => {
  it('requires both the filter and the query to pass', () => {
    const d = device({ reachability: 'offline' });
    expect(visible(d, 'offline', 'workshop')).toBe(true);
    expect(visible(d, 'connected', 'workshop')).toBe(false);
    expect(visible(d, 'offline', 'warehouse')).toBe(false);
  });
});
