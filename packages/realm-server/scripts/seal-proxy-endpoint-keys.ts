// Seals every proxy endpoint key still held only in plain text, then logs the
// plaintext census: the same pass the realm server runs at startup, on demand.
// The data key comes from the environment as it does for the realm server:
// KMS when SECRETS_KMS_KEY_ARN and SECRETS_WRAPPED_DATA_KEY are set, otherwise
// the local development key. The local key is accepted only for the
// development database, on this machine at port 5435: a tunnel to a deployed
// database also answers on localhost, and a key sealed under the public local
// key is no secret.

import '../setup-logger.ts';
import { PgAdapter } from '@cardstack/postgres';
import {
  reportPlaintextCensus,
  startSecretsAtRest,
} from '../lib/secrets-at-rest/index.ts';
import { sealProxyEndpointKeys } from '../lib/proxy-endpoint-keys.ts';
import { isDeployedServerURL } from '../lib/outbound/client.ts';

const DEVELOPMENT_DATABASE_PORT = '5435';

function isDevelopmentDatabase(): boolean {
  return (
    !isDeployedServerURL(`postgres://${process.env.PGHOST || 'localhost'}`) &&
    (process.env.PGPORT || DEVELOPMENT_DATABASE_PORT) ===
      DEVELOPMENT_DATABASE_PORT
  );
}

async function main() {
  await startSecretsAtRest({ deployed: !isDevelopmentDatabase() });
  let adapter = new PgAdapter({ autoMigrate: false });
  try {
    await sealProxyEndpointKeys(adapter);
    await reportPlaintextCensus(adapter);
  } finally {
    await adapter.close();
  }
}

main().catch((err) => {
  console.error(`Failed to seal proxy endpoint keys: ${err?.message ?? err}`);
  process.exit(1);
});
