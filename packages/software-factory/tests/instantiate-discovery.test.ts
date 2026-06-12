import { module, test } from 'qunit';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { discoverRealmSpecs } from '../src/instantiate-execution.ts';

const REALM = 'https://realms.example.test/user/target/';

function specCard(
  id: string,
  specType: string | undefined,
  refName: string,
): Record<string, unknown> {
  return {
    id: `${REALM}Spec/${id}`,
    attributes: {
      ...(specType ? { specType } : {}),
      ref: { module: '../my-module', name: refName },
    },
    relationships: {},
  };
}

function clientReturning(cards: Record<string, unknown>[]): BoxelCLIClient {
  return {
    search: async () => ({ ok: true, data: cards }),
  } as unknown as BoxelCLIClient;
}

module('discoverRealmSpecs', function () {
  test('only card and app specs survive discovery; other specTypes are skipped', async function (assert) {
    let { specs, error } = await discoverRealmSpecs({
      targetRealm: REALM,
      client: clientReturning([
        specCard('card-spec', 'card', 'MyCard'),
        specCard('app-spec', 'app', 'MyApp'),
        specCard('field-spec', 'field', 'MyField'),
        specCard('component-spec', 'component', 'ChartComponent'),
        specCard('command-spec', 'command', 'formatChartLabel'),
        specCard('typeless-spec', undefined, 'Mystery'),
      ]),
    });

    assert.strictEqual(error, undefined);
    assert.deepEqual(specs.map((s) => s.cardName).sort(), ['MyApp', 'MyCard']);
  });

  test('a realm with only non-instantiable Specs returns immediately instead of polling', async function (assert) {
    let searchCalls = 0;
    let client = {
      search: async () => {
        searchCalls++;
        return {
          ok: true,
          data: [
            specCard('component-spec', 'component', 'ChartComponent'),
            specCard('command-spec', 'command', 'formatChartLabel'),
          ],
        };
      },
    } as unknown as BoxelCLIClient;

    let { specs, error, totalSpecCards } = await discoverRealmSpecs({
      targetRealm: REALM,
      client,
    });

    assert.strictEqual(error, undefined);
    assert.deepEqual(specs, []);
    assert.strictEqual(totalSpecCards, 2);
    assert.strictEqual(
      searchCalls,
      1,
      'Spec cards were found and filtered — the index is current, so no poll',
    );
  });
});
