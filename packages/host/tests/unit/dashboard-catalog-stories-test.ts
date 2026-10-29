import { module, test } from 'qunit';

import {
  STORY_COUNT,
  eyebrowOf,
  kindOf,
  linkedIds,
  shelfCopy,
  shelfName,
  storiesFrom,
  type ListingEntry,
} from '@cardstack/host/components/operator-mode/dashboard/catalog-stories';

const catalog = 'https://catalog.example/catalog/';

const resolve = (link: string, base: string) => new URL(link, base).href;

function listing(
  path: string,
  attributes: Record<string, unknown> = {},
  examples: string[] = [],
): ListingEntry {
  return {
    id: `${catalog}${path}`,
    item: {
      id: `${catalog}${path}`,
      type: 'card',
      attributes: {
        name: path,
        cardThumbnailURL: `${catalog}${path}.png`,
        ...attributes,
      },
      relationships: Object.fromEntries(
        examples.map((link, i) => [`examples.${i}`, { links: { self: link } }]),
      ),
      meta: {
        adoptsFrom: { module: './listing', name: path.split('/')[1] },
        sparseFields: ['name', 'summary', 'cardThumbnailURL', 'examples'],
      },
    } as unknown as ListingEntry['item'],
  };
}

module('Unit | dashboard catalog stories', function () {
  test('a listing’s kind comes from its class, not its folder', function (assert) {
    assert.strictEqual(kindOf(listing('wine/CardListing/1').item), 'Card');
    assert.strictEqual(kindOf(listing('x/ThemeListing/1').item), 'Theme');
    assert.strictEqual(kindOf(listing('x/Listing/1').item), 'Listing');
    assert.strictEqual(kindOf(listing('x/Other/1').item), 'Listing');
    assert.strictEqual(
      kindOf({
        ...listing('x/CardListing/1').item!,
        meta: { adoptsFrom: { module: './listing', name: 'AppListing' } },
      } as ListingEntry['item']),
      'App',
      'a class that disagrees with the folder wins',
    );
    assert.strictEqual(kindOf(undefined), 'Listing');
  });

  test('the lead story is the pick of the week; the rest say what you get', function (assert) {
    assert.strictEqual(eyebrowOf('Card', true), 'Card of the week');
    assert.strictEqual(eyebrowOf('App', false), 'New app');
    assert.strictEqual(eyebrowOf('Theme', false), 'New theme');
    assert.strictEqual(eyebrowOf('Skill', false), 'New skill');
    assert.strictEqual(eyebrowOf('Field', false), 'Build with it');
    assert.strictEqual(eyebrowOf('Card', false), 'New card');
    assert.strictEqual(eyebrowOf('Listing', false), 'New in the catalog');
  });

  test('a name drops the “definition” suffix the catalog index needs', function (assert) {
    assert.strictEqual(shelfName('Wine Cellar Card Definition'), 'Wine Cellar');
    assert.strictEqual(shelfName('Blackjack Definition'), 'Blackjack');
    assert.strictEqual(shelfName('Definition Finder'), 'Definition Finder');
    assert.strictEqual(shelfName(undefined), 'Untitled listing');
  });

  test('a summary that describes the code gives way to a line for the kind', function (assert) {
    assert.strictEqual(
      shelfCopy('Card', 'Plan a trip, day by day.'),
      'Plan a trip, day by day.',
    );
    assert.strictEqual(
      shelfCopy('Theme', 'The WineCellar component serves as a cellar.'),
      'A look for your cards. Use it on any workspace.',
    );
    assert.strictEqual(
      shelfCopy('Card', undefined),
      'Ready-made and free to remix: make it yours in a workspace of your own.',
    );
  });

  test('links resolve in order, from data ids or relative self links', function (assert) {
    let entry: ListingEntry = {
      id: `${catalog}index`,
      item: {
        id: `${catalog}index`,
        type: 'card',
        attributes: {},
        relationships: {
          'featured.10': { links: { self: './k/CardListing/10' } },
          'featured.2': {
            links: { self: null },
            data: { type: 'card', id: `${catalog}k/AppListing/2` },
          },
          'featured.0': { links: { self: './k/CardListing/0' } },
          other: { links: { self: './elsewhere' } },
        },
        meta: { adoptsFrom: { module: './catalog', name: 'Catalog' } },
      } as unknown as ListingEntry['item'],
    };
    assert.deepEqual(linkedIds(entry, 'featured', resolve), [
      `${catalog}k/CardListing/0`,
      `${catalog}k/AppListing/2`,
      `${catalog}k/CardListing/10`,
    ]);
  });

  test('featured listings lead in the catalog’s order, then other listings fill the shelf', function (assert) {
    let featuredIds = [
      `${catalog}b/CardListing/1`,
      `${catalog}a/ThemeListing/1`,
    ];
    let stories = storiesFrom({
      featuredIds,
      featured: [
        listing('a/ThemeListing/1'),
        listing('b/CardListing/1', {}, ['../Example/1']),
      ],
      others: [
        listing('a/ThemeListing/1'),
        listing('c/AppListing/1'),
        listing('d/CardListing/1', { cardThumbnailURL: '' }),
        listing('e/SkillListing/1'),
        listing('f/FieldListing/1'),
      ],
      resolve,
    });

    assert.strictEqual(stories.length, STORY_COUNT);
    assert.deepEqual(
      stories.map((story) => story.id),
      [
        `${catalog}b/CardListing/1`,
        `${catalog}a/ThemeListing/1`,
        `${catalog}c/AppListing/1`,
        `${catalog}e/SkillListing/1`,
      ],
      'a listing without a thumbnail is left out, and none shows twice',
    );
    assert.deepEqual(
      stories.map((story) => story.tint),
      ['warm', 'ink', 'mint', 'lilac'],
    );
    assert.deepEqual(
      stories.map((story) => story.scheme),
      ['light', 'dark', 'light', 'light'],
      'the ink paper is the dark one',
    );
    assert.deepEqual(
      stories.map((story) => story.eyebrow),
      ['Card of the week', 'New theme', 'New app', 'New skill'],
    );
    assert.strictEqual(
      stories[0]!.exampleId,
      `${catalog}b/Example/1`,
      'the first example is the one the story shows',
    );
    assert.strictEqual(stories[1]!.exampleId, undefined);
  });

  test('with nothing featured, no story is the pick of the week', function (assert) {
    let stories = storiesFrom({
      featuredIds: [],
      featured: [],
      others: [listing('c/AppListing/1'), listing('a/ThemeListing/1')],
      resolve,
    });
    assert.deepEqual(
      stories.map((story) => story.eyebrow),
      ['New app', 'New theme'],
    );
  });
});
