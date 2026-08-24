import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { api } from '../api/client';
import '@xterm/xterm/css/xterm.css';

/**
 * xterm.js terminal bridged to the backend SSH WebSocket (FR-009). Host-key
 * mismatch / auth failures arrive as `error` messages and are shown inline
 * before the socket closes (FR-011/012).
 */
export function TerminalView({ deviceId }: { deviceId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string>('connecting…');

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({ convertEol: true, fontSize: 13, cursorBlink: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    const ws = api.ws(`/ws/ssh/${deviceId}`);

    ws.onopen = () => setStatus('connected');
    ws.onmessage = (ev) => {
      let msg: { type: string; data?: string; code?: string; message?: string; reason?: string };
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'ready':
          setStatus('ready');
          break;
        case 'output':
          if (msg.data) term.write(msg.data);
          break;
        case 'error':
          setStatus(`error: ${msg.message ?? msg.code}`);
          term.write(`\r\n\x1b[31m[${msg.code}] ${msg.message}\x1b[0m\r\n`);
          break;
        case 'closed':
          setStatus(`closed (${msg.reason})`);
          break;
      }
    };
    ws.onclose = (ev) => setStatus((s) => (s.startsWith('error') ? s : `disconnected (${ev.code})`));

    const onData = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
    });
    const onResize = () => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      onData.dispose();
      ws.close();
      term.dispose();
    };
  }, [deviceId]);

  return (
    <div className="terminal-wrap">
      <div className="terminal-status muted">{status}</div>
      <div ref={containerRef} className="terminal" />
    </div>
  );
}
