import { getOwner } from '@ember/owner';
import { render } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { Stat } from '@cardstack/pretui/components/stat';
import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { Query } from '@cardstack/runtime-common';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRRI,
} from '../../helpers';
import {
  CardDef,
  contains,
  field,
  StringField,
  setupBaseRealm,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | search resource | render', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    class Book extends CardDef {
      static displayName = 'Book';
      @field title = contains(StringField);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      contents: {
        'book.gts': { Book },
        'books/1.json': new Book({ title: 'Mango' }),
        'books/2.json': new Book({ title: 'Van Gogh' }),
        'books/3.json': new Book({ title: 'Ringo' }),
      },
    });
  });

  test('a live search count feeds a rolling Stat while the resource re-runs mid-render', async function (assert) {
    let store = getService('store');
    let query: Query = {
      filter: { type: { module: testRRI('book'), name: 'Book' } },
    };
    let rerunCount = 0;

    class LiveBookCount extends GlimmerComponent {
      books = store.getSearchResource(
        this,
        () => query,
        () => [testRealmURL],
        { isLive: true },
      );

      // The resource manager re-runs `modify` on the first read of the
      // resource after any input it consumed has changed, with arguments that
      // may well equal the ones it already holds. Doing that here, between two
      // reads of the resource in one render, is the situation a component
      // meets when it reads its argument more than once per render — the
      // rolling Stat below reads its value several times.
      get rerunWithUnchangedArgs() {
        rerunCount++;
        this.books.modify([], {
          query: structuredClone(query),
          realms: [testRealmURL],
          isLive: true,
          storeService: store,
          owner: getOwner(this)!,
        });
        return '';
      }

      // Grouping by realm reads the realms the resource searches, so the
      // re-run below meets them already used in this render.
      <template>
        <span data-test-realm-groups>
          {{this.books.instancesByRealm.length}}
        </span>
        {{this.rerunWithUnchangedArgs}}
        <Stat @label='Books' @value={{this.books.instances.length}} />
      </template>
    }

    await render(<template><LiveBookCount /></template>);

    assert.ok(rerunCount > 0, 'the resource re-ran inside a render');
    assert
      .dom('[data-test-pretui-stat] .pretui-odo-sr')
      .hasText('3', 'the Stat rolls to the live search count');
  });
});
