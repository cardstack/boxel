import { resolve } from 'node:path';

import { expect, test } from './fixtures.ts';

import { buildTestClient } from './helpers/test-client.ts';

const fixtureRealmDir = resolve(
  process.cwd(),
  'test-fixtures',
  'test-realm-runner',
);

// A minimal .gts card module with an isolated template, so transpilation
// produces template-factory output that is obviously distinct from source.
const SOURCE_GTS = `import {
  CardDef,
  field,
  contains,
  Component,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class TranspiledCheck extends CardDef {
  static displayName = 'Transpiled Check';
  @field label = contains(StringField);

  static isolated = class Isolated extends Component<typeof TranspiledCheck> {
    <template>
      <div data-test-label>{{@model.label}}</div>
    </template>
  };
}
`;

test.use({ realmDir: fixtureRealmDir });
test.use({ realmServerMode: 'isolated' });

test.describe('transpiled module fetch', () => {
  test('reads transpiled module output via Accept */*', async ({ realm }) => {
    let realmUrl = realm.realmURL.href;
    let authHeaders = realm.authorizationHeaders();
    let authorization = authHeaders['Authorization'];

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: authorization,
      realmServerUrl: realm.realmServerURL.href,
      realmServerToken: `Bearer ${realm.serverToken}`,
    });

    try {
      // Write the source .gts to the realm.
      let writeResult = await client.write(
        realmUrl,
        'transpiled-check.gts',
        SOURCE_GTS,
      );
      expect(writeResult.ok).toBe(true);

      // Wait for the realm to finish indexing the module.
      let indexed = await client.waitForFile(realmUrl, 'transpiled-check.gts', {
        pollMs: 300,
        timeoutMs: 30_000,
      });
      expect(indexed).toBe(true);

      // Fetch the transpiled output using the path WITH the .gts extension.
      // The realm accepts either form (with or without extension).
      let withExt = await client.readTranspiled(
        realmUrl,
        'transpiled-check.gts',
      );
      expect(withExt.ok).toBe(true);
      expect(withExt.status).toBe(200);
      expect(withExt.content).toBeTruthy();
      expect(withExt.content!.length).toBeGreaterThan(0);

      // The transpiled output must differ from the literal source — the realm
      // really compiled the .gts template. We don't pin the exact bytes,
      // just assert it's been rewritten.
      expect(withExt.content).not.toBe(SOURCE_GTS);

      // Pin ONE stable transpilation marker that raw .gts never contains.
      // `setComponentTemplate(` is emitted by the Ember template compiler for
      // every component that uses <template>, so it's a reliable signal.
      expect(withExt.content).toContain('setComponentTemplate(');

      // Also call with the path-WITHOUT-extension variant — the realm
      // accepts both forms and returns the same transpiled output.
      let withoutExt = await client.readTranspiled(
        realmUrl,
        'transpiled-check',
      );
      expect(withoutExt.ok).toBe(true);
      expect(withoutExt.status).toBe(200);
      expect(withoutExt.content).toBe(withExt.content);
    } finally {
      cleanup();
    }
  });
});
