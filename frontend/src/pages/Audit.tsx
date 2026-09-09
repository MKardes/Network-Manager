import { useEffect, useState, useCallback } from 'react';
import { api, ApiError, type AuditEvent } from '../api/client';
import { Tag } from '../components/ui/Tag';

/** Audit viewer: filter by action and paginate (FR-020, T059). */
export function Audit() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = 50;

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (action) q.set('action', action);
      const res = await api.get<{ total: number; events: AuditEvent[] }>(`/audit?${q}`);
      setEvents(res.events);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load audit log.');
    } finally {
      setLoading(false);
    }
  }, [action, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="kicker">History</div>
          <h1 className="h1">Audit log</h1>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="toolbar__search"
          value={action}
          onChange={(e) => {
            setOffset(0);
            setAction(e.target.value);
          }}
          placeholder="Filter by action, e.g. login or server_create"
          aria-label="Filter by action"
        />
        <span className="muted" style={{ fontSize: 12 }}>
          {total} events
        </span>
      </div>

      {error && <div className="error">{error}</div>}
      {loading && <div className="loading">Loading…</div>}

      <div className="table-scroll">
        <table className="table table--edge">
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
                <td className="cell-access">{e.occurred_at}</td>
                <td className="muted">{e.actor}</td>
                <td className="cell-mono">{e.action}</td>
                <td className="cell-access">
                  {e.target_type ? `${e.target_type}:${e.target_id?.slice(0, 8)}` : '—'}
                </td>
                <td>
                  <Tag state={e.outcome === 'success' ? 'connected' : 'offline'}>{e.outcome}</Tag>
                </td>
                <td className="muted">{e.detail ?? ''}</td>
              </tr>
            ))}
            {events.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="empty">
                  No events match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <button
          type="button"
          className="btn-outline"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - limit))}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn-outline"
          disabled={offset + limit >= total}
          onClick={() => setOffset(offset + limit)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
