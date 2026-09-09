import { describe, it, expect, vi, afterEach } from 'vitest';
import { accessSummary, relativeTime, truncateMiddle } from '../src/lib/format';

afterEach(() => vi.useRealTimers());

describe('relativeTime', () => {
  it('reports "never" for a device that has never been seen', () => {
    expect(relativeTime(null)).toBe('never');
    expect(relativeTime(undefined)).toBe('never');
    expect(relativeTime('not a date')).toBe('never');
  });

  it('coarsens to minutes, hours and days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T12:00:00Z'));
    expect(relativeTime('2026-01-02T11:58:00Z')).toBe('2 min ago');
    expect(relativeTime('2026-01-02T09:00:00Z')).toBe('3 h ago');
    expect(relativeTime('2025-12-31T12:00:00Z')).toBe('2 days ago');
    expect(relativeTime('2026-01-01T12:00:00Z')).toBe('1 day ago');
  });

  it('accepts wg-style unix seconds as well as ISO strings', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T12:00:00Z'));
    const tenMinutesAgo = Math.floor(Date.parse('2026-01-02T11:50:00Z') / 1000);
    expect(relativeTime(tenMinutesAgo)).toBe('10 min ago');
  });
});

describe('truncateMiddle', () => {
  it('keeps both ends of a public key', () => {
    expect(truncateMiddle('kQ3fAAAAAAAAAAAAAAAA8Zt=')).toBe('kQ3f…8Zt=');
  });

  it('leaves short values and nulls alone', () => {
    expect(truncateMiddle('abc')).toBe('abc');
    expect(truncateMiddle(null)).toBe('—');
  });
});

describe('accessSummary', () => {
  it('prefers SSH, falls back to wake-on-LAN, then nothing', () => {
    expect(accessSummary({ sshTargetId: 't1', macAddress: 'AA' })).toBe('ssh · terminal · files');
    expect(accessSummary({ sshTargetId: null, macAddress: 'AA' })).toBe('wake-on-lan');
    expect(accessSummary({ sshTargetId: null, macAddress: null })).toBe('—');
  });
});
