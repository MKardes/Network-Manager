import { useParams } from 'react-router-dom';
import { TerminalView } from '../components/Terminal';

/** In-browser SSH terminal page (US2). */
export function Terminal() {
  const { deviceId } = useParams<{ deviceId: string }>();
  if (!deviceId) return <p className="error">No device selected.</p>;
  return (
    <div>
      <h1>Terminal</h1>
      <TerminalView deviceId={deviceId} />
    </div>
  );
}
