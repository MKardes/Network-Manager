import { useParams } from 'react-router-dom';
import { FileBrowser } from '../components/FileBrowser';

/** SFTP file transfer page (US3). */
export function Files() {
  const { deviceId } = useParams<{ deviceId: string }>();
  if (!deviceId) return <p className="error">No device selected.</p>;
  return (
    <div>
      <h1>Files</h1>
      <FileBrowser deviceId={deviceId} />
    </div>
  );
}
