import { randomBytes } from 'node:crypto';
import {
  lstat,
  link,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

export interface NativeSecretEncryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer | Promise<Buffer>;
  decryptString(value: Buffer): string | Promise<string>;
}
export interface LocalStackSecrets {
  schemaVersion: 1;
  postgresPassword: string;
  realmServerSecretSeed: string;
  realmSecretSeed: string;
  matrixRegistrationSecret: string;
  matrixJwtSecret: string;
  aiBotPassword: string;
  dataKey: string;
}
export interface LocalSecretsStore {
  loadOrCreate(): Promise<LocalStackSecrets>;
}
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
function isExisting(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
function parseSecrets(value: unknown): LocalStackSecrets {
  if (
    !value ||
    typeof value !== 'object' ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('postgresPassword' in value) ||
    typeof value.postgresPassword !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.postgresPassword) ||
    !('realmServerSecretSeed' in value) ||
    typeof value.realmServerSecretSeed !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.realmServerSecretSeed) ||
    !('realmSecretSeed' in value) ||
    typeof value.realmSecretSeed !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.realmSecretSeed) ||
    !('matrixRegistrationSecret' in value) ||
    typeof value.matrixRegistrationSecret !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.matrixRegistrationSecret) ||
    !('matrixJwtSecret' in value) ||
    typeof value.matrixJwtSecret !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.matrixJwtSecret) ||
    !('aiBotPassword' in value) ||
    typeof value.aiBotPassword !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.aiBotPassword) ||
    !('dataKey' in value) ||
    typeof value.dataKey !== 'string' ||
    Buffer.from(value.dataKey, 'base64').length !== 32 ||
    Buffer.from(value.dataKey, 'base64').toString('base64') !== value.dataKey
  ) {
    throw new Error(
      'Local stack secrets are invalid; recover the original encrypted store',
    );
  }
  return {
    schemaVersion: 1,
    postgresPassword: value.postgresPassword,
    realmServerSecretSeed: value.realmServerSecretSeed,
    realmSecretSeed: value.realmSecretSeed,
    matrixRegistrationSecret: value.matrixRegistrationSecret,
    matrixJwtSecret: value.matrixJwtSecret,
    aiBotPassword: value.aiBotPassword,
    dataKey: value.dataKey,
  };
}

// Called only by a native launcher after its encryption backend is ready.
// Electron safeStorage implements this boundary on macOS. No renderer receives
// the backend, encrypted-store path, plaintext secrets or a store handle.
export function createLocalSecretsStore(
  env: NodeJS.ProcessEnv,
  encryption: NativeSecretEncryption,
): LocalSecretsStore {
  if (env.BOXEL_LOCAL_SECRETS_PROVIDER !== 'keychain')
    throw new Error('BOXEL_LOCAL_SECRETS_PROVIDER must be keychain');
  let directory = env.BOXEL_LOCAL_SECRETS_DIR;
  if (!directory || !path.isAbsolute(directory))
    throw new Error(
      'BOXEL_LOCAL_SECRETS_DIR must be an absolute native directory',
    );
  let file = path.join(directory, 'secrets.bin');
  async function readExisting(): Promise<LocalStackSecrets | undefined> {
    try {
      let info = await lstat(file);
      if (!info.isFile() || info.size > 65_536 || (info.mode & 0o077) !== 0)
        throw new Error('Invalid secret store');
      let encrypted = await readFile(file);
      let plaintext = await encryption.decryptString(encrypted);
      let value: unknown = JSON.parse(plaintext);
      return parseSecrets(value);
    } catch (error) {
      if (isMissing(error)) return undefined;
      // Never delete or replace an inaccessible store: doing so strands data
      // sealed under its original key. Do not attach native errors as causes.
      throw new Error(
        'Cannot unlock local stack secrets; recover the original encrypted store',
      );
    }
  }
  return {
    async loadOrCreate() {
      if (!encryption.isEncryptionAvailable())
        throw new Error('Native secret encryption is unavailable');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      let existing = await readExisting();
      if (existing) return existing;
      let hex = () => randomBytes(32).toString('hex');
      let secrets: LocalStackSecrets = {
        schemaVersion: 1,
        postgresPassword: hex(),
        realmServerSecretSeed: hex(),
        realmSecretSeed: hex(),
        matrixRegistrationSecret: hex(),
        matrixJwtSecret: hex(),
        aiBotPassword: hex(),
        dataKey: randomBytes(32).toString('base64'),
      };
      let encrypted: Buffer;
      try {
        encrypted = await encryption.encryptString(JSON.stringify(secrets));
      } catch {
        throw new Error('Cannot encrypt local stack secrets');
      }
      let temporary = path.join(
        directory,
        `.secrets-${randomBytes(12).toString('hex')}.tmp`,
      );
      try {
        await writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' });
        try {
          await link(temporary, file);
        } catch (error) {
          if (!isExisting(error)) throw error;
        }
      } catch {
        throw new Error('Cannot persist encrypted local stack secrets');
      } finally {
        await unlink(temporary).catch(() => {});
      }
      let stored = await readExisting();
      if (!stored) throw new Error('Encrypted local stack secrets disappeared');
      return stored;
    },
  };
}
