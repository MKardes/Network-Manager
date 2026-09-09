import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  type Device,
  type DeviceGroups,
  type PeersResponse,
  type Segment,
  type SshTarget,
} from '../api/client';

/** A device enriched with the segment context the list and detail surfaces show. */
export interface DeviceRow extends Device {
  segmentName: string;
  isController: boolean;
  /** Name of the segment's wake controller, when it has one. */
  controllerName: string | null;
}

export interface SegmentSummary {
  id: string | null;
  name: string;
  devices: DeviceRow[];
  up: number;
  controllerName: string | null;
}

const UNGROUPED = 'Ungrouped';

export interface ServerData {
  groups: SegmentSummary[];
  devices: DeviceRow[];
  segments: Segment[];
  sshTargets: SshTarget[];
  peers: PeersResponse | null;
  loading: boolean;
  error: string | null;
  /** Refetch everything — call after any mutation rather than patching state. */
  reload: () => Promise<void>;
}

/**
 * One fetch of everything a server's screens need: devices grouped by segment,
 * the segment records, the reconciled peer view (which also imports peers the
 * server knows about but the vault does not) and the SSH targets that gate
 * Terminal/Files.
 */
export function useServerData(
  activeId: string | null,
  onServerMissing?: () => void,
): ServerData {
  const [data, setData] = useState<DeviceGroups | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [sshTargets, setSshTargets] = useState<SshTarget[]>([]);
  const [peers, setPeers] = useState<PeersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!activeId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [groups, segs, peerView, targets] = await Promise.all([
        api.get<DeviceGroups>(`/servers/${activeId}/devices`),
        api.get<{ segments: Segment[] }>(`/servers/${activeId}/segments`),
        api.get<PeersResponse>(`/servers/${activeId}/peers`),
        api.get<{ sshTargets: SshTarget[] }>('/ssh-targets'),
      ]);
      setData(groups);
      setSegments(segs.segments);
      setPeers(peerView);
      setSshTargets(targets.sshTargets);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // The remembered server is gone; let the caller drop the selection
        // instead of every call failing with "Server not found".
        onServerMissing?.();
        setError('The selected server no longer exists. Pick one on the Servers page.');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load devices.');
    } finally {
      setLoading(false);
    }
    // onServerMissing is a stable callback from the caller; including it would
    // re-run the fetch on every render of pages that inline the handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const groups = useMemo<SegmentSummary[]>(() => {
    if (!data) return [];
    const build = (
      id: string | null,
      name: string,
      devices: Device[],
      controllerId: string | null,
    ): SegmentSummary => {
      const controllerName = devices.find((d) => d.id === controllerId)?.name ?? null;
      const rows = devices.map<DeviceRow>((d) => ({
        ...d,
        segmentName: name,
        isController: d.id === controllerId,
        controllerName,
      }));
      return {
        id,
        name,
        devices: rows,
        up: rows.filter((d) => d.reachability === 'connected').length,
        controllerName,
      };
    };
    const out = data.groups.map((g) =>
      build(g.segment.id, g.segment.name, g.devices, g.wakeControllerDeviceId),
    );
    if (data.ungrouped.length > 0) out.push(build(null, UNGROUPED, data.ungrouped, null));
    return out;
  }, [data]);

  const devices = useMemo(() => groups.flatMap((g) => g.devices), [groups]);

  return { groups, devices, segments, sshTargets, peers, loading, error, reload };
}
