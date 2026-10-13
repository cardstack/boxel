import { logger } from '@cardstack/runtime-common';
import type { DBAdapter } from '@cardstack/runtime-common';
import { SecretsKeyring } from './envelope.ts';
import {
  secretsKeyProviderFromEnv,
  type KmsDecrypter,
  type SecretsKeyProvider,
} from './providers.ts';

export * from './envelope.ts';
export * from './providers.ts';

const log = logger('secrets-at-rest');

export class SecretsAtRestStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretsAtRestStartupError';
  }
}

let keyring: SecretsKeyring | undefined;

// The keyring the startup self-check loaded. Callers open a secret only where
// they use it, and never log what it opens to.
export function secretsKeyring(): SecretsKeyring {
  if (!keyring) {
    throw new Error(
      'The secrets keyring is not loaded; startSecretsAtRest must run at startup',
    );
  }
  return keyring;
}

export function resetSecretsAtRest(): void {
  keyring = undefined;
}

// Run once at startup by the realm server and by each worker: picks the
// provider the environment configures, refuses the local provider on a
// deployed server, unwraps the data keys and reports what is in effect.
export async function startSecretsAtRest({
  deployed,
  env = process.env,
  provider,
  kms,
}: {
  deployed: boolean;
  env?: NodeJS.ProcessEnv;
  provider?: SecretsKeyProvider;
  kms?: KmsDecrypter;
}): Promise<SecretsKeyring> {
  provider ??= secretsKeyProviderFromEnv(env, { kms });
  if (deployed && provider.name === 'local') {
    throw new SecretsAtRestStartupError(
      'a deployed server must unwrap its data key with KMS, but SECRETS_KMS_KEY_ARN and SECRETS_WRAPPED_DATA_KEY are not set',
    );
  }
  let { keys, currentKeyId } = await provider.loadDataKeys();
  keyring = new SecretsKeyring(keys, currentKeyId);
  for (let { key } of keys) {
    key.fill(0);
  }
  log.info(
    `secrets at rest: provider=${provider.name} deployed=${deployed} keyIds=${keyring.keyIds.join(
      ',',
    )} currentKeyId=${keyring.currentKeyId}`,
  );
  return keyring;
}

// A column that holds a secret in plain text until its table seals it with
// this helper. `query` returns one row with a numeric `count` of rows whose
// secret is still in plain text.
export interface PlaintextCensusEntry {
  table: string;
  column: string;
  query: string;
}

// Each table that adopts the helper adds its column here, and removes it once
// no plain-text value can remain.
export const PLAINTEXT_CENSUS: PlaintextCensusEntry[] = [];

// Logs how many rows of each adopting table still hold their secret in plain
// text. A count that fails to run is logged and doesn't stop startup.
export async function reportPlaintextCensus(
  dbAdapter: DBAdapter,
  entries: PlaintextCensusEntry[] = PLAINTEXT_CENSUS,
): Promise<void> {
  if (entries.length === 0) {
    log.info('plaintext census: no table seals its secrets with this helper');
    return;
  }
  for (let { table, column, query } of entries) {
    try {
      let [row] = await dbAdapter.execute(query);
      log.info(
        `plaintext census: ${table}.${column} plaintextRows=${Number(row?.count ?? 0)}`,
      );
    } catch (e: any) {
      log.warn(
        `plaintext census: counting ${table}.${column} failed: ${e?.message ?? e}`,
      );
    }
  }
}
