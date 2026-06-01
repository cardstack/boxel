import { iconNotFoundMessage } from '../error';
import type { SharedTests } from '../helpers';

const PROD = 'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons';
const LOCAL = 'http://localhost:4206/@cardstack/boxel-icons/v1/icons';

const tests = Object.freeze({
  'translates a 403 from the production icon CDN': async (assert) => {
    assert.strictEqual(
      iconNotFoundMessage(`${PROD}/person-circle.js`, 403),
      'Icon "person-circle" was not found in @cardstack/boxel-icons. Check the import path against the available icons.',
    );
  },

  'translates a 404 from the local icons server': async (assert) => {
    assert.strictEqual(
      iconNotFoundMessage(`${LOCAL}/person-circle.js`, 404),
      'Icon "person-circle" was not found in @cardstack/boxel-icons. Check the import path against the available icons.',
    );
  },

  'ignores statuses other than 403/404': async (assert) => {
    assert.strictEqual(
      iconNotFoundMessage(`${PROD}/person-circle.js`, 500),
      undefined,
    );
  },

  'ignores non-icon module URLs': async (assert) => {
    assert.strictEqual(
      iconNotFoundMessage('https://example.com/some/module.js', 403),
      undefined,
    );
  },

  'ignores icon-path requests that are not .js modules': async (assert) => {
    // The meta manifest lives on the same CDN but is not an icon module.
    assert.strictEqual(
      iconNotFoundMessage(`${PROD}/../boxel-icons-meta.js`, 403),
      // normalized URL drops the icons/ segment, so no match
      undefined,
    );
    assert.strictEqual(
      iconNotFoundMessage(`${PROD}/person-circle`, 403),
      undefined,
    );
  },

  'ignores an empty icon name': async (assert) => {
    assert.strictEqual(iconNotFoundMessage(`${PROD}/.js`, 403), undefined);
  },

  'ignores an unparseable URL': async (assert) => {
    assert.strictEqual(iconNotFoundMessage('not a url', 403), undefined);
  },
} as SharedTests<{}>);

export default tests;
