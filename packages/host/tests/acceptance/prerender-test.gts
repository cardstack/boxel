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
      // there is a strange <anonymous> tag that is being appended to the innerHTML that this strips out
      return { status, value: element.innerHTML!.replace(/}[^}].*$/, '}') };
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
      @field friends = linksToMany(() => Person);
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
        'Pet/pet-a.json': {
          data: {
            attributes: { name: 'Allen' },
            relationships: {
              petFriend: {
                links: {
                  self: './pet-b',
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
        'Pet/pet-b.json': {
          data: {
            attributes: { name: 'Beatrice' },
            relationships: {
              petFriend: {
                links: {
                  self: './pet-a',
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
        'Cat/molly.json': {
          data: {
            attributes: {
              name: 'Molly',
            },
            relationships: {
              petFriend: {
                links: {
                  self: './missing-link',
                },
              },
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
        'Person/jade.json': {
          data: {
            attributes: {
              name: 'Jade',
            },
            relationships: {
              'pets.0': {
                links: {
                  self: '../Pet/mango',
                },
              },
              'pets.1': {
                links: {
                  self: '../Pet/missing-link',
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
        'Person/germaine.json': {
          data: {
            attributes: {
              name: 'Germaine',
            },
            relationships: {
              'friends.0': {
                links: {
                  self: '../Person/queenzy',
                },
              },
              'friends.1': {
                links: {
                  self: '../Person/hassan',
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
        'Person/queenzy.json': {
          data: {
            attributes: {
              name: 'Queenzy',
            },
            relationships: {
              'friends.0': {
                links: {
                  self: '../Person/germaine',
                },
              },
              'friends.1': {
                links: {
                  self: '../Person/hassan',
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

  test('prerender can handle missing link in linksTo field', async function (assert) {
    let url = `${testRealmURL}Cat/molly.json`;
    await visit(`/render/${encodeURIComponent(url)}/html/isolated/0`);
    let { value } = await captureResult('innerHTML', 'error');
    let error = JSON.parse(value);
    assert.strictEqual(error.code, 404, 'error code is correct');
    assert.strictEqual(error.title, 'Not Found', 'error title is correct');
    assert.strictEqual(
      error.message,
      'Cat/missing-link.json not found',
      'error message is correct',
    );
    assert.strictEqual(
      error.id,
      `${testRealmURL}Cat/missing-link.json`,
      'error id is correct',
    );
    assert.ok(error.stack, 'stack exists in error');
  });

  test('prerender can handle missing link in linksToMany field', async function (assert) {
    let url = `${testRealmURL}Person/jade.json`;
    await visit(`/render/${encodeURIComponent(url)}/html/isolated/0`);
    let { value } = await captureResult('innerHTML', 'error');
    let error = JSON.parse(value);
    assert.strictEqual(error.code, 404, 'error code is correct');
    assert.strictEqual(error.title, 'Not Found', 'error title is correct');
    assert.strictEqual(
      error.message,
      'Pet/missing-link.json not found',
      'error message is correct',
    );
    assert.strictEqual(
      error.id,
      `${testRealmURL}Pet/missing-link.json`,
      'error id is correct',
    );
    assert.ok(error.stack, 'stack exists in error');
  });

  test('can prerender instance with a cycle in a linksTo field', async function (assert) {
    let url = `${testRealmURL}Pet/pet-a.json`;
    await visit(`/render/${encodeURIComponent(url)}/html/isolated/0`);
    let { value } = await captureResult('innerHTML');
    assert.ok(
      /data-test-field="petFriend"?.*Beatrice/s.test(value),
      'failed to find "Beatrice" field value in isolated HTML',
    );
  });

  test('can prerender instance with a cycle in a linksToMany field', async function (assert) {
    let url = `${testRealmURL}Person/germaine.json`;
    await visit(`/render/${encodeURIComponent(url)}/html/isolated/0`);
    let { value } = await captureResult('innerHTML');
    assert.ok(
      /data-test-field="friends"?.*Queenzy?.*Hassan/s.test(value),
      `failed to find "Queenzy" and "Hassan" field value in isolated HTML`,
    );
  });

  // TODO test prerender compound contains field
  // TODO test prerender compound containsMany field
  // TODO test prerender compound contains field that includes a linksTo field
  // TODO test prerender compound containsMany that includes a linksTo field
  // TODO test prerender computed that consumes linksTo
  // TODO test prerender computed that consumes linksToMany
  // TODO test prerender missing link in computed that consumes linksTo
  // TODO test prerender missing link in computed that consumes linksToMany
  // TODO test prerender linksToMany cycle
  // TODO make tests for search docs. use existing search doc tests as the template
});
