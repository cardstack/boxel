import { logger } from '@cardstack/runtime-common';
import type { DBAdapter } from '@cardstack/runtime-common';
import { SecretsKeyring } from './envelope.ts';
import {
  secretsKeyProviderFromEnv,
  type KmsDecrypter,
  type LoadedDataKeys,
  type SecretsKeyProvider,
  type SecretsProviderName,
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

// The keyring this process installed at startup. Callers open a secret only
// where they use it, and never log what it opens to.
export function secretsKeyring(): SecretsKeyring {
  if (!keyring) {
    throw new Error(
      'The secrets keyring is not loaded; it is installed at startup',
    );
  }
  return keyring;
}

export function resetSecretsAtRest(): void {
  keyring = undefined;
}

// The data keys a process unwrapped, with what the self-check reports about
// them.
export interface UnwrappedDataKeys extends LoadedDataKeys {
  provider: SecretsProviderName;
  deployed: boolean;
}

// The self-check: picks the provider the environment configures, refuses the
// local provider on a deployed server, and unwraps the data keys. Runs once
// per process that unwraps: the realm server, and the worker manager on behalf
// of all of its workers.
export async function unwrapDataKeys({
  deployed,
  env = process.env,
  provider,
  kms,
}: {
  deployed: boolean;
  env?: NodeJS.ProcessEnv;
  provider?: SecretsKeyProvider;
  kms?: KmsDecrypter;
}): Promise<UnwrappedDataKeys> {
  provider ??= secretsKeyProviderFromEnv(env, { kms });
  if (deployed && provider.name === 'local') {
    throw new SecretsAtRestStartupError(
      'a deployed server must unwrap its data key with KMS, but SECRETS_KMS_KEY_ARN and SECRETS_WRAPPED_DATA_KEY are not set',
    );
  }
  let { keys, currentKeyId } = await provider.loadDataKeys();
  let unwrapped = { provider: provider.name, deployed, keys, currentKeyId };
  reportSecretsAtRest(unwrapped);
  return unwrapped;
}

function reportSecretsAtRest({
  provider,
  deployed,
  keys,
  currentKeyId,
}: UnwrappedDataKeys): void {
  log.info(
    `secrets at rest: provider=${provider} deployed=${deployed} keyIds=${keys
      .map(({ keyId }) => keyId)
      .join(',')} currentKeyId=${currentKeyId}`,
  );
}

// Makes the unwrapped keys this process's keyring, and zeroes the buffers it
// was handed.
export function installSecretsKeyring({
  keys,
  currentKeyId,
}: LoadedDataKeys): SecretsKeyring {
  keyring = new SecretsKeyring(keys, currentKeyId);
  for (let { key } of keys) {
    key.fill(0);
  }
  return keyring;
}

// Run once at startup by the realm server.
export async function startSecretsAtRest(
  options: Parameters<typeof unwrapDataKeys>[0],
): Promise<SecretsKeyring> {
  return installSecretsKeyring(await unwrapDataKeys(options));
}

// A worker gets its keyring from the worker manager over the IPC channel
// between them: it sends the request and the manager answers with the keys it
// unwrapped at its own startup. The answer carries key material, so neither
// side logs it.
export const SECRETS_KEYRING_REQUEST = 'secrets-keyring-request';
const SECRETS_KEYRING_IPC_PREFIX = 'secrets-keyring|';

export function encodeSecretsKeyringIpc({
  keys,
  currentKeyId,
}: LoadedDataKeys): string {
  return `${SECRETS_KEYRING_IPC_PREFIX}${JSON.stringify({
    currentKeyId,
    keys: keys.map(({ keyId, key }) => ({
      keyId,
      key: key.toString('base64'),
    })),
  })}`;
}

export function isSecretsKeyringIpc(message: unknown): message is string {
  return (
    typeof message === 'string' &&
    message.startsWith(SECRETS_KEYRING_IPC_PREFIX)
  );
}

function decodeSecretsKeyringIpc(message: string): LoadedDataKeys {
  let { currentKeyId, keys } = JSON.parse(
    message.substring(SECRETS_KEYRING_IPC_PREFIX.length),
  ) as { currentKeyId: string; keys: { keyId: string; key: string }[] };
  return {
    currentKeyId,
    keys: keys.map(({ keyId, key }) => ({
      keyId,
      key: Buffer.from(key, 'base64'),
    })),
  };
}

// Asks the parent process for the keyring and installs it.
export function receiveSecretsKeyring({
  channel = process,
  timeoutMs = 10_000,
}: {
  channel?: Pick<NodeJS.Process, 'send' | 'on' | 'off'>;
  timeoutMs?: number;
} = {}): Promise<SecretsKeyring> {
  return new Promise((resolve, reject) => {
    if (!channel.send) {
      reject(
        new Error(
          'a worker gets its data keys from its worker manager over IPC, but this process has no IPC channel',
        ),
      );
      return;
    }
    let timer = setTimeout(() => {
      channel.off('message', onMessage);
      reject(
        new Error(
          `the worker manager did not send the data keys within ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);
    function onMessage(message: unknown) {
      if (!isSecretsKeyringIpc(message)) {
        return;
      }
      clearTimeout(timer);
      channel.off('message', onMessage);
      try {
        let ring = installSecretsKeyring(decodeSecretsKeyringIpc(message));
        log.info(
          `secrets at rest: received keyIds=${ring.keyIds.join(',')} currentKeyId=${ring.currentKeyId} from the worker manager`,
        );
        resolve(ring);
      } catch (e) {
        reject(e);
      }
    }
    channel.on('message', onMessage);
    channel.send(SECRETS_KEYRING_REQUEST);
  });
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
