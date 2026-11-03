import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto';
import { constants } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type {
  HostedIdentityProof,
  HostedIdentityVerifier,
} from './hosted-identity.ts';
import {
  createLocalIdentityGrantIssuer,
  createLocalIdentityGrantVerifier,
  type LocalIdentityBinding,
} from './local-identity-grant.ts';
import type { NativeSecretEncryption } from './local-secrets.ts';

export interface LocalIdentityStore {
  isLinked(localUserId: string): Promise<boolean>;
  link(
    binding: LocalIdentityBinding,
    proof: HostedIdentityProof,
    now: number,
  ): Promise<LocalIdentityBinding>;
  resolve(
    localUserId: string,
    now: number,
  ): Promise<LocalIdentityBinding | undefined>;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

export async function createLocalIdentityStore(options: {
  directory: string;
  encryption: NativeSecretEncryption;
  stackId: string;
  localMatrixServerName: string;
  hostedVerifier: HostedIdentityVerifier;
}): Promise<LocalIdentityStore> {
  const {
    directory,
    encryption,
    stackId,
    localMatrixServerName,
    hostedVerifier,
  } = options;
  if (!path.isAbsolute(directory) || !encryption.isEncryptionAvailable())
    throw new Error('Native identity storage is unavailable');
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(stackId) ||
    !/^[A-Za-z0-9.-]+(?::[0-9]+)?$/.test(localMatrixServerName)
  )
    throw new Error('Invalid native identity store configuration');
  const keyFile = path.join(directory, 'identity-key.bin');
  const grantsDirectory = path.join(directory, 'identity-grants');

  async function ensureDirectory(target: string): Promise<void> {
    try {
      await mkdir(target, { recursive: true, mode: 0o700 });
      const info = await lstat(target);
      if (!info.isDirectory() || (info.mode & 0o077) !== 0)
        throw new Error('Invalid native identity directory');
    } catch {
      throw new Error('Cannot open native identity directory');
    }
  }

  async function read(file: string): Promise<unknown> {
    try {
      const handle = await open(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const info = await handle.stat();
        if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 65_536)
          throw new Error('Invalid native identity record');
        const bytes = await handle.readFile();
        if (bytes.length > 65_536)
          throw new Error('Invalid native identity record');
        return JSON.parse(await encryption.decryptString(bytes));
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return undefined;
      throw new Error(
        'Cannot unlock native identity; recover the original encrypted store',
      );
    }
  }

