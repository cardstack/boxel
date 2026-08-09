import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pack } from '../src/pack.ts';
import { publishToStore } from '../src/store.ts';
import {
  appendSignature,
  emptyEnvelope,
  generateKeyPair,
  readEnvelope,
  signingPayload,
  signTreeHash,
  summarizeEnvelope,
  verifyEnvelope,
  verifySignature,
} from '../src/signature.ts';
import { createKey, listKeys, resolveKey } from '../src/keyring.ts';

const HASH_A =
  '1111111111111111111111111111111111111111111111111111111111111111';
const HASH_B =
  '2222222222222222222222222222222222222222222222222222222222222222';

function lib(body: string) {
  return [
    {
      path: 'importmap.json',
      bytes: Buffer.from(
        JSON.stringify({ deck: { packages: { lib: { version: '1.0.0' } } } }),
      ),
    },
    { path: 'lib.js', bytes: Buffer.from(body) },
  ];
}

module('L9 signatures bind a key to a treeHash', () => {
  test('the signed payload is exactly two lines and carries no time', (assert) => {
    assert.strictEqual(
      signingPayload(HASH_A).toString('utf8'),
      `deck-sig-v1\ntree-hash-v1:${HASH_A}\n`,
    );
  });

  test('signing is deterministic, so re-signing is not a new claim', (assert) => {
    let key = generateKeyPair();
    assert.strictEqual(
      signTreeHash({ treeHash: HASH_A, key }).signature,
      signTreeHash({ treeHash: HASH_A, key }).signature,
    );
  });

  test('a signature verifies for its tree and no other', (assert) => {
    let key = generateKeyPair();
    let signature = signTreeHash({ treeHash: HASH_A, key });
    assert.true(verifySignature(HASH_A, signature));
    assert.false(verifySignature(HASH_B, signature), 'a different tree');
  });

  test('a tampered signature does not verify', (assert) => {
    let key = generateKeyPair();
    let signature = signTreeHash({ treeHash: HASH_A, key });
    let raw = Buffer.from(signature.signature, 'base64');
    raw[0] ^= 0xff;
    assert.false(
      verifySignature(HASH_A, { ...signature, signature: raw.toString('base64') }),
    );
  });

  test('a signature cannot be moved to another key', (assert) => {
    let mine = generateKeyPair();
    let theirs = generateKeyPair();
    let signature = signTreeHash({ treeHash: HASH_A, key: mine });
    assert.false(
      verifySignature(HASH_A, { ...signature, publicKey: theirs.publicKey }),
      'claiming a different signer',
    );
  });

  test('an envelope naming another tree endorses nothing', (assert) => {
    let key = generateKeyPair();
    let envelope = emptyEnvelope(HASH_B);
    envelope.signatures.push(signTreeHash({ treeHash: HASH_B, key }));
    let verdict = verifyEnvelope(HASH_A, envelope);
    assert.true(verdict.mismatched);
    assert.strictEqual(verdict.valid.length, 0, 'an envelope cannot self-endorse');
  });

  test('the summary reports validity per key', (assert) => {
    let good = generateKeyPair();
    let envelope = emptyEnvelope(HASH_A);
    envelope.signatures.push(signTreeHash({ treeHash: HASH_A, key: good }));
    envelope.signatures.push({
      ...signTreeHash({ treeHash: HASH_B, key: generateKeyPair() }),
      role: 'dev',
    });
    let summary = summarizeEnvelope(HASH_A, envelope);
    assert.strictEqual(summary.length, 2);
    assert.strictEqual(summary.filter((s) => s.valid).length, 1);
  });
});

