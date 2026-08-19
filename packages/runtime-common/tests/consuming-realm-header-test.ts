import type { SharedTests } from '../helpers/index.ts';
import { sanitizeConsumingRealmHeader } from '../prerender-headers.ts';

const tests = Object.freeze({
  'accepts a plain http realm URL': async (assert) => {
    assert.strictEqual(
      sanitizeConsumingRealmHeader('http://localhost:4201/test/'),
      'http://localhost:4201/test/',
    );
  },

  'accepts a plain https realm URL': async (assert) => {
    assert.strictEqual(
      sanitizeConsumingRealmHeader('https://cardstack.com/base/'),
      'https://cardstack.com/base/',
    );
  },

  'trims surrounding whitespace': async (assert) => {
    assert.strictEqual(
      sanitizeConsumingRealmHeader('  http://localhost:4201/test/  '),
      'http://localhost:4201/test/',
    );
  },

  'rejects non-http(s) schemes': async (assert) => {
    assert.strictEqual(
      sanitizeConsumingRealmHeader('file:///etc/passwd'),
      null,
    );
    assert.strictEqual(sanitizeConsumingRealmHeader('ftp://x/'), null);
    assert.strictEqual(
      sanitizeConsumingRealmHeader('javascript:alert(1)'),
      null,
    );
  },

  'rejects empty / whitespace-only / null values': async (assert) => {
    assert.strictEqual(sanitizeConsumingRealmHeader(''), null);
    assert.strictEqual(sanitizeConsumingRealmHeader('   '), null);
    assert.strictEqual(sanitizeConsumingRealmHeader(null), null);
    assert.strictEqual(sanitizeConsumingRealmHeader(undefined), null);
  },

  'rejects values containing control characters': async (assert) => {
    // CR/LF/whitespace inside the URL would let a malicious caller
    // inject newlines into log lines.
    assert.strictEqual(
      sanitizeConsumingRealmHeader('http://x/\r\nInjected: header'),
      null,
    );
    assert.strictEqual(
      sanitizeConsumingRealmHeader('http://example.com/with space/'),
      null,
    );
    assert.strictEqual(sanitizeConsumingRealmHeader('http://x/\ttab'), null);
  },

  'rejects pathologically long values': async (assert) => {
    let long = 'http://x/' + 'a'.repeat(3000);
    assert.strictEqual(sanitizeConsumingRealmHeader(long), null);
  },

  'rejects non-string inputs': async (assert) => {
    assert.strictEqual(
      sanitizeConsumingRealmHeader(42 as unknown as string),
      null,
    );
    assert.strictEqual(
      sanitizeConsumingRealmHeader({} as unknown as string),
      null,
    );
    assert.strictEqual(
      sanitizeConsumingRealmHeader(['http://x/'] as unknown as string),
      null,
    );
  },
} as SharedTests<{}>);

export default tests;
