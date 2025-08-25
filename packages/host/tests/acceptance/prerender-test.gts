import { visit, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

module('Acceptance | prerender', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });

  async function captureResult(
    capture: 'textContent' | 'innerHTML' | 'outerHTML',
    expectedStatus: 'ready' | 'error' = 'ready',
  ): Promise<{ status: 'ready' | 'error'; value: string }> {
    await waitFor(`[data-prerender-status="${expectedStatus}"]`);
    let element = document.querySelector('[data-prerender]') as HTMLElement;
    let status = element.dataset.prerenderStatus as 'ready' | 'error';
    if (status === 'error') {
      return { status, value: element.innerHTML! };
    } else {
      return { status, value: element.children[0][capture]! };
    }
  }

  hooks.beforeEach(async function () {
    let loader = getService('loader-service').loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    cardApi = await loader.import(`${baseRealm.url}card-api`);

    let {
      field,
      contains,
      containsMany,
      linksTo,
      linksToMany,
      CardDef,
      StringField,
    } = cardApi;

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field petFriend = linksTo(() => Pet);
      @field title = contains(StringField, {
        computeVia(this: Pet) {
          return `${this.name}`;
        },
      });
    }

    class Cat extends Pet {
      static displayName = 'Cat';
      @field aliases = containsMany(StringField);
    }

    class Person extends CardDef {
      static displayName = 'Person';
      @field name = contains(StringField);
      @field pets = linksToMany(() => Pet);
      @field title = contains(StringField, {
        computeVia(this: Person) {
          return this.name;
        },
      });
    }

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
        'pet.gts': { Pet },
        'cat.gts': { Cat },
        'Pet/mango.json': {
          data: {
            attributes: { name: 'Mango' },
            relationships: {
              petFriend: {
                links: {
                  self: './vangogh',
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: '../pet',
                name: 'Pet',
              },
            },
          },
        },
        'Pet/vangogh.json': {
          data: {
            attributes: { name: 'Van Gogh' },
            meta: {
              adoptsFrom: {
                module: '../pet',
                name: 'Pet',
              },
            },
          },
        },
        'Cat/paper.json': {
          data: {
            attributes: {
              name: 'Paper',
              aliases: ['Satan', "Satan's Mistress"],
            },
            meta: {
              adoptsFrom: {
                module: '../cat',
                name: 'Cat',
              },
            },
          },
        },
        'Person/hassan.json': {
          data: {
            attributes: {
              name: 'Hassan',
            },
            relationships: {
              'pets.0': {
                links: {
                  self: '../Pet/mango',
                },
              },
              'pets.1': {
                links: {
                  self: '../Pet/vangogh',
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: '../person',
                name: 'Person',
              },
            },
          },
        },
      },
    });
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__lazilyLoadLinks;
  });

  test('can prerender instance with contains field', async function (assert) {
    let url = `${testRealmURL}Pet/vangogh.json`;
    await visit(`/render/${encodeURIComponent(url)}/html/isolated/0`);
    let { value } = await captureResult('innerHTML');
    assert.ok(
      /data-test-field="name"?.*Van Gogh/s.test(value),
      'failed to find "Van Gogh" field value in isolated HTML',
    );
  });

  test('can prerender instance with containsMany field', async function (assert) {
    let url = `${testRealmURL}Cat/paper.json`;
    await visit(`/render/${encodeURIComponent(url)}/html/isolated/0`);
    let { value } = await captureResult('innerHTML');
    assert.ok(
      /data-test-field="aliases"?.*Satan?.*Satan's Mistress/s.test(value),
      `failed to find "Satan" and "Satan's Mistress" field value in isolated HTML`,
    );
  });

  test('can prerender instance with linksTo field', async function (assert) {
    let url = `${testRealmURL}Pet/mango.json`;
    await visit(`/render/${encodeURIComponent(url)}/html/isolated/0`);
    let { value } = await captureResult('innerHTML');
    assert.ok(
      /data-test-field="petFriend"?.*Van Gogh/s.test(value),
      'failed to find "Van Gogh" field value in isolated HTML',
    );
  });

  test('can prerender instance with linksToMany field', async function (assert) {
    let url = `${testRealmURL}Person/hassan.json`;
    await visit(`/render/${encodeURIComponent(url)}/html/isolated/0`);
    let { value } = await captureResult('innerHTML');
    assert.ok(
      /data-test-field="pets"?.*Mango?.*Van Gogh/s.test(value),
      'failed to find "Mango" and "Van Gogh" field values in isolated HTML',
    );
  });

  // TODO test prerender compound contains field
  // TODO test prerender compound containsMany field
  // TODO test prerender compound contains field that includes a linksTo field
  // TODO test prerender compound containsMany that includes a linksTo field
  // TODO test prerender missing link in linksTo field
  // TODO test prerender missing link in linksToMany field
  // TODO test prerender computed that consumes linksTo
  // TODO test prerender computed that consumes linksToMany
  // TODO test prerender missing link in computed that consumes linksTo
  // TODO test prerender missing link in computed that consumes linksToMany
  // TODO test prerender linksTo cycle
  // TODO test prerender linksToMany cycle
  // TODO make tests for search docs. use existing search doc tests as the template
});
