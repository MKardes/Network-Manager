import sodium from 'libsodium-wrappers';
import { randomBytes } from 'node:crypto';

/**
 * WireGuard keypair generation (Curve25519), independent of the `wg` binary so
 * it works in tests and on any platform. Keys are base64-encoded raw 32-byte
 * values, matching WireGuard's format.
 */

export interface WgKeyPair {
  privateKey: string;
  publicKey: string;
}

function clamp(k: Buffer): Buffer {
  k[0] &= 248;
  k[31] &= 127;
  k[31] |= 64;
  return k;
}

export async function generateWgKeyPair(): Promise<WgKeyPair> {
  await sodium.ready;
  const priv = clamp(randomBytes(32));
  const pub = sodium.crypto_scalarmult_base(new Uint8Array(priv));
  return {
    privateKey: priv.toString('base64'),
    publicKey: Buffer.from(pub).toString('base64'),
  };
}

/** Derive the public key from an existing private key (base64). */
export async function derivePublicKey(privateKeyB64: string): Promise<string> {
  await sodium.ready;
  const priv = Buffer.from(privateKeyB64, 'base64');
  const pub = sodium.crypto_scalarmult_base(new Uint8Array(priv));
  return Buffer.from(pub).toString('base64');
}
