import {
  deriveRealmName,
  resolvePublishedRealmUrl,
} from '../published-realm-url.ts';
import type { SharedTests } from '../helpers/index.ts';

const tests = Object.freeze({
  // deriveRealmName
  'deriveRealmName returns the last path segment, lowercased': async (
    assert,
  ) => {
    assert.strictEqual(
      deriveRealmName('https://realms.example/mike/Game-Mechanics/'),
      'game-mechanics',
    );
  },

  'deriveRealmName ignores a missing trailing slash': async (assert) => {
    assert.strictEqual(
      deriveRealmName('https://realms.example/mike/notes'),
      'notes',
    );
  },

  'deriveRealmName throws when there is no path segment': async (assert) => {
    assert.throws(
      () => deriveRealmName('https://realms.example/'),
      /Could not extract realm name/,
    );
  },

  'deriveRealmName throws on an unparseable URL': async (assert) => {
    assert.throws(() => deriveRealmName('not a url'), /Failed to parse/);
  },

  // resolvePublishedRealmUrl — subdirectory
  'subdirectory builds a Boxel Space URL from username, domain, and name':
    async (assert) => {
      assert.strictEqual(
        resolvePublishedRealmUrl(
          { type: 'subdirectory', name: 'game-mechanics' },
          { matrixUsername: 'mike', spaceDomain: 'boxel.space' },
        ),
        'https://mike.boxel.space/game-mechanics/',
      );
    },

  'subdirectory lowercases the provided name': async (assert) => {
    assert.strictEqual(
      resolvePublishedRealmUrl(
        { type: 'subdirectory', name: 'Game-Mechanics' },
        { matrixUsername: 'mike', spaceDomain: 'boxel.space' },
      ),
      'https://mike.boxel.space/game-mechanics/',
    );
  },

  'subdirectory derives the name from sourceRealmURL when blank': async (
    assert,
  ) => {
    assert.strictEqual(
      resolvePublishedRealmUrl(
        { type: 'subdirectory' },
        {
          matrixUsername: 'mike',
          spaceDomain: 'boxel.space',
          sourceRealmURL: 'https://realms.example/mike/Notes/',
        },
      ),
      'https://mike.boxel.space/notes/',
    );
  },

  'subdirectory honors a custom protocol': async (assert) => {
    assert.strictEqual(
      resolvePublishedRealmUrl(
        { type: 'subdirectory', name: 'notes' },
        {
          matrixUsername: 'mike',
          spaceDomain: 'boxel.space',
          protocol: 'http',
        },
      ),
      'http://mike.boxel.space/notes/',
    );
  },

  'subdirectory throws when name is blank and no sourceRealmURL is given':
    async (assert) => {
      assert.throws(
        () =>
          resolvePublishedRealmUrl(
            { type: 'subdirectory' },
            { matrixUsername: 'mike', spaceDomain: 'boxel.space' },
          ),
        /requires either `name` or a `sourceRealmURL`/,
      );
    },

  'subdirectory throws when matrixUsername is missing': async (assert) => {
    assert.throws(
      () =>
        resolvePublishedRealmUrl(
          { type: 'subdirectory', name: 'notes' },
          { spaceDomain: 'boxel.space' },
        ),
      /requires `matrixUsername`/,
    );
  },

  'subdirectory throws when spaceDomain is missing': async (assert) => {
    assert.throws(
      () =>
        resolvePublishedRealmUrl(
          { type: 'subdirectory', name: 'notes' },
          { matrixUsername: 'mike' },
        ),
      /requires `spaceDomain`/,
    );
  },

  // resolvePublishedRealmUrl — custom
  'custom builds a URL from a bare hostname': async (assert) => {
    assert.strictEqual(
      resolvePublishedRealmUrl({ type: 'custom', name: 'mysite.boxel.site' }),
      'https://mysite.boxel.site/',
    );
  },

  'custom preserves a port in the hostname': async (assert) => {
    assert.strictEqual(
      resolvePublishedRealmUrl({
        type: 'custom',
        name: 'mysite.localhost:4201',
      }),
      'https://mysite.localhost:4201/',
    );
  },

  'custom strips a leading protocol and trailing slash': async (assert) => {
    assert.strictEqual(
      resolvePublishedRealmUrl({
        type: 'custom',
        name: 'https://mysite.boxel.site/',
      }),
      'https://mysite.boxel.site/',
    );
  },

  'custom throws when the hostname is blank': async (assert) => {
    assert.throws(
      () => resolvePublishedRealmUrl({ type: 'custom', name: '' }),
      /requires a hostname/,
    );
  },

  'custom rejects a hostname that includes a path': async (assert) => {
    assert.throws(
      () =>
        resolvePublishedRealmUrl({
          type: 'custom',
          name: 'mysite.boxel.site/foo',
        }),
      /path, query, or fragment/,
    );
  },

  'custom rejects a hostname that includes credentials': async (assert) => {
    assert.throws(
      () =>
        resolvePublishedRealmUrl({
          type: 'custom',
          name: 'user:pass@mysite.boxel.site',
        }),
      /must not include credentials/,
    );
  },

  'custom rejects a hostname that includes a query or fragment': async (
    assert,
  ) => {
    assert.throws(
      () =>
        resolvePublishedRealmUrl({
          type: 'custom',
          name: 'mysite.boxel.site?a=1',
        }),
      /path, query, or fragment/,
    );
    assert.throws(
      () =>
        resolvePublishedRealmUrl({
          type: 'custom',
          name: 'mysite.boxel.site#frag',
        }),
      /path, query, or fragment/,
    );
  },

  'custom normalizes an accidental protocol passed in ctx': async (assert) => {
    assert.strictEqual(
      resolvePublishedRealmUrl(
        { type: 'custom', name: 'mysite.boxel.site' },
        { protocol: 'https://' },
      ),
      'https://mysite.boxel.site/',
    );
  },

  'throws on an unknown target type': async (assert) => {
    assert.throws(
      () =>
        resolvePublishedRealmUrl({
          // @ts-expect-error intentionally invalid type
          type: 'bogus',
          name: 'x',
        }),
      /Unknown publish target type/,
    );
  },
} as SharedTests<Record<string, never>>);

export default tests;
