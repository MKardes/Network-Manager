-- Per-region Wake-on-LAN targeting (feature 003): direct the magic packet to a
-- specific LAN broadcast address and UDP port. Both nullable; when absent the
-- wake command preserves its legacy behavior (plain `wakeonlan <mac>`).

ALTER TABLE lan_segment ADD COLUMN broadcast_address TEXT;
ALTER TABLE lan_segment ADD COLUMN wol_port INTEGER;
