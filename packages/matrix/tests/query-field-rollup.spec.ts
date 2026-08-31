import { test, expect } from './fixtures.ts';
import { appURL } from '../support/isolated-realm-server.ts';
import {
  createRealm,
  postCardSource,
  postNewCard,
  patchCardInstance,
  createSubscribedUserAndLogin,
} from '../helpers/index.ts';

// A rollup over a query-backed relationship is resolved on the client: the
// index never refreshes it, because a card the query merely matched is not a
// dependency of the card holding the query. What keeps it current is the
// field's own search resource — its seed, and the realm events it subscribes
// to.
//
// The case exercised here is the one the subscription cannot cover: the client
// misses the write. The rollup is then only as good as the next document the
// realm hands over, which carries the field resolved as of that read. Blocking
// search for the rest of the test removes every other way the number could
// become correct, so the assertion has one explanation.
test.describe('Query-backed rollups', () => {
  const serverIndexUrl = new URL(appURL).origin;
  const realmName = 'realm1';

  test('a newer card document corrects a rollup that no search can', async ({
    page,
  }) => {
    let { username } = await createSubscribedUserAndLogin(
      page,
      'subscriber',
      serverIndexUrl,
    );
    const realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;
    await createRealm(page, realmName);

    await postCardSource(
      page,
      realmURL,
      'rollup.gts',
      `
      import { CardDef, field, contains, linksToMany, StringField, Component } from '@cardstack/base/card-api';
      import NumberField from '@cardstack/base/number';

      export class Leaf extends CardDef {
        @field group = contains(StringField);
      }

      export class Parent extends CardDef {
        @field groupName = contains(StringField);
        @field myLeaves = linksToMany(() => Leaf, {
          query: {
            filter: { eq: { group: '$this.groupName' } },
            page: { size: 50 },
          },
        });
        @field leafCount = contains(NumberField, {
          computeVia: function (this: Parent) {
            return (this.myLeaves ?? []).length;
          },
        });
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <span data-test-leaf-count>{{@model.leafCount}}</span>
          </template>
        };
      }`,
    );

    let newLeaf = async () =>
      await postNewCard(page, realmURL, {
        data: {
          type: 'card',
          attributes: { group: 'alpha' },
          meta: { adoptsFrom: { module: '../rollup', name: 'Leaf' } },
        },
      });

    let parentURL = await postNewCard(page, realmURL, {
      data: {
        type: 'card',
        attributes: { groupName: 'alpha' },
        meta: { adoptsFrom: { module: '../rollup', name: 'Parent' } },
      },
    });
    await newLeaf();

    await page.goto(parentURL);
    await expect(page.locator('[data-test-leaf-count]')).toHaveText('1');

    // No search succeeds past this point, so the only thing that can still
    // change the rollup is a document the realm hands over.
    await page.route('**/_search*', (route) => route.abort());
    await page.route('**/_federated-search*', (route) => route.abort());

    await newLeaf();
    await expect(page.locator('[data-test-leaf-count]')).toHaveText('1');

    // Reindexing the parent for an unrelated reason is enough: the document the
    // client refetches carries `myLeaves` resolved as of that read.
    await patchCardInstance(page, realmURL, parentURL, {
      data: {
        type: 'card',
        attributes: { groupName: 'alpha', title: 'Alpha group' },
        meta: { adoptsFrom: { module: '../rollup', name: 'Parent' } },
      },
    });

    await expect(page.locator('[data-test-leaf-count]')).toHaveText('2');
  });
});
