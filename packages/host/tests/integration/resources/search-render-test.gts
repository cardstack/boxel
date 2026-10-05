import { getOwner } from '@ember/owner';
import { render, settled } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { LooseSingleCardDocument, Query } from '@cardstack/runtime-common';

import type { SearchResource } from '@cardstack/host/resources/search';

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

class Ticker {
  @tracked count = 0;
}

function titlesOf(instances: readonly object[]): string {
  return instances
    .map((card) => (card as { title?: string }).title)
    .filter(Boolean)
    .join(', ');
}

module('Integration | search resource | render', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  const bookRef = { module: testRRI('book'), name: 'Book' };
  const byTitle: Query['sort'] = [{ by: 'title', on: bookRef }];

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

  // A live search read twice in one render, with `modify` re-run in between
  // on arguments equal to the ones the resource holds. That is where a lazy
  // re-run lands when it falls inside a render: the resource manager re-runs
  // `modify` on the first read of the resource after something `modify` read
  // has been written, so a write partway through a render puts the re-run
  // after reads that render has already made. The first read groups by realm,
  // so it reads the realms the resource searches as well as its result.
  // `ticker` re-renders all three on demand, so a re-run can also land in a
  // render where the result has gone through the client filtering step.
  function liveSearchProbe(
    query: Query,
    { rerunMidRender = true }: { rerunMidRender?: boolean } = {},
  ) {
    let store = getService('store');
    let ticker = new Ticker();
    let resource: SearchResource | undefined;

    class LiveSearchProbe extends GlimmerComponent {
      books = store.getSearchResource(
        this,
        () => query,
        () => [testRealmURL],
        { isLive: true },
      );

      constructor(...args: ConstructorParameters<typeof GlimmerComponent>) {
        super(...args);
        resource = this.books;
      }

      get before() {
        void ticker.count;
        void this.books.instancesByRealm;
        return titlesOf(this.books.instances);
      }

      get rerunWithUnchangedArgs() {
        void ticker.count;
        if (!rerunMidRender) {
          return '';
        }
        this.books.modify([], {
          query: structuredClone(query),
          realms: [testRealmURL],
          isLive: true,
          storeService: store,
          owner: getOwner(this)!,
        });
        return '';
      }

      get after() {
        void ticker.count;
        return titlesOf(this.books.instances);
      }

      <template>
        <span data-test-before>{{this.before}}</span>
        {{this.rerunWithUnchangedArgs}}
        <span data-test-after>{{this.after}}</span>
      </template>
    }

    return {
      LiveSearchProbe,
      ticker,
      resource: () => resource!,
    };
  }

  test('a re-run of modify with unchanged arguments mid-render leaves the result in place', async function (assert) {
    let { LiveSearchProbe, ticker } = liveSearchProbe({
      filter: { type: bookRef },
      sort: byTitle,
    });

    await render(<template><LiveSearchProbe /></template>);
    assert
      .dom('[data-test-before]')
      .hasText('Mango, Ringo, Van Gogh', 'read before the re-run');
    assert
      .dom('[data-test-after]')
      .hasText('Mango, Ringo, Van Gogh', 'read after the re-run');

    ticker.count++;
    await settled();
    assert
      .dom('[data-test-after]')
      .hasText(
        'Mango, Ringo, Van Gogh',
        'a re-run in a render that reads the filtered result leaves it in place',
      );
  });

  test('a re-run of modify with unchanged arguments mid-render leaves a query with no filter in place', async function (assert) {
    let { LiveSearchProbe, ticker } = liveSearchProbe({ sort: byTitle });

    await render(<template><LiveSearchProbe /></template>);
    ticker.count++;
    await settled();
    assert
      .dom('[data-test-before]')
      .hasText('Mango, Ringo, Van Gogh', 'read before the re-run');
    assert
      .dom('[data-test-after]')
      .hasText('Mango, Ringo, Van Gogh', 'read after the re-run');
  });

  test('a re-run of modify with unchanged arguments keeps the client filtering step applied', async function (assert) {
    let { LiveSearchProbe, resource } = liveSearchProbe(
      { filter: { type: bookRef }, sort: byTitle },
      // Only the re-run below, outside any render, so what this checks is the
      // result it leaves rather than a write it makes mid-render.
      { rerunMidRender: false },
    );

    await render(<template><LiveSearchProbe /></template>);

    // In the Store only, so only the client filtering step can add it to the
    // result: the server has never indexed it.
    await getService('store').addWithoutPersisting({
      data: {
        type: 'card',
        id: `${testRealmURL}books/local-only`,
        attributes: { title: 'Austen' },
        meta: { adoptsFrom: bookRef },
      },
    } as LooseSingleCardDocument);
    await settled();
    assert
      .dom('[data-test-after]')
      .hasText(
        'Austen, Mango, Ringo, Van Gogh',
        'the client filtering step adds the card that is only in the Store',
      );

    resource().modify([], {
      query: { filter: { type: bookRef }, sort: byTitle },
      realms: [testRealmURL],
      isLive: true,
      storeService: getService('store'),
      owner: this.owner,
    });
    assert.strictEqual(
      titlesOf(resource().instances),
      'Austen, Mango, Ringo, Van Gogh',
      'right after the re-run, the result still goes through the client filtering step',
    );
  });
});
