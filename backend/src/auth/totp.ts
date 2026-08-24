import { authenticator } from 'otplib';

/**
 * TOTP enrollment/verification (FR-024a). The secret is generated here and
 * stored encrypted by the caller; only the provisioning URI is shown once.
 */

authenticator.options = { window: 1 }; // tolerate +/-1 step of clock drift

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpProvisioningUri(username: string, secret: string): string {
  return authenticator.keyuri(username, 'WireGuard Network Manager', secret);
}

export function verifyTotp(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token: token.trim(), secret });
  } catch {
    return false;
  }
}
