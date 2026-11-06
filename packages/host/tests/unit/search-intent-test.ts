import { module, test } from 'qunit';

import {
  Loader,
  VirtualNetwork,
  baseRealm,
  definitionSearchIntent,
  fetcher,
  getFieldDefinitions,
  maybeHandleScopedCSSRequest,
  rankFieldsOf,
  type SearchText,
} from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import { shimExternals } from '@cardstack/host/lib/externals';

import { testRealmURL } from '../helpers';

import { tagTestModuleExports } from '../helpers/identity-tags';

import type { CardDef } from '@cardstack/base/card-api';
import type * as CardAPI from '@cardstack/base/card-api';

let { resolvedBaseRealmURL } = ENV;

// Search intent in card-api (docs/search-intent.md): a field's `search`
// option, its type's default and the card's `static searchDefaults` decide
// which weight tier its words land in, and `search: false` takes a field out
// of the search doc.
module('Unit | search intent', function (hooks) {
  let api: typeof CardAPI;
  let Talk: typeof CardDef;

  hooks.beforeEach(async function () {
    let virtualNetwork = new VirtualNetwork();
    virtualNetwork.addURLMapping(
      new URL(baseRealm.url),
      new URL(resolvedBaseRealmURL),
    );
    virtualNetwork.addRealmMapping('@cardstack/base/', resolvedBaseRealmURL);
    virtualNetwork.addImportMap('@cardstack/boxel-icons/', (rest) => {
      return `${ENV.iconsURL}/@cardstack/boxel-icons/v1/icons/${rest}.js`;
    });
    shimExternals(virtualNetwork);
    let fetch = fetcher(virtualNetwork.fetch, [
      async (req, next) => {
        return (await maybeHandleScopedCSSRequest(req)) || next(req);
      },
    ]);
    let loader = new Loader(fetch, virtualNetwork.resolveImport, {
      virtualNetwork,
    });
    api = await loader.import<typeof CardAPI>('@cardstack/base/card-api');
    let { default: StringField } = await loader.import<
      typeof import('@cardstack/base/string')
    >('@cardstack/base/string');
    let { default: NumberField } = await loader.import<
      typeof import('@cardstack/base/number')
    >('@cardstack/base/number');
    let { field, contains, containsMany, CardDef, FieldDef, TextAreaField } =
      api;

    class Segment extends FieldDef {
      @field text = contains(StringField);
      @field speaker = contains(StringField, {
        search: { role: 'name', typos: true },
      });
    }
    class TalkCard extends CardDef {
      static searchDefaults = {
        title: 'videoTitle',
        rank: { recency: 'lastDiscussed' },
      };
      @field videoTitle = contains(StringField);
      @field channel = contains(StringField, {
        search: { role: 'label', facet: true },
      });
      @field vid = contains(StringField, { search: { role: 'identifier' } });
      @field text = contains(StringField);
      @field notes = contains(TextAreaField);
      @field secret = contains(StringField, { search: false });
      @field segments = containsMany(Segment, { search: { role: 'body' } });
      @field hnScore = contains(NumberField, {
        search: { rank: 'popularity' },
      });
      @field lastDiscussed = contains(NumberField);
    }
    tagTestModuleExports(`${testRealmURL}talk`, { TalkCard, Segment });
    Talk = TalkCard as unknown as typeof CardDef;
  });

  function searchDoc(): Record<string, any> {
    return {
      id: `${testRealmURL}TalkCard/1`,
      cardTitle: 'Rust in production',
      cardInfo: {
        name: 'Rust in production',
        alternativeNames: ['RiP'],
        keywords: ['rust'],
        summary: 'How a team shipped it',
      },
      videoTitle: 'Rust in production',
      channel: 'Strange Loop',
      vid: 'dQw4w9WgXcQ',
      text: 'plain transcript words',
      notes: 'long editor notes',
      secret: 'not for the index',
      segments: [
        { text: 'first segment', speaker: 'Ada Lovelace' },
        { text: 'second segment', speaker: 'Ada Lovelace' },
      ],
      hnScore: 42,
      lastDiscussed: 1700000000,
    };
  }

  const lines = (text: SearchText, tier: keyof SearchText) =>
    (text[tier] ?? '').split('\n').filter(Boolean).sort();

  test("a card's words land in the tier their roles give them", function (assert) {
    let doc = searchDoc();
    let text = api.searchTextOf(Talk, doc)!;
    assert.deepEqual(
      lines(text, 'A'),
      ['Ada Lovelace', 'RiP', 'Rust in production'],
      'titles, aliases and names: the title once, the card title and cardInfo.name folded into it',
    );
    assert.deepEqual(
      lines(text, 'B'),
      ['How a team shipped it', 'Strange Loop', 'rust'],
      'summaries, labels and keywords',
    );
    assert.deepEqual(
      lines(text, 'C'),
      ['plain transcript words'],
      'a StringField with no role is plain text',
    );
    assert.deepEqual(
      lines(text, 'D'),
      ['first segment', 'long editor notes', 'second segment'],
      "a TextAreaField's body default, and a body list's subfields",
    );
    assert.strictEqual(
      text.typos,
      'Ada Lovelace',
      'a typos field adds its words to the word list, once',
    );
    assert.strictEqual(
      text.patterns,
      'dQw4w9WgXcQ',
      'an identifier is searched by pattern',
    );
    let all = [text.A, text.B, text.C, text.D].join('\n');
    assert.false(all.includes('dQw4w9WgXcQ'), 'an identifier is not ranked');
    assert.false(all.includes('not for the index'), 'search: false is not');
    assert.false(all.includes('42'), 'numbers are not words');
  });

  test('search: false takes the field out of the search doc', function (assert) {
    let doc = searchDoc();
    api.searchTextOf(Talk, doc);
    assert.false('secret' in doc, 'the field is gone');
    assert.strictEqual(doc.vid, 'dQw4w9WgXcQ', 'an identifier stays');
    assert.strictEqual(doc.cardTitle, 'Rust in production');
  });

  test('the definition records each field option and the card defaults', function (assert) {
    let { fields, fieldDefs } = getFieldDefinitions(api, Talk);
    assert.deepEqual(fieldDefs[fields.channel].search, {
      role: 'label',
      facet: true,
    });
    assert.strictEqual(
      fieldDefs[fields.text].search,
      undefined,
      'a field that declares nothing records nothing',
    );
    let search = definitionSearchIntent(Talk);
    assert.deepEqual(search, {
      title: 'videoTitle',
      rank: { recency: 'lastDiscussed' },
    });
    assert.deepEqual(rankFieldsOf({ fields, fieldDefs, search }), {
      popularity: ['hnScore'],
      recency: ['lastDiscussed'],
    });
  });

  test('a misspelt search option fails where it is declared', function (assert) {
    let { field, contains, CardDef } = api;
    assert.throws(() => {
      class Bad extends CardDef {
        @field title = contains(api.StringField, {
          search: { role: 'headline' as 'title' },
        });
      }
      api.getFields(Bad);
    }, /search role must be one of/);
  });
});