module('L9/L10 the envelope lives with the tree', function (hooks) {
  let storeDir: string;
  hooks.beforeEach(async function () {
    storeDir = await mkdtemp(join(tmpdir(), 'deck-sig-'));
  });
  hooks.afterEach(async function () {
    await rm(storeDir, { recursive: true, force: true });
  });

  test('a signature round-trips through the store', async function (assert) {
    let key = generateKeyPair();
    await appendSignature(storeDir, HASH_A, signTreeHash({ treeHash: HASH_A, key }));
    let envelope = await readEnvelope(storeDir, HASH_A);
    assert.strictEqual(envelope?.signatures.length, 1);
    assert.strictEqual(verifyEnvelope(HASH_A, envelope!).valid.length, 1);
  });

  test('signing twice with one key replaces rather than accumulates', async function (assert) {
    let key = generateKeyPair();
    await appendSignature(storeDir, HASH_A, signTreeHash({ treeHash: HASH_A, key }));
    await appendSignature(storeDir, HASH_A, signTreeHash({ treeHash: HASH_A, key }));
    assert.strictEqual((await readEnvelope(storeDir, HASH_A))!.signatures.length, 1);
  });

  test('co-signers accumulate', async function (assert) {
    for (let index = 0; index < 3; index++) {
      await appendSignature(
        storeDir,
        HASH_A,
        signTreeHash({ treeHash: HASH_A, key: generateKeyPair() }),
      );
    }
    assert.strictEqual((await readEnvelope(storeDir, HASH_A))!.signatures.length, 3);
  });

  // L10: the endorsement is about bytes, so a fork that changed nothing
  // inherits it, and a fork that changed something does not.
  test('a fork at the same treeHash inherits every signature', async function (assert) {
    let bytes = pack(lib('export const v = 1;\n'));
    await publishToStore(storeDir, 'acme/lib', '1.0.0', bytes);
    await publishToStore(storeDir, 'you/lib', '1.0.0', bytes);
    let { unpack } = await import('../src/pack.ts');
    let treeHash = unpack(bytes).treeHash;
    await appendSignature(
      storeDir,
      treeHash,
      signTreeHash({ treeHash, key: generateKeyPair(), publisher: 'acme' }),
    );
    // Nothing was done for `you/lib` at all; it is the same tree.
    assert.strictEqual(
      summarizeEnvelope(treeHash, await readEnvelope(storeDir, treeHash)).length,
      1,
      'the fork sees the endorsement',
    );
  });

  test('changing one byte loses the endorsement', async function (assert) {
    let { unpack } = await import('../src/pack.ts');
    let original = unpack(pack(lib('export const v = 1;\n'))).treeHash;
    let edited = unpack(pack(lib('export const v = 2;\n'))).treeHash;
    await appendSignature(
      storeDir,
      original,
      signTreeHash({ treeHash: original, key: generateKeyPair() }),
    );
    assert.strictEqual(
      summarizeEnvelope(edited, await readEnvelope(storeDir, edited)).length,
      0,
      'a changed tree carries no endorsement',
    );
  });
});

module('the local keyring', function (hooks) {
  let dir: string;
  hooks.beforeEach(async function () {
    dir = await mkdtemp(join(tmpdir(), 'deck-keyring-'));
  });
  hooks.afterEach(async function () {
    await rm(dir, { recursive: true, force: true });
  });

  test('a key is created, listed and resolved', async function (assert) {
    let created = await createKey({ dir, label: 'ci' });
    assert.true(created.keyId.startsWith('deck:local:ci:'));
    assert.deepEqual(
      (await listKeys(dir)).map((key) => key.keyId),
      [created.keyId],
    );
    assert.strictEqual((await resolveKey({ dir })).keyId, created.keyId);
  });

  test('the private key is not world-readable', async function (assert) {
    await createKey({ dir });
    let [name] = await readdir(dir);
    let mode = (await stat(join(dir, name))).mode & 0o777;
    assert.strictEqual(mode, 0o600, `mode was ${mode.toString(8)}`);
    let text = await readFile(join(dir, name), 'utf8');
    assert.true(text.includes('privateKey'), 'sanity: it holds a private key');
  });

  test('two keys and no --key is an error, not a guess', async function (assert) {
    await createKey({ dir, label: 'a' });
    await createKey({ dir, label: 'b' });
    await assert.rejects(resolveKey({ dir }), /name one with --key/);
    let picked = await resolveKey({ dir, keyId: 'a' });
    assert.true(picked.keyId.includes(':a:'));
  });

  test('an empty keyring says what to do', async function (assert) {
    await assert.rejects(resolveKey({ dir }), /deck keygen/);
  });
});
