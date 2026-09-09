import { Link, useParams } from 'react-router-dom';
import { TerminalView } from '../components/Terminal';

/**
 * In-browser SSH terminal page (US2). The bar layout hosts the terminal in a
 * detail tab; the rail layout's drawer is too narrow for it, so it opens here.
 */
export function Terminal() {
  const { deviceId } = useParams<{ deviceId: string }>();
  if (!deviceId) return <p className="error">No device selected.</p>;
  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to={`/devices?device=${deviceId}`}>Devices</Link>
        <span>/</span>
        <span>Terminal</span>
      </div>
      <h1 className="h1">Terminal</h1>
      <TerminalView deviceId={deviceId} />
    </div>
  );
}
