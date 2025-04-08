import { click, find, visit } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupAcceptanceTestRealm,
  lookupLoaderService,
  testRealmURL,
  setupUserSubscription,
  visitOperatorMode,
} from '../helpers';
import {
  CardDef,
  Component,
  CardsGrid,
  contains,
  linksTo,
  linksToMany,
  field,
  setupBaseRealm,
  StringField,
  SkillCard,
  FileDef,
  MarkdownDef,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

let matrixRoomId: string;
module('Acceptance | FileDef tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  let { createAndJoinRoom } = mockMatrixUtils;
  setupBaseRealm(hooks);

  hooks.beforeEach(async function () {
    matrixRoomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription(matrixRoomId);

    let loaderService = lookupLoaderService();
    let loader = loaderService.loader;
    let { field, contains, CardDef, Component } = await loader.import<
      typeof import('https://cardstack.com/base/card-api')
    >(`${baseRealm.url}card-api`);
    let { default: StringField } = await loader.import<
      typeof import('https://cardstack.com/base/string')
    >(`${baseRealm.url}string`);
    let { Spec } = await loader.import<
      typeof import('https://cardstack.com/base/spec')
    >(`${baseRealm.url}spec`);
    let { SkillCard } = await loader.import<
      typeof import('https://cardstack.com/base/skill-card')
    >(`${baseRealm.url}skill-card`);

    class Index extends CardDef {
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-index-card>
            Hello, world!
          </div>
        </template>
      };
    }

    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return [this.firstName, this.lastName].filter(Boolean).join(' ');
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-person>
            <p>First name: <@fields.firstName /></p>
            <p>Last name: <@fields.lastName /></p>
            <p>Title: <@fields.title /></p>
          </div>
          <style scoped>
            div {
              color: green;
              content: '';
            }
          </style>
        </template>
      };
    }

    class PlainTextDef extends FileDef {}

    class MarkdownDef extends PlainTextDef {
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-markdown-file>
            <p>Markdown file: {{md-to-html @model.contentString}}</p>
          </div>
        </template>
      };
    }

    class PngDef extends PlainTextDef {
      async extractMeta(url: string, stream: ByteStream) {
        let extractor = await import('@cardstack/base/png-meta-extractor');
        return extractor.extractMeta(stream);
      }
    }

    class MarkdownAuthoredSkill extends SkillCard {
      @field markdownInstructions = linksTo(MarkdownDef);
      @field instructions = contains(StringField, {
        computeVia: function (this: MarkdownAuthoredSkill) {
          return this.markdownInstructions.contentString;
        },
      });
    }

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        'index.gts': { Index },
        'person.gts': { Person },
        'person-entry.json': new Spec({
          title: 'Person',
          description: 'Spec',
          isField: false,
          ref: {
            module: `./person`,
            name: 'Person',
          },
        }),
        'index.json': new Index(),
        'Person/1.json': new Person({
          firstName: 'Hassan',
          lastName: 'Abdel-Rahman',
        }),
        'markdown-authored-skill.gts': {
          MarkdownAuthoredSkill,
        },
        'skill1.json': {
          data: {
            type: 'card',
            attributes: {
              commands: [],
              title: 'Skill1',
              description: null,
              thumbnailURL: null,
            },
            relationships: {
              markdownFile: {
                links: {
                  self: `${testRealmURL}skill1.md`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: './markdown-authored-skill',
                name: 'MarkdownAuthoredSkill',
              },
            },
          },
        },
      },
    });
  });

  test('can render a computed based on the contents of a FileDef linksTo relationship', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}skill1`,
            format: 'isolated',
          },
        ],
      ],
    });

    assert
      .dom(
        '[data-test-stack-card-index="0"] [data-test-boxel-card-header-title]',
      )
      .includesText('Skill1');
  });
});
