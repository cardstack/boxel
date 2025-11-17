import { visit } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  type RenderRouteOptions,
  type RenderError,
  baseRealm,
} from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  capturePrerenderResult,
  type TestContextWithSave,
} from '../helpers';

import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

module('Acceptance | prerender | html', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });

  const DEFAULT_RENDER_OPTIONS_SEGMENT = encodeURIComponent(
    JSON.stringify({ clearCache: true } as RenderRouteOptions),
  );
  const renderPath = (url: string, suffix: string, nonce = 0) =>
    `/render/${encodeURIComponent(
      url,
    )}/${nonce}/${DEFAULT_RENDER_OPTIONS_SEGMENT}${suffix}`;

  hooks.beforeEach(async function () {
    // these tests result in a really large index definitions object because of all the
    // circularity, so to speed up the tests we prune the definitions object as we don't
    // really care about it.
    (globalThis as any).__boxel_definitions_recursing_depth = 0;
    (globalThis as any).__doNotSuppressRenderRouteError = true;
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
      static embedded = class Embedded extends Component<typeof Pet> {
        <template>
          Pet component
          <div data-test-card-title>
            <@fields.name />
          </div>
        </template>
      };
    }

    class Cat extends Pet {
      static displayName = 'Cat';
      @field aliases = containsMany(StringField);
      static embedded = class Embedded extends Component<typeof Cat> {
        <template>
          Cat component
          <div data-test-card-title>
            <@fields.name />
          </div>
        </template>
      };
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
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
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
    delete (globalThis as any).__boxelRenderContext;
    delete (globalThis as any).__boxel_definitions_recursing_depth;
    delete (globalThis as any).__doNotSuppressRenderRouteError;
  });

  test('prerender isolated html', async function (assert) {
    let url = `${testRealmURL}Cat/paper.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    assert
      .dom(
        `[data-test-card="${testRealmURL}Cat/paper"][data-test-card-format="isolated"] [data-test-field="cardTitle"]`,
      )
      .containsText('Paper', 'isolated format is rendered');
  });

  test('prerender embedded html', async function (assert) {
    let url = `${testRealmURL}Cat/paper.json`;
    await visit(renderPath(url, '/html/embedded/0'));
    assert
      .dom(
        `[data-test-card="${testRealmURL}Cat/paper"][data-test-card-format="embedded"] [data-test-card-title]`,
      )
      .containsText('Paper', 'embedded format is rendered');
    assert
      .dom(
        `[data-test-card="${testRealmURL}Cat/paper"][data-test-card-format="embedded"]`,
      )
      .includesText('Cat component', 'html renders default type component');
  });

  test('prerender atom html', async function (assert) {
    let url = `${testRealmURL}Cat/paper.json`;
    await visit(renderPath(url, '/html/atom/0'));
    assert
      .dom(
        `[data-test-card="${testRealmURL}Cat/paper"][data-test-card-format="atom"]`,
      )
      .containsText('Paper', 'embedded format is rendered');
  });

  test('prerender fitted html', async function (assert) {
    let url = `${testRealmURL}Cat/paper.json`;
    await visit(renderPath(url, '/html/fitted/0'));
    assert
      .dom(
        `[data-test-card="${testRealmURL}Cat/paper"][data-test-card-format="fitted"] [data-test-card-title]`,
      )
      .containsText('Paper', 'fitted format is rendered');
    assert
      .dom(
        `[data-test-card="${testRealmURL}Cat/paper"][data-test-card-format="fitted"] [data-test-card-display-name]`,
      )
      .containsText('Cat', 'fitted format renders at default type level');
  });

  test('prerender icon html', async function (assert) {
    let url = `${testRealmURL}Cat/paper.json`;
    await visit(renderPath(url, '/icon'));
    assert.dom('[data-prerender] > svg').exists('icon rendered');
  });

  test('prerender ancestor html', async function (assert) {
    let url = `${testRealmURL}Cat/paper.json`;
    await visit(renderPath(url, '/html/embedded/1'));
    assert
      .dom(
        `[data-test-card="${testRealmURL}Cat/paper"][data-test-card-format="embedded"]`,
      )
      .includesText('Pet component', 'html renders ancestor component');
  });

  test('can prerender instance with contains field', async function (assert) {
    let url = `${testRealmURL}Pet/vangogh.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    let { value } = await capturePrerenderResult('innerHTML');
    assert.ok(
      /data-test-field="name"?.*Van Gogh/s.test(value),
      'failed to find "Van Gogh" field value in isolated HTML',
    );
  });

  test('can prerender instance with containsMany field', async function (assert) {
    let url = `${testRealmURL}Cat/paper.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    let { value } = await capturePrerenderResult('innerHTML');
    assert.ok(
      /data-test-field="aliases"?.*Satan?.*Satan's Mistress/s.test(value),
      `failed to find "Satan" and "Satan's Mistress" field value in isolated HTML`,
    );
  });

  test('can prerender instance with linksTo field', async function (assert) {
    let url = `${testRealmURL}Pet/mango.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    let { value } = await capturePrerenderResult('innerHTML');
    assert.ok(
      /data-test-field="petFriend"?.*Van Gogh/s.test(value),
      'failed to find "Van Gogh" field value in isolated HTML',
    );
  });

  test('can prerender instance with linksToMany field', async function (assert) {
    let url = `${testRealmURL}Person/hassan.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    let { value } = await capturePrerenderResult('innerHTML');
    assert.ok(
      /data-test-field="pets"?.*Mango?.*Van Gogh/s.test(value),
      'failed to find "Mango" and "Van Gogh" field values in isolated HTML',
    );
  });

  test('prerender can handle missing link in linksTo field', async function (assert) {
    let url = `${testRealmURL}Cat/molly.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    let { value } = await capturePrerenderResult('innerHTML', 'error');
    let { error }: RenderError = JSON.parse(value);
    assert.strictEqual(error.status, 404, 'error code is correct');
    assert.strictEqual(error.title, 'Link Not Found', 'error title is correct');
    assert.strictEqual(
      error.message,
      `missing file ${testRealmURL}Cat/missing-link.json`,
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
    await visit(renderPath(url, '/html/isolated/0'));
    let { value } = await capturePrerenderResult('innerHTML', 'error');
    let { error }: RenderError = JSON.parse(value);
    assert.strictEqual(error.status, 404, 'error code is correct');
    assert.strictEqual(error.title, 'Link Not Found', 'error title is correct');
    assert.strictEqual(
      error.message,
      `missing file ${testRealmURL}Pet/missing-link.json`,
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
    await visit(renderPath(url, '/html/isolated/0'));
    let { value } = await capturePrerenderResult('innerHTML');
    assert.ok(
      /data-test-field="petFriend"?.*Beatrice/s.test(value),
      'failed to find "Beatrice" field value in isolated HTML',
    );
  });

  test('can prerender instance with a cycle in a linksToMany field', async function (assert) {
    let url = `${testRealmURL}Person/germaine.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    let { value } = await capturePrerenderResult('innerHTML');
    assert.ok(
      /data-test-field="friends"?.*Queenzy?.*Hassan/s.test(value),
      `failed to find "Queenzy" and "Hassan" field values in isolated HTML`,
    );
  });

  test('can prerender instance with compound contains field that includes a linksTo field', async function (assert) {
    let url = `${testRealmURL}Pet/pet-c.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    let { value } = await capturePrerenderResult('innerHTML');
    assert.ok(
      /data-test-field="license"?.*Scarsdale?.*Hassan/s.test(value),
      'failed to find "Scarsdale" and "Hassan" field values in isolated HTML',
    );
  });

  test('can prerender instance with compound contains field that includes a linksToMany field', async function (assert) {
    let url = `${testRealmURL}Pet/pet-d.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    let { value } = await capturePrerenderResult('innerHTML');
    assert.ok(
      /data-test-field="emergencyContact"?.*Jade?.*Germaine/s.test(value),
      'failed to find "Jade" and "Germaine" field values in isolated HTML',
    );
  });

  test('can prerender instance with compound containsMany field that includes a linksTo field', async function (assert) {
    let url = `${testRealmURL}Pet/pet-e.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    let { value } = await capturePrerenderResult('innerHTML');
    assert.ok(
      /data-test-field="sitters"?.*Jade?.*Germaine/s.test(value),
      'failed to find "Jade" and "Germaine" field values in isolated HTML',
    );
  });

  test('can prerender instance with compound containsMany field that includes a linksToMany field', async function (assert) {
    let url = `${testRealmURL}Pet/pet-f.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    let { value } = await capturePrerenderResult('innerHTML');
    assert.ok(
      /data-test-field="cliques"?.*Allen?.*Beatrice?.*Clive?.*Delancy/s.test(
        value,
      ),
      'failed to find "Allen", "Beatrice", "Clive", and "Delancy" field values in isolated HTML',
    );
  });

  test('can prerender instance with computed that consumes linksTo', async function (assert) {
    let url = `${testRealmURL}Pet/mango.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    let { value } = await capturePrerenderResult('innerHTML');
    assert.ok(
      /data-test-field="friendName"?.*Van Gogh/s.test(value),
      'failed to find "Van Gogh" field value in isolated HTML',
    );
  });

  test('can prerender instance with computed that consumes linksToMany', async function (assert) {
    let url = `${testRealmURL}Person/hassan.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    let { value } = await capturePrerenderResult('innerHTML');
    assert.ok(
      /data-test-field="numberOfPets"?.*2/s.test(value),
      'failed to find "2" field value in isolated HTML',
    );
  });

  test('can prerender instance with computed linksTo', async function (assert) {
    let url = `${testRealmURL}Pet/mango.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    let { value } = await capturePrerenderResult('innerHTML');
    assert.ok(
      /data-test-field="friendOfFriend"?.*Paper/s.test(value),
      'failed to find "Paper" field value in isolated HTML',
    );
  });

  test('can prerender instance with computed linksToMany', async function (assert) {
    let url = `${testRealmURL}Person/germaine.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    let { value } = await capturePrerenderResult('innerHTML');
    assert.ok(
      /data-test-field="friendsOfFriend"?.*Germaine?.*Hassan/s.test(value),
      `failed to find "Germaine" and "Hassan" field values in isolated HTML`,
    );
  });

  test<TestContextWithSave>('does not save instances while prerendering', async function (assert) {
    this.onSave(() => {
      assert.step('persisted');
    });

    let url = `${testRealmURL}Cat/paper.json`;
    await visit(renderPath(url, '/html/isolated/0'));

    let renderInstance = (globalThis as any).__renderInstance;
    assert.ok(renderInstance, 'render instance exists when prerendering');

    // Mutate the rendered instance between the visit and capture, mirroring instance mutations that
    // normally enqueue an autosave, and confirm that nothing is persisted in prerender context.
    (renderInstance as any).name = 'Paper (mutated for prerender test)';
    await getService('store').flushSaves();
    assert.verifySteps([], 'no save occurs while prerendering');

    await capturePrerenderResult('innerHTML');
    this.unregisterOnSave();
  });

  test('can handle not found prerender url', async function (assert) {
    let url = `${testRealmURL}does-not-exist.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    let { value } = await capturePrerenderResult('textContent', 'error');
    let { error }: RenderError = JSON.parse(value);
    assert.ok(error.stack, 'stack exists in error');
    assert.strictEqual(
      error.id,
      'http://test-realm/test/does-not-exist.json',
      'error.id is correct',
    );
    assert.true(error.isCardError, 'error.isCardError is correct');
    assert.strictEqual(
      error.message,
      'does-not-exist.json not found',
      'error.message is correct',
    );
    assert.strictEqual(error.status, 404, 'error.status is correct');
    assert.strictEqual(error.title, 'Not Found', 'error.title is correct');
  });
});
