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