  async function write(
    file: string,
    value: object,
    replace: boolean,
  ): Promise<boolean> {
    const temporary = path.join(
      path.dirname(file),
      `.identity-${randomBytes(12).toString('hex')}.tmp`,
    );
    try {
      const bytes = await encryption.encryptString(JSON.stringify(value));
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
      if (replace) {
        await rename(temporary, file);
      } else {
        try {
          await link(temporary, file);
        } catch (error) {
          if (hasCode(error, 'EEXIST')) return false;
          throw error;
        }
      }
      return true;
    } catch {
      throw new Error('Cannot persist encrypted native identity');
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  await ensureDirectory(directory);
  await ensureDirectory(grantsDirectory);
  let keyRecord = await read(keyFile);
  if (
    keyRecord === undefined &&
    (await readdir(grantsDirectory)).length !== 0
  ) {
    keyRecord = await read(keyFile);
    if (keyRecord === undefined)
      throw new Error(
        'Native identity key is missing; recover the original encrypted store',
      );
  }
  if (keyRecord === undefined) {
    const { privateKey } = generateKeyPairSync('ed25519');
    await write(
      keyFile,
      {
        schemaVersion: 1,
        stackId,
        localMatrixServerName,
        deviceId: randomBytes(24).toString('base64url'),
        privateKey: privateKey
          .export({ format: 'pem', type: 'pkcs8' })
          .toString(),
      },
      false,
    );
    keyRecord = await read(keyFile);
  }
  if (
    !record(keyRecord) ||
    Object.keys(keyRecord).length !== 5 ||
    keyRecord.schemaVersion !== 1 ||
    keyRecord.stackId !== stackId ||
    keyRecord.localMatrixServerName !== localMatrixServerName ||
    typeof keyRecord.deviceId !== 'string' ||
    !/^[A-Za-z0-9_-]{32}$/.test(keyRecord.deviceId) ||
    typeof keyRecord.privateKey !== 'string'
  )
    throw new Error(
      'Invalid native identity key; recover the original encrypted store',
    );
  let privateKey;
  try {
    privateKey = createPrivateKey(keyRecord.privateKey);
    if (privateKey.asymmetricKeyType !== 'ed25519')
      throw new Error('Invalid key');
  } catch {
    throw new Error(
      'Invalid native identity key; recover the original encrypted store',
    );
  }
  const policy = {
    deviceId: keyRecord.deviceId,
    stackId,
    localMatrixServerName,
    maxOfflineSeconds: 30 * 24 * 60 * 60,
  };
  const issuer = createLocalIdentityGrantIssuer({
    privateKey,
    policy,
    hostedVerifier,
  });
  const verifier = createLocalIdentityGrantVerifier({
    publicKey: issuer.publicKey,
    policy,
  });

  function grantFile(localUserId: string): string {
    if (
      localUserId.length > 255 ||
      !/^@[^:\s]+:[^\s/]+$/.test(localUserId) ||
      localUserId.slice(localUserId.indexOf(':') + 1) !== localMatrixServerName
    )
      throw new Error('Invalid linked local account');
    return path.join(
      grantsDirectory,
      createHash('sha256').update(localUserId).digest('hex') + '.bin',
    );
  }

  async function readGrant(file: string, localUserId: string) {
    const value = await read(file);
    if (value === undefined) return undefined;
    if (
      !record(value) ||
      Object.keys(value).length !== 4 ||
      value.schemaVersion !== 1 ||
      value.localUserId !== localUserId ||
      typeof value.hostedUserId !== 'string' ||
      !/^@[^:\s]+:[^\s/]+$/.test(value.hostedUserId) ||
      value.hostedUserId.length > 255 ||
      typeof value.grant !== 'string' ||
      value.grant.length > 4096
    )
      throw new Error(
        'Invalid native identity grant; recover the original encrypted store',
      );
    return {
      localUserId,
      hostedUserId: value.hostedUserId,
      grant: value.grant,
    };
  }

  let pending = Promise.resolve();
  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = pending.then(work);
    pending = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  return {
    isLinked(localUserId) {
      return serialize(
        async () =>
          (await readGrant(grantFile(localUserId), localUserId)) !== undefined,
      );
    },
    link(binding, proof, now) {
      const identity = { ...binding };
      const identityProof = { ...proof };
      return serialize(async () => {
        const file = grantFile(identity.localUserId);
        const existing = await readGrant(file, identity.localUserId);
        if (existing && existing.hostedUserId !== identity.hostedUserId)
          throw new Error(
            'Local account is already linked to another hosted identity',
          );
        const grant = await issuer.issue(identity, identityProof, now);
        const value = { schemaVersion: 1, ...identity, grant };
        if (!(await write(file, value, false))) {
          const winner = await readGrant(file, identity.localUserId);
          if (!winner || winner.hostedUserId !== identity.hostedUserId)
            throw new Error(
              'Local account is already linked to another hosted identity',
            );
          await write(file, value, true);
        }
        return identity;
      });
    },
    resolve(localUserId, now) {
      return serialize(async () => {
        const stored = await readGrant(grantFile(localUserId), localUserId);
        if (!stored) return undefined;
        const binding = verifier.verify(stored.grant, localUserId, now);
        if (binding && binding.hostedUserId !== stored.hostedUserId)
          throw new Error('Invalid native identity binding');
        return binding;
      });
    },
  };
}
