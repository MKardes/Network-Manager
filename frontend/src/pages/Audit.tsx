import { useEffect, useState, useCallback } from 'react';
import { api, ApiError, type AuditEvent } from '../api/client';

/** Audit viewer: filter by action and paginate (FR-020, T059). */
export function Audit() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const limit = 50;

  const load = useCallback(async () => {
    setError(null);
    try {
      const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (action) q.set('action', action);
      const res = await api.get<{ total: number; events: AuditEvent[] }>(`/audit?${q}`);
      setEvents(res.events);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load audit log.');
    }
  }, [action, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h1>Audit log</h1>
      {error && <div className="error">{error}</div>}
      <div className="filters">
        <label>
          Action
          <input
            value={action}
            onChange={(e) => {
              setOffset(0);
              setAction(e.target.value);
            }}
            placeholder="e.g. login, server_create"
          />
        </label>
        <span className="muted">{total} events</span>
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th>Time</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
            <th>Outcome</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{e.occurred_at}</td>
              <td>{e.actor}</td>
              <td>{e.action}</td>
              <td>{e.target_type ? `${e.target_type}:${e.target_id?.slice(0, 8)}` : '—'}</td>
              <td>
                <span className={`badge ${e.outcome === 'success' ? 'up' : 'down'}`}>{e.outcome}</span>
              </td>
              <td>{e.detail ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pager">
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
          Previous
        </button>
        <button disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
          Next
        </button>
      </div>
    </div>
  );
}
