import { Link, useParams } from 'react-router-dom';
import { FileBrowser } from '../components/FileBrowser';

/**
 * SFTP file transfer page (US3). As with the terminal, this is where the rail
 * layout sends the drawer's Files action.
 */
export function Files() {
  const { deviceId } = useParams<{ deviceId: string }>();
  if (!deviceId) return <p className="error">No device selected.</p>;
  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to={`/devices?device=${deviceId}`}>Devices</Link>
        <span>/</span>
        <span>Files</span>
      </div>
      <h1 className="h1">Files</h1>
      <FileBrowser deviceId={deviceId} />
    </div>
  );
}
