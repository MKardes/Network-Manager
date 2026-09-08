import { describe, it, expect } from 'vitest';
import { vetted, VettedCommandError } from '../../src/remote/commands.js';

describe('vetted command builders', () => {
  it('builds a wg show command for a valid interface', () => {
    expect(vetted.wgShow('wg0')).toBe("wg show 'wg0' dump");
  });

  it('rejects an invalid interface name (injection attempt)', () => {
    expect(() => vetted.wgShow('wg0; rm -rf /')).toThrow(VettedCommandError);
  });

  it('builds a wake command for a valid MAC', () => {
    expect(vetted.wake('AA:BB:CC:DD:EE:FF')).toContain("wakeonlan 'AA:BB:CC:DD:EE:FF'");
  });

  it('rejects a bad MAC', () => {
    expect(() => vetted.wake('not-a-mac')).toThrow(VettedCommandError);
    expect(() => vetted.wake('AA:BB:CC:DD:EE:FF; reboot')).toThrow(VettedCommandError);
  });

  it('directs the wake packet to a segment broadcast + port when given (feature 003)', () => {
    expect(vetted.wake('AA:BB:CC:DD:EE:FF', { broadcast: '192.168.1.255', port: 9 })).toBe(
      "wakeonlan -i '192.168.1.255' -p 9 'AA:BB:CC:DD:EE:FF'",
    );
    // Absent targeting preserves the legacy fallback string.
    expect(vetted.wake('AA:BB:CC:DD:EE:FF', {})).toBe(
      "wakeonlan 'AA:BB:CC:DD:EE:FF' || etherwake 'AA:BB:CC:DD:EE:FF'",
    );
  });

  it('rejects a bad broadcast address or port', () => {
    expect(() => vetted.wake('AA:BB:CC:DD:EE:FF', { broadcast: 'nope' })).toThrow(VettedCommandError);
    expect(() => vetted.wake('AA:BB:CC:DD:EE:FF', { port: 70000 })).toThrow(VettedCommandError);
    expect(() => vetted.wake('AA:BB:CC:DD:EE:FF', { port: 0 })).toThrow(VettedCommandError);
  });

  it('builds a bounded probe command for a valid IPv4 host (feature 003)', () => {
    expect(vetted.probe('10.0.0.2')).toBe("ping -c 1 -W 3 '10.0.0.2'");
  });

  it('rejects a non-IPv4 probe host (injection attempt)', () => {
    expect(() => vetted.probe('10.0.0.2; reboot')).toThrow(VettedCommandError);
    expect(() => vetted.probe('example.com')).toThrow(VettedCommandError);
  });

  it('rejects a config path outside the allowed pattern', () => {
    expect(() => vetted.wgSyncConf('wg0', 'relative/path.conf')).toThrow(VettedCommandError);
    expect(() => vetted.writeConfig('/etc/wireguard/$(whoami).conf')).toThrow(VettedCommandError);
  });

  it('only allows up/down for wg-quick', () => {
    expect(vetted.wgQuick('up', 'wg0')).toBe("wg-quick up 'wg0'");
    // @ts-expect-error invalid action rejected at runtime
    expect(() => vetted.wgQuick('restart', 'wg0')).toThrow(VettedCommandError);
  });
});
