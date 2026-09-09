import { describe, it, expect } from 'vitest';
import { reconcileActiveServer } from '../src/app/activeServer';

const servers = [{ id: 'a' }, { id: 'b' }];

describe('reconcileActiveServer', () => {
  it('keeps a selection that still exists', () => {
    expect(reconcileActiveServer('b', servers)).toBe('b');
  });

  it('replaces a stale selection (deleted server / fresh database)', () => {
    expect(reconcileActiveServer('gone', servers)).toBe('a');
  });

  it('selects the first server when nothing is selected yet', () => {
    expect(reconcileActiveServer(null, servers)).toBe('a');
  });

  it('clears the selection when there are no servers', () => {
    expect(reconcileActiveServer('a', [])).toBeNull();
  });
});
