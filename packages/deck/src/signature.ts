import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TREES_DIR } from './object-store.ts';

// L9 · Endorsement — a signature binds a key to a treeHash.
//
// treeHash says the bytes did not change. It does not say who stands behind
// them, and a JWT does not either: a token authorises a CONNECTION, so it
// proves nothing about a pack sitting in a mirror or a cache. A signature
// over the hash travels with the bytes.
//
// L10 · Inheritance falls out of where the envelope lives. Signatures are
// stored against the TREE, not against a package or a version, so a fork at
// the same treeHash sees exactly the same endorsements — and loses them the
// instant it changes a byte, because that is a different tree.

export const SIG_SPEC = 'deck-sig-v1';
export const TREE_HASH_SPEC = 'tree-hash-v1';

// The canonical bytes to sign. Two lines, nothing else — no timestamp, no
// package name, no version. A timestamp would make signing non-deterministic
// and unrepeatable; a name would make the signature about a label somebody
// else controls.
export function signingPayload(treeHash: string): Buffer {
  return Buffer.from(`${SIG_SPEC}\n${TREE_HASH_SPEC}:${treeHash}\n`, 'utf8');
}

export type SignatureRole = 'publish' | 'dev' | 'attest';

export interface Signature {
  alg: 'ed25519';
  keyId: string;
  // SPKI DER, base64. Embedded so verification needs no network; whether
  // the key is TRUSTED is a separate question the verifier answers.
  publicKey: string;
  signature: string;
  role: SignatureRole;
  // Unsigned metadata, for humans. Deliberately outside the payload.
  createdAt?: string;
  publisher?: string;
}

export interface SignatureEnvelope {
  spec: typeof SIG_SPEC;
  treeHash: { spec: typeof TREE_HASH_SPEC; hash: string };
  signatures: Signature[];
}

export function emptyEnvelope(treeHash: string): SignatureEnvelope {
  return {
    spec: SIG_SPEC,
    treeHash: { spec: TREE_HASH_SPEC, hash: treeHash },
    signatures: [],
  };
}

export interface KeyPair {
  keyId: string;
  publicKey: string; // SPKI DER, base64
  privateKey: string; // PKCS8 DER, base64
}

export function generateKeyPair(label?: string): KeyPair {
  let { publicKey, privateKey } = generateKeyPairSync('ed25519');
  let spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  let pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
  return {
    keyId: keyIdFor(spki, label),
    publicKey: spki.toString('base64'),
    privateKey: pkcs8.toString('base64'),
  };
}

// A local key names itself by its own fingerprint, so two keys can never
// collide and a keyId cannot claim to be someone it is not. A Matrix
// cross-signed device supplies its own id instead — see the roadmap in
// docs/deck-competitive-gaps.md §2.5.
export function keyIdFor(spkiDer: Buffer, label?: string): string {
  let fingerprint = spkiDer.subarray(-16).toString('hex');
  return label ? `deck:local:${label}:${fingerprint}` : `deck:local:${fingerprint}`;
}

function publicKeyObject(base64: string): KeyObject {
  return createPublicKey({
    key: Buffer.from(base64, 'base64'),
    format: 'der',
    type: 'spki',
  });
}

function privateKeyObject(base64: string): KeyObject {
  return createPrivateKey({
    key: Buffer.from(base64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
}

export function signTreeHash(options: {
  treeHash: string;
  key: KeyPair;
  role?: SignatureRole;
  publisher?: string;
  createdAt?: string;
}): Signature {
  let { treeHash, key, role = 'publish', publisher, createdAt } = options;
  let signature = cryptoSign(
    null,
    signingPayload(treeHash),
    privateKeyObject(key.privateKey),
  );
  return {
    alg: 'ed25519',
    keyId: key.keyId,
    publicKey: key.publicKey,
    signature: signature.toString('base64'),
    role,
    ...(createdAt ? { createdAt } : {}),
    ...(publisher ? { publisher } : {}),
  };
}

export function verifySignature(
  treeHash: string,
  signature: Signature,
): boolean {
  if (signature.alg !== 'ed25519') {
    return false;
  }
  try {
    return cryptoVerify(
      null,
      signingPayload(treeHash),
      publicKeyObject(signature.publicKey),
      Buffer.from(signature.signature, 'base64'),
    );
  } catch {
    return false;
  }
}

export interface EnvelopeVerdict {
  treeHash: string;
  valid: Signature[];
  invalid: Signature[];
  // The envelope claims a different tree than the one being verified.
  mismatched: boolean;
}

export function verifyEnvelope(
  treeHash: string,
  envelope: SignatureEnvelope,
): EnvelopeVerdict {
  let mismatched = envelope.treeHash?.hash !== treeHash;
  let valid: Signature[] = [];
  let invalid: Signature[] = [];
  for (let signature of envelope.signatures ?? []) {
    // Verify against the tree we were ASKED about, never against the hash
    // the envelope names — otherwise an envelope could endorse itself.
    (verifySignature(treeHash, signature) && !mismatched ? valid : invalid).push(
      signature,
    );
  }
  return { treeHash, valid, invalid, mismatched };
}

// The envelope sits beside the tree object it is about, so copying
// `_trees/` and `_objects/` to another machine carries the endorsements too.
export function envelopePath(storeDir: string, treeHash: string): string {
  return join(storeDir, TREES_DIR, treeHash.slice(0, 2), `${treeHash}.sig.json`);
}

export async function readEnvelope(
  storeDir: string,
  treeHash: string,
): Promise<SignatureEnvelope | undefined> {
  try {
    let parsed = JSON.parse(
      await readFile(envelopePath(storeDir, treeHash), 'utf8'),
    ) as SignatureEnvelope;
    return parsed?.spec === SIG_SPEC ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// Appending is idempotent per key and role: signing twice with the same key
// replaces rather than accumulates, so a re-run never grows the file.
export async function appendSignature(
  storeDir: string,
  treeHash: string,
  signature: Signature,
): Promise<SignatureEnvelope> {
  let envelope = (await readEnvelope(storeDir, treeHash)) ?? emptyEnvelope(treeHash);
  envelope.signatures = [
    ...envelope.signatures.filter(
      (existing) =>
        !(existing.keyId === signature.keyId && existing.role === signature.role),
    ),
    signature,
  ].sort((a, b) => a.keyId.localeCompare(b.keyId) || a.role.localeCompare(b.role));
  let path = envelopePath(storeDir, treeHash);
  await mkdir(join(path, '..'), { recursive: true });
  let tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(envelope, null, 2) + '\n');
  await rename(tmp, path);
  return envelope;
}

// What `?meta` reports: enough to decide whether to trust, without shipping
// key material to every reader.
export interface SignatureSummary {
  keyId: string;
  role: SignatureRole;
  alg: string;
  valid: boolean;
}

export function summarizeEnvelope(
  treeHash: string,
  envelope: SignatureEnvelope | undefined,
): SignatureSummary[] {
  if (!envelope) {
    return [];
  }
  let verdict = verifyEnvelope(treeHash, envelope);
  return [...verdict.valid, ...verdict.invalid]
    .map((signature) => ({
      keyId: signature.keyId,
      role: signature.role,
      alg: signature.alg,
      valid: verdict.valid.includes(signature),
    }))
    .sort((a, b) => a.keyId.localeCompare(b.keyId));
}
