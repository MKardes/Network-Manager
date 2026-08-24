-- WireGuard servers, LAN segments, and devices (peers + non-peer hosts).

CREATE TABLE wireguard_server (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL UNIQUE,
  location           TEXT NOT NULL CHECK (location IN ('local','remote')),
  interface_name     TEXT NOT NULL DEFAULT 'wg0',
  address_range      TEXT NOT NULL,             -- tunnel subnet CIDR
  listen_endpoint    TEXT NOT NULL,             -- host:port advertised to peers
  server_private_key TEXT NOT NULL,             -- 🔒 encrypted
  server_public_key  TEXT NOT NULL,
  ssh_target_id      TEXT REFERENCES ssh_target(id) ON DELETE SET NULL,
  status             TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('up','down','unknown')),
  last_synced_at     TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE lan_segment (
  id                         TEXT PRIMARY KEY,
  server_id                  TEXT NOT NULL REFERENCES wireguard_server(id) ON DELETE CASCADE,
  name                       TEXT NOT NULL,
  wake_controller_device_id  TEXT,              -- FK added logically to device(id)
  created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (server_id, name)
);

CREATE TABLE device (
  id                 TEXT PRIMARY KEY,
  server_id          TEXT NOT NULL REFERENCES wireguard_server(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('peer','host')),
  segment_id         TEXT REFERENCES lan_segment(id) ON DELETE SET NULL,
  is_wake_controller INTEGER NOT NULL DEFAULT 0,
  mac_address        TEXT,
  tunnel_address     TEXT,                       -- peer only, unique within server
  peer_public_key    TEXT,                       -- peer only
  peer_private_key   TEXT,                       -- 🔒 encrypted, peer only
  ssh_target_id      TEXT REFERENCES ssh_target(id) ON DELETE SET NULL,
  reachability       TEXT NOT NULL DEFAULT 'unknown' CHECK (reachability IN ('connected','offline','unknown')),
  last_seen_at       TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A peer's tunnel address is unique within its server.
CREATE UNIQUE INDEX idx_device_tunnel_addr
  ON device (server_id, tunnel_address)
  WHERE tunnel_address IS NOT NULL;

CREATE INDEX idx_device_server ON device (server_id);
CREATE INDEX idx_device_segment ON device (segment_id);
