import type { SharedTests } from '../helpers';
import {
  commandUrlToCodeRef,
  parseBoxelHostCommandSpecifier,
} from '../command-parsing-utils';

const tests = Object.freeze({
  'parseBoxelHostCommandSpecifier parses scoped command specifier': async (
    assert,
  ) => {
    assert.deepEqual(
      parseBoxelHostCommandSpecifier(
        '@cardstack/boxel-host/commands/show-card/default',
      ),
      {
        module: '@cardstack/boxel-host/commands/show-card',
        name: 'default',
      },
    );
  },

  'parseBoxelHostCommandSpecifier rejects unscoped command specifier': async (
    assert,
  ) => {
    assert.strictEqual(
      parseBoxelHostCommandSpecifier(
        'cardstack/boxel-host/commands/show-card/execute',
      ),
      undefined,
    );
  },

  'parseBoxelHostCommandSpecifier rejects specifier without export name':
    async (assert) => {
      assert.strictEqual(
        parseBoxelHostCommandSpecifier(
          'cardstack/boxel-host/commands/show-card',
        ),
        undefined,
      );
    },

  'parseBoxelHostCommandSpecifier rejects query/hash forms': async (assert) => {
    assert.strictEqual(
      parseBoxelHostCommandSpecifier(
        '@cardstack/boxel-host/commands/show-card/default?foo=bar',
      ),
      undefined,
    );
    assert.strictEqual(
      parseBoxelHostCommandSpecifier(
        '@cardstack/boxel-host/commands/show-card/default#main',
      ),
      undefined,
    );
  },

  'requires explicit export for cardstack/boxel-host command specifier': async (
    assert,
  ) => {
    assert.strictEqual(
      commandUrlToCodeRef('cardstack/boxel-host/commands/show-card', undefined),
      undefined,
    );
  },

  'parses cardstack/boxel-host command specifier with explicit export': async (
    assert,
  ) => {
    assert.deepEqual(
      commandUrlToCodeRef(
        '@cardstack/boxel-host/commands/show-card/execute',
        undefined,
      ),
      {
        module: '@cardstack/boxel-host/commands/show-card',
        name: 'execute',
      },
    );
  },

  'parses absolute /commands URL into realm code ref': async (assert) => {
    assert.deepEqual(
      commandUrlToCodeRef(
        'http://localhost:4200/commands/create-listing-pr/default',
        'http://localhost:4201/test/',
      ),
      {
        module: 'http://localhost:4201/test/commands/create-listing-pr',
        name: 'default',
      },
    );
  },

  'parses absolute /commands URL without export into default export': async (
    assert,
  ) => {
    assert.deepEqual(
      commandUrlToCodeRef(
        'http://localhost:4200/commands/create-listing-pr',
        'http://localhost:4201/test/',
      ),
      {
        module: 'http://localhost:4201/test/commands/create-listing-pr',
        name: 'default',
      },
    );
  },

  'rejects nested /commands paths': async (assert) => {
    assert.strictEqual(
      commandUrlToCodeRef(
        'http://localhost:4200/commands/../../admin/commands/dangerous/action',
        'http://localhost:4201/test/',
      ),
      undefined,
    );
  },

  'rejects traversal-like command segments': async (assert) => {
    assert.strictEqual(
      commandUrlToCodeRef(
        'http://localhost:4200/commands/%2E%2E/default',
        'http://localhost:4201/test/',
      ),
      undefined,
    );
    assert.strictEqual(
      commandUrlToCodeRef(
        'http://localhost:4200/commands/create-listing-pr/%2E%2E',
        'http://localhost:4201/test/',
      ),
      undefined,
    );
  },

  'rejects extra path segments beyond command and export': async (assert) => {
    assert.strictEqual(
      commandUrlToCodeRef(
        'http://localhost:4200/commands/create-listing-pr/default/extra',
        'http://localhost:4201/test/',
      ),
      undefined,
    );
  },

  'returns undefined for unknown command formats': async (assert) => {
    assert.strictEqual(
      commandUrlToCodeRef(
        'https://example.com/not-commands/create-listing-pr',
        'http://localhost:4201/test/',
      ),
      undefined,
    );
  },
} as SharedTests<{}>);

export default tests;
