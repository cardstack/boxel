// Runs one of the passes the realm server runs at startup to seal secrets
// still held only in plain text, then logs the plaintext census. The data key
// comes from the environment as it does for the realm server: KMS when
// SECRETS_KMS_KEY_ARN and SECRETS_WRAPPED_DATA_KEY are set, otherwise the
// local development key. The local key is accepted only for the development
// database, on this machine's loopback or a local socket at port 5435: a
// private address can be another machine, a tunnel to a deployed database
// also answers on localhost, and a secret sealed under the public local key
// is no secret.
//
// A row whose sealed value fails to open under a loaded key, or opens to a
// value other than its plain text, is reported and left as it is. Passing
// `--reseal-tampered` seals such rows again from their plain text, once an
// operator has inspected them and accepts what they say.

import { PgAdapter } from '@cardstack/postgres';
import {
  reportPlaintextCensus,
  startSecretsAtRest,
} from '../../lib/secrets-at-rest/index.ts';

const DEVELOPMENT_DATABASE_PORT = '5435';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function isDevelopmentDatabase(): boolean {
  let host = process.env.PGHOST || 'localhost';
  return (
    (LOOPBACK_HOSTS.has(host) || host.startsWith('/')) &&
    (process.env.PGPORT || DEVELOPMENT_DATABASE_PORT) ===
      DEVELOPMENT_DATABASE_PORT
  );
}

export interface SealingPassOptions {
  resealTampered: boolean;
}

export function runSealingPass(
  description: string,
  pass: (dbAdapter: PgAdapter, options: SealingPassOptions) => Promise<unknown>,
): void {
  let options: SealingPassOptions = {
    resealTampered: process.argv.includes('--reseal-tampered'),
  };
  (async () => {
    await startSecretsAtRest({ deployed: !isDevelopmentDatabase() });
    let adapter = new PgAdapter({ autoMigrate: false });
    try {
      await pass(adapter, options);
      await reportPlaintextCensus(adapter);
    } finally {
      await adapter.close();
    }
  })().catch((err) => {
    console.error(`Failed to seal ${description}: ${err?.message ?? err}`);
    process.exit(1);
  });
}
