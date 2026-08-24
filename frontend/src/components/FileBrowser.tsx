import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '../api/client';

interface Entry {
  name: string;
  size: number;
  mode: number;
  modified: number;
  isDir: boolean;
}

/**
 * SFTP file browser (FR-010): list a directory, upload, and download. Errors
 * (including partial/failed transfers) are surfaced, never shown as success
 * (US3 scenario 4).
 */
export function FileBrowser({ deviceId }: { deviceId: string }) {
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useCallback(
    async (dir: string) => {
      setError(null);
      try {
        const res = await api.get<{ path: string; entries: Entry[] }>(
          `/sftp/${deviceId}?path=${encodeURIComponent(dir)}`,
        );
        setEntries(res.entries.sort((a, b) => Number(b.isDir) - Number(a.isDir)));
        setPath(dir);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to list directory.');
      }
    },
    [deviceId],
  );

  useEffect(() => {
    void list('/');
  }, [list]);

  const join = (dir: string, name: string) => (dir.endsWith('/') ? dir + name : `${dir}/${name}`);

  const open = (e: Entry) => {
    if (e.isDir) void list(join(path, e.name));
  };

  const download = async (name: string) => {
    setError(null);
    try {
      const blob = await api.download(`/sftp/${deviceId}/download?path=${encodeURIComponent(join(path, name))}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Download failed.');
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(
        `/api/v1/sftp/${deviceId}/upload?path=${encodeURIComponent(join(path, file.name))}`,
        { method: 'POST', body: fd, credentials: 'same-origin' },
      );
      if (!res.ok) throw new Error('Upload failed');
      await list(path);
    } catch {
      setError('Upload failed (the file was not transferred completely).');
    } finally {
      setBusy(false);
    }
  };

  const parent = () => {
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    void list('/' + parts.join('/'));
  };

  return (
    <div className="file-browser">
      <div className="path-bar">
        <button onClick={parent} disabled={path === '/'}>
          ↑ Up
        </button>
        <code>{path}</code>
        <label className="upload">
          Upload…
          <input
            type="file"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </label>
      </div>
      {error && <div className="error">{error}</div>}
      <table className="grid">
        <thead>
          <tr>
            <th>Name</th>
            <th>Size</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.name}>
              <td className={e.isDir ? 'dir' : ''} onClick={() => open(e)} role="button">
                {e.isDir ? '📁 ' : '📄 '}
                {e.name}
              </td>
              <td>{e.isDir ? '—' : e.size}</td>
              <td>{!e.isDir && <button onClick={() => download(e.name)}>Download</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
