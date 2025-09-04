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

module('Acceptance | prerender | isolated html', function (hooks) {
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
    // these tests result in a really large index definitions object because of all the
    // circularity, so to speed up the tests we prune the definitions object as we don't
    // really care about it.
    (globalThis as any).__boxel_definitions_recursing_depth = 0;
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
      FieldDef,
      StringField,
      Component,
    } = cardApi;

    class PetLicense extends FieldDef {
      static displayName = 'Pet License';
      @field city = contains(StringField);
      @field owner = linksTo(() => Person);
      static embedded = class Embedded extends Component<typeof PetLicense> {
        <template>
          <@fields.city />
          <@fields.owner />
        </template>
      };
    }

    class EmergencyContacts extends FieldDef {
      @field notes = contains(StringField);
      @field contacts = linksToMany(() => Person);
      static embedded = class Embedded extends Component<
        typeof EmergencyContacts
      > {
        <template>
          <@fields.notes />
          <@fields.contacts />
        </template>
      };
    }

    class PetSitter extends FieldDef {
      @field phone = contains(StringField);
      @field sitter = linksTo(() => Person);
      static embedded = class Embedded extends Component<typeof PetSitter> {
        <template>
          <@fields.sitter />
          <@fields.phone />
        </template>
      };
    }

    class PetClique extends FieldDef {
      @field name = contains(StringField);
      @field members = linksToMany(() => Pet);
      static embedded = class Embedded extends Component<typeof PetClique> {
        <template>
          <@fields.name />
          <@fields.members />
        </template>
      };
    }

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field petFriend = linksTo(() => Pet);
      @field license = contains(PetLicense);
      @field emergencyContacts = contains(EmergencyContacts);
      @field sitters = containsMany(PetSitter);
      @field cliques = containsMany(PetClique);
      @field title = contains(StringField, {
        computeVia(this: Pet) {
          return `${this.name}`;
        },
      });
      @field friendName = contains(StringField, {
        computeVia(this: Pet) {
          return this.petFriend?.name;
        },
      });
      @field friendOfFriend = linksTo(() => Pet, {
        computeVia(this: Pet) {
          return this.petFriend?.petFriend;
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
      @field numberOfPets = contains(StringField, {
        computeVia(this: Person) {
          return String(this.pets ? this.pets.length : 0);
        },
      });
      @field friendsOfFriend = linksToMany(() => Person, {
        computeVia(this: Person) {
          if (Array.isArray(this.friends) && this.friends.length > 0) {
            return this.friends[0].friends;
          }
          return [];
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
            relationships: {
              petFriend: {
                links: {
                  self: '../Cat/paper',
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
        'Pet/pet-c.json': {
          data: {
            attributes: { name: 'Clive', license: { city: 'Scarsdale' } },
            relationships: {
              'license.owner': {
                links: {
                  self: '../Person/hassan',
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
        'Pet/pet-d.json': {
          data: {
            attributes: {
              name: 'Delancy',
              emergencyContacts: { notes: 'Very timid' },
            },
            relationships: {
              'emergencyContacts.contacts.0': {
                links: {
                  self: '../Person/jade',
                },
              },
              'emergencyContacts.contacts.1': {
                links: {
                  self: '../Person/germaine',
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
        'Pet/pet-e.json': {
          data: {
            attributes: {
              name: 'Erskine',
              sitters: [{ phone: '01234' }, { phone: '56789' }],
            },
            relationships: {
              'sitters.0.sitter': {
                links: {
                  self: '../Person/jade',
                },
              },
              'sitters.1.sitter': {
                links: {
                  self: '../Person/germaine',
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
        'Pet/pet-f.json': {
          data: {
            attributes: {
              name: 'Ferdinand',
              cliques: [{ name: 'Ball Fetchers' }, { name: 'Power Nappers' }],
            },
            relationships: {
              'cliques.0.members.0': {
                links: {
                  self: './pet-a',
                },
              },
              'cliques.0.members.1': {
                links: {
                  self: './pet-b',
                },
              },
              'cliques.1.members.0': {
                links: {
                  self: './pet-c',
                },
              },
              'cliques.1.members.1': {
                links: {
                  self: './pet-d',
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
        'Pet/pet-g.json': {
          data: {
            attributes: {
              name: 'Gregory',
              friendId: `${testRealmURL}Pet/mango`,
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
                  self: './queenzy',
                },
              },
              'friends.1': {
                links: {
                  self: './hassan',
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
                  self: './germaine',
                },
              },
              'friends.1': {
                links: {
                  self: './hassan',
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
    delete (globalThis as any).__boxel_definitions_recursing_depth;
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
      `failed to find "Queenzy" and "Hassan" field values in isolated HTML`,
    );
  });

  test('can prerender instance with compound contains field that includes a linksTo field', async function (assert) {
    let url = `${testRealmURL}Pet/pet-c.json`;
    await visit(`/render/${encodeURIComponent(url)}/html/isolated/0`);
    let { value } = await captureResult('innerHTML');
    assert.ok(
      /data-test-field="license"?.*Scarsdale?.*Hassan/s.test(value),
      'failed to find "Scarsdale" and "Hassan" field values in isolated HTML',
    );
  });

  test('can prerender instance with compound contains field that includes a linksToMany field', async function (assert) {
    let url = `${testRealmURL}Pet/pet-d.json`;
    await visit(`/render/${encodeURIComponent(url)}/html/isolated/0`);
    let { value } = await captureResult('innerHTML');
    assert.ok(
      /data-test-field="emergencyContact"?.*Jade?.*Germaine/s.test(value),
      'failed to find "Jade" and "Germaine" field values in isolated HTML',
    );
  });

  test('can prerender instance with compound containsMany field that includes a linksTo field', async function (assert) {
    let url = `${testRealmURL}Pet/pet-e.json`;
    await visit(`/render/${encodeURIComponent(url)}/html/isolated/0`);
    let { value } = await captureResult('innerHTML');
    assert.ok(
      /data-test-field="sitters"?.*Jade?.*Germaine/s.test(value),
      'failed to find "Jade" and "Germaine" field values in isolated HTML',
    );
  });

  test('can prerender instance with compound containsMany field that includes a linksToMany field', async function (assert) {
    let url = `${testRealmURL}Pet/pet-f.json`;
    await visit(`/render/${encodeURIComponent(url)}/html/isolated/0`);
    let { value } = await captureResult('innerHTML');
    assert.ok(
      /data-test-field="cliques"?.*Allen?.*Beatrice?.*Clive?.*Delancy/s.test(
        value,
      ),
      'failed to find "Allen", "Beatrice", "Clive", and "Delancy" field values in isolated HTML',
    );
  });

  test('can prerender instance with computed that consumes linksTo', async function (assert) {
    let url = `${testRealmURL}Pet/mango.json`;
    await visit(`/render/${encodeURIComponent(url)}/html/isolated/0`);
    let { value } = await captureResult('innerHTML');
    assert.ok(
      /data-test-field="friendName"?.*Van Gogh/s.test(value),
      'failed to find "Van Gogh" field value in isolated HTML',
    );
  });

  test('can prerender instance with computed that consumes linksToMany', async function (assert) {
    let url = `${testRealmURL}Person/hassan.json`;
    await visit(`/render/${encodeURIComponent(url)}/html/isolated/0`);
    let { value } = await captureResult('innerHTML');
    assert.ok(
      /data-test-field="numberOfPets"?.*2/s.test(value),
      'failed to find "2" field value in isolated HTML',
    );
  });

  test('can prerender instance with computed linksTo', async function (assert) {
    let url = `${testRealmURL}Pet/mango.json`;
    await visit(`/render/${encodeURIComponent(url)}/html/isolated/0`);
    let { value } = await captureResult('innerHTML');
    assert.ok(
      /data-test-field="friendOfFriend"?.*Paper/s.test(value),
      'failed to find "Paper" field value in isolated HTML',
    );
  });

  test('can prerender instance with computed linksToMany', async function (assert) {
    let url = `${testRealmURL}Person/germaine.json`;
    await visit(`/render/${encodeURIComponent(url)}/html/isolated/0`);
    let { value } = await captureResult('innerHTML');
    assert.ok(
      /data-test-field="friendsOfFriend"?.*Germaine?.*Hassan/s.test(value),
      `failed to find "Germaine" and "Hassan" field values in isolated HTML`,
    );
  });

  // TODO make tests for search docs. use existing search doc tests as the template
});
