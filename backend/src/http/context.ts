import type { Logger } from 'pino';
import type { DB } from '../store/db.js';
import type { AppConfig } from '../config/index.js';
import { AuditService } from '../audit/audit.js';
import { SessionStore } from '../auth/sessions.js';
import { LockoutService } from '../auth/lockout.js';
import { OperatorRepo } from '../auth/auth.js';
import { SshTargetRepo } from '../store/ssh-targets.js';
import { ServerRepo } from '../store/servers.js';
import { DeviceRepo } from '../store/devices.js';
import { ServerService } from '../servers/service.js';
import { PeerReconcileService } from '../servers/peers.js';
import { DeviceService } from '../devices/service.js';
import { SegmentService } from '../devices/segments.js';
import { WakeService } from '../wol/service.js';
import { ReachabilityService } from '../reachability/service.js';
import { SessionRegistry } from '../session/registry.js';

/**
 * Shared application context: single instances of the DB, config, and every
 * service/repo, wired together once and handed to route registrations.
 */
export interface AppContext {
  db: DB;
  config: AppConfig;
  log: Logger;
  audit: AuditService;
  sessions: SessionStore;
  lockout: LockoutService;
  operators: OperatorRepo;
  sshTargets: SshTargetRepo;
  servers: ServerRepo;
  devices: DeviceRepo;
  serverService: ServerService;
  peerService: PeerReconcileService;
  deviceService: DeviceService;
  segmentService: SegmentService;
  reachabilityService: ReachabilityService;
  wakeService: WakeService;
  registry: SessionRegistry;
}

export function buildContext(db: DB, config: AppConfig, log: Logger): AppContext {
  const audit = new AuditService(db);
  const sessions = new SessionStore(db, config.idleTimeoutMs);
  const lockout = new LockoutService(db);
  const operators = new OperatorRepo(db);
  const sshTargets = new SshTargetRepo(db);
  const servers = new ServerRepo(db);
  const devices = new DeviceRepo(db);
  const segmentService = new SegmentService(db, audit);
  const serverService = new ServerService(servers, devices, sshTargets, audit, config.dataDir);
  const peerService = new PeerReconcileService(servers, devices, serverService);
  const deviceService = new DeviceService(devices, servers, audit);
  const reachabilityService = new ReachabilityService(devices, servers, sshTargets, audit);
  const wakeService = new WakeService(devices, segmentService, sshTargets, audit, reachabilityService);
  const registry = new SessionRegistry(config.idleTimeoutMs);

  return {
    db,
    config,
    log,
    audit,
    sessions,
    lockout,
    operators,
    sshTargets,
    servers,
    devices,
    serverService,
    peerService,
    deviceService,
    segmentService,
    reachabilityService,
    wakeService,
    registry,
  };
}
