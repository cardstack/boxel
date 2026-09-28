import { uint8ArrayToBase64 } from '../base64.ts';
import type { SharedTests } from '../helpers/index.ts';

// Byte-for-byte reference: Node's Buffer is the source of truth the helper's
// Buffer fast path delegates to, so the assertions below also pin the shape of
// the base64 the btoa fallback must reproduce.
function expected(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

// Run the helper with `globalThis.Buffer` removed so the btoa-fallback branch
// executes even in Node (where Buffer always exists). Restores it afterward.
function withoutBuffer<T>(fn: () => T): T {
  let saved = (globalThis as any).Buffer;
  delete (globalThis as any).Buffer;
  try {
    return fn();
  } finally {
    (globalThis as any).Buffer = saved;
  }
}

const tests = Object.freeze({
  'encodes an empty array': async (assert) => {
    assert.strictEqual(uint8ArrayToBase64(new Uint8Array([])), '');
  },

  'encodes bytes including the high range via the Buffer path': async (
    assert,
  ) => {
    let bytes = new Uint8Array([0, 1, 2, 3, 255, 254, 253]);
    assert.strictEqual(uint8ArrayToBase64(bytes), expected(bytes));
  },

  'the btoa fallback matches the Buffer path': async (assert) => {
    let bytes = new Uint8Array([0, 1, 2, 3, 255, 254, 253]);
    assert.strictEqual(
      withoutBuffer(() => uint8ArrayToBase64(bytes)),
      expected(bytes),
    );
  },

  'the btoa fallback chunks past String.fromCharCode argument limits': async (
    assert,
  ) => {
    // Larger than the 0x8000 chunk and well past the argument count that a
    // single String.fromCharCode(...bytes) spread would throw on — the case
    // the chunked loop exists to handle.
    let bytes = new Uint8Array(200_000);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = i % 256;
    }
    assert.strictEqual(
      withoutBuffer(() => uint8ArrayToBase64(bytes)),
      expected(bytes),
    );
  },

  'the btoa fallback handles a length on a chunk boundary': async (assert) => {
    let bytes = new Uint8Array(0x8000 * 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (i * 7) % 256;
    }
    assert.strictEqual(
      withoutBuffer(() => uint8ArrayToBase64(bytes)),
      expected(bytes),
    );
  },
} as SharedTests<{}>);

export default tests;
