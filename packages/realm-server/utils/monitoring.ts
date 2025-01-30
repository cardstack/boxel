import { Sha256 } from '@aws-crypto/sha256-js';

export async function monitoringAuthToken(secretSeed: string): Promise<string> {
  let hash = new Sha256();
  hash.update('MONITORING');
  hash.update(secretSeed);
  return uint8ArrayToHex(await hash.digest());
}

function uint8ArrayToHex(uint8: Uint8Array) {
  return Array.from(uint8)
    .map((i) => i.toString(16).padStart(2, '0'))
    .join('');
}
