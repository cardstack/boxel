import { chmod, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, type KeyPair } from './signature.ts';

// A local keyring, for standalone use.
//
// The preferred key material is a Matrix cross-signed device key: it is
// already federated, already recoverable, and binds to an identity other
// people can check. That path arrives with the realm server. Until then a
// local ed25519 key is enough to make L9 real, and the envelope format does
// not care which produced it.

export function keyringDir(): string {
  return process.env.DECK_KEYRING ?? join(homedir(), '.deck', 'keys');
}

interface StoredKey extends KeyPair {
  createdAt: string;
  label?: string;
}

function keyPath(dir: string, keyId: string): string {
  // A keyId contains ':' — legal on POSIX but not on Windows, and awkward
  // everywhere. The file is named by the fingerprint alone.
  return join(dir, `${keyId.split(':').at(-1)}.json`);
}

export async function createKey(options: {
  label?: string;
  dir?: string;
  now?: string;
}): Promise<KeyPair> {
  let dir = options.dir ?? keyringDir();
  let pair = generateKeyPair(options.label);
  let stored: StoredKey = {
    ...pair,
    createdAt: options.now ?? new Date().toISOString(),
    ...(options.label ? { label: options.label } : {}),
  };
  await mkdir(dir, { recursive: true, mode: 0o700 });
  let path = keyPath(dir, pair.keyId);
  let tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
  await rename(tmp, path);
  // Belt and braces: a private key that is world-readable is not private,
  // and umask can defeat the mode passed to writeFile.
  await chmod(path, 0o600);
  return pair;
}

export async function listKeys(dir = keyringDir()): Promise<KeyPair[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return [];
  }
  let keys: KeyPair[] = [];
  for (let name of names) {
    try {
      let stored = JSON.parse(
        await readFile(join(dir, name), 'utf8'),
      ) as StoredKey;
      if (stored.keyId && stored.privateKey && stored.publicKey) {
        keys.push({
          keyId: stored.keyId,
          publicKey: stored.publicKey,
          privateKey: stored.privateKey,
        });
      }
    } catch {
      // A corrupt file in the keyring is not a reason to refuse the others.
    }
  }
  return keys;
}

// Named key, else the only key. Ambiguity is an error rather than a guess:
// signing with the wrong identity is not something to be helpful about.
export async function resolveKey(options: {
  keyId?: string;
  dir?: string;
} = {}): Promise<KeyPair> {
  let dir = options.dir ?? keyringDir();
  let keys = await listKeys(dir);
  if (keys.length === 0) {
    throw new Error(
      `no signing key in ${dir} — run \`deck keygen\` (L9 needs a key before a signature can mean anything)`,
    );
  }
  if (options.keyId) {
    // Match the whole id, the trailing fingerprint, or the label — all
    // three are things a person plausibly types.
    let hit = keys.find(
      (key) =>
        key.keyId === options.keyId ||
        key.keyId.endsWith(`:${options.keyId}`) ||
        key.keyId.includes(`:${options.keyId}:`),
    );
    if (!hit) {
      throw new Error(`no key matching "${options.keyId}" in ${dir}`);
    }
    return hit;
  }
  if (keys.length > 1) {
    throw new Error(
      `${keys.length} keys in ${dir}; name one with --key (${keys
        .map((key) => key.keyId)
        .join(', ')})`,
    );
  }
  return keys[0];
}
