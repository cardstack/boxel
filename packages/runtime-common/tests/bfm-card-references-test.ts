import type { SharedTests } from '../helpers/index.ts';
import { cardTypeName } from '../bfm-card-references.ts';

const tests = Object.freeze({
  'cardTypeName extracts type from absolute URL': async (assert) => {
    assert.strictEqual(
      cardTypeName('https://example.com/Pet/a3b2c1d4-e5f6'),
      'Pet',
    );
  },

  'cardTypeName extracts type from relative path': async (assert) => {
    assert.strictEqual(cardTypeName('./Author/jane-doe'), 'Author');
  },

  'cardTypeName strips .json extension before extracting': async (assert) => {
    assert.strictEqual(cardTypeName('./BlogPost/some-id.json'), 'BlogPost');
  },

  'cardTypeName strips trailing slash': async (assert) => {
    assert.strictEqual(cardTypeName('https://example.com/Pet/mango/'), 'Pet');
  },

  'cardTypeName returns single segment as type name': async (assert) => {
    assert.strictEqual(cardTypeName('./Foo'), 'Foo');
  },

  'cardTypeName returns Card for empty string': async (assert) => {
    assert.strictEqual(cardTypeName(''), 'Card');
  },

  'cardTypeName handles deeply nested URLs': async (assert) => {
    assert.strictEqual(
      cardTypeName('https://example.com/realm/nested/Pet/some-uuid'),
      'Pet',
    );
  },

  'cardTypeName filters out .. segments in relative paths': async (assert) => {
    assert.strictEqual(cardTypeName('../Pet/some-id'), 'Pet');
  },

  'cardTypeName returns last segment for relative .. with single name': async (
    assert,
  ) => {
    assert.strictEqual(cardTypeName('../Pet'), 'Pet');
  },

  'cardTypeName strips query string from URL': async (assert) => {
    assert.strictEqual(cardTypeName('https://example.com/Pet/abc?v=1'), 'Pet');
  },

  'cardTypeName strips fragment from URL': async (assert) => {
    assert.strictEqual(
      cardTypeName('https://example.com/Pet/abc#section'),
      'Pet',
    );
  },

  'cardTypeName handles absolute URL with single path segment': async (
    assert,
  ) => {
    assert.strictEqual(cardTypeName('https://example.com/Pet'), 'Pet');
  },
} as SharedTests<{}>);

export default tests;
