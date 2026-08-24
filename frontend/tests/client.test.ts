import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, ApiError } from '../src/api/client';

/** API client: error mapping + JSON handling. */
describe('api client', () => {
  afterEach(() => vi.restoreAllMocks());

  it('parses JSON responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ hello: 'world' })),
      }),
    );
    expect(await api.get<{ hello: string }>('/x')).toEqual({ hello: 'world' });
  });

  it('maps the backend error shape to ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 423,
        ok: false,
        statusText: 'Locked',
        text: () => Promise.resolve(JSON.stringify({ error: { code: 'vault_locked', message: 'Locked' } })),
      }),
    );
    await expect(api.get('/x')).rejects.toMatchObject({ code: 'vault_locked', status: 423 });
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);
  });

  it('treats 204 as empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204, ok: true, text: () => Promise.resolve('') }));
    expect(await api.del('/x')).toBeUndefined();
  });
});
