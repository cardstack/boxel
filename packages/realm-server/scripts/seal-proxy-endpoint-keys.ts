// Seals every proxy endpoint key still held only in plain text, then logs the
// plaintext census: the same pass the realm server runs at startup, on demand.
// The data key comes from the environment as it does for the realm server:
// KMS when SECRETS_KMS_KEY_ARN and SECRETS_WRAPPED_DATA_KEY are set, otherwise
// the local development key, which is refused for a database that isn't on
// this machine.

import '../setup-logger.ts';
import { PgAdapter } from '@cardstack/postgres';
import {
  reportPlaintextCensus,
  startSecretsAtRest,
} from '../lib/secrets-at-rest/index.ts';
import { sealProxyEndpointKeys } from '../lib/proxy-endpoint-keys.ts';
import { isDeployedServerURL } from '../lib/outbound/client.ts';

async function main() {
  await startSecretsAtRest({
    deployed: isDeployedServerURL(
      `postgres://${process.env.PGHOST || 'localhost'}`,
    ),
  });
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
