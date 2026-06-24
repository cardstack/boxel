// CS-10797: Tests for card link and card embed markdown helpers.

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import type {
  markdownLinkForCard as MarkdownLinkForCardFn,
  markdownLinksForCards as MarkdownLinksForCardsFn,
  markdownEmbedForCard as MarkdownEmbedForCardFn,
  markdownEmbedsForCards as MarkdownEmbedsForCardsFn,
} from 'https://cardstack.com/base/markdown-helpers';

import { setupRenderingTest } from '../helpers/setup';

module('Unit | markdown-helpers | card link helpers', function (hooks) {
  setupRenderingTest(hooks);

  let loader: Loader;
  let markdownLinkForCard: typeof MarkdownLinkForCardFn;
  let markdownLinksForCards: typeof MarkdownLinksForCardsFn;
  let markdownEmbedForCard: typeof MarkdownEmbedForCardFn;
  let markdownEmbedsForCards: typeof MarkdownEmbedsForCardsFn;

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    let mod = await loader.import<
      typeof import('https://cardstack.com/base/markdown-helpers')
    >(`${baseRealm.url}markdown-helpers`);
    markdownLinkForCard = mod.markdownLinkForCard;
    markdownLinksForCards = mod.markdownLinksForCards;
    markdownEmbedForCard = mod.markdownEmbedForCard;
    markdownEmbedsForCards = mod.markdownEmbedsForCards;
  });

  // -- markdownLinkForCard --------------------------------------------------

  test('renders link with explicit text', function (assert) {
    let card = {
      id: 'https://example.com/Author/1',
      cardTitle: 'Jane Doe',
    };
    assert.strictEqual(
      markdownLinkForCard(card, 'the author'),
      '[the author](https://example.com/Author/1)',
    );
  });

  test('falls back to cardTitle when text is omitted', function (assert) {
    let card = {
      id: 'https://example.com/Author/1',
      cardTitle: 'Jane Doe',
    };
    assert.strictEqual(
      markdownLinkForCard(card),
      '[Jane Doe](https://example.com/Author/1)',
    );
  });

  test('returns empty string for null card', function (assert) {
    assert.strictEqual(markdownLinkForCard(null), '');
    assert.strictEqual(markdownLinkForCard(undefined), '');
  });

  test('escapes markdown special chars in title', function (assert) {
    let card = {
      id: 'https://example.com/Post/1',
      cardTitle: 'Hello *world* [test]',
    };
    let result = markdownLinkForCard(card);
    assert.true(result.includes('\\*'), `asterisks are escaped: ${result}`);
    assert.true(result.includes('\\['), `brackets are escaped: ${result}`);
    assert.true(
      result.includes('https://example.com/Post/1'),
      'href is preserved',
    );
  });

  test('handles card with no cardTitle and no explicit text', function (assert) {
    let card = { id: 'https://example.com/Post/1' };
    assert.strictEqual(
      markdownLinkForCard(card),
      '[](https://example.com/Post/1)',
    );
  });

  // -- markdownLinksForCards -------------------------------------------------

  test('default list style renders bulleted links', function (assert) {
    let cards = [
      { id: 'https://example.com/A/1', cardTitle: 'Alice' },
      { id: 'https://example.com/B/2', cardTitle: 'Bob' },
    ];
    assert.strictEqual(
      markdownLinksForCards(cards),
      '- [Alice](https://example.com/A/1)\n- [Bob](https://example.com/B/2)',
    );
  });

  test('inline style renders comma-separated links', function (assert) {
    let cards = [
      { id: 'https://example.com/A/1', cardTitle: 'Alice' },
      { id: 'https://example.com/B/2', cardTitle: 'Bob' },
      { id: 'https://example.com/C/3', cardTitle: 'Charlie' },
    ];
    assert.strictEqual(
      markdownLinksForCards(cards, { style: 'inline' }),
      '[Alice](https://example.com/A/1), [Bob](https://example.com/B/2), [Charlie](https://example.com/C/3)',
    );
  });

  test('custom text callback overrides cardTitle', function (assert) {
    let cards = [
      { id: 'https://example.com/A/1', cardTitle: 'Alice Smith' },
      { id: 'https://example.com/B/2', cardTitle: 'Bob Jones' },
    ];
    assert.strictEqual(
      markdownLinksForCards(cards, {
        style: 'inline',
        text: (c) => `@${c.cardTitle}`,
      }),
      '[@Alice Smith](https://example.com/A/1), [@Bob Jones](https://example.com/B/2)',
    );
  });

  test('null entries in array are skipped', function (assert) {
    let cards = [
      { id: 'https://example.com/A/1', cardTitle: 'Alice' },
      null,
      undefined,
      { id: 'https://example.com/B/2', cardTitle: 'Bob' },
    ];
    assert.strictEqual(
      markdownLinksForCards(cards),
      '- [Alice](https://example.com/A/1)\n- [Bob](https://example.com/B/2)',
    );
  });

  test('empty array returns empty string', function (assert) {
    assert.strictEqual(markdownLinksForCards([]), '');
  });

  test('all-null array returns empty string', function (assert) {
    assert.strictEqual(markdownLinksForCards([null, null]), '');
  });

  test('null/undefined cards array returns empty string', function (assert) {
    assert.strictEqual(markdownLinksForCards(null), '');
    assert.strictEqual(markdownLinksForCards(undefined), '');
  });

  // -- markdownEmbedForCard -------------------------------------------------

  test('block embed (default)', function (assert) {
    let card = { id: 'https://example.com/Post/1', cardTitle: 'My Post' };
    assert.strictEqual(
      markdownEmbedForCard(card),
      '::card[https://example.com/Post/1]',
    );
  });

  test('inline embed', function (assert) {
    let card = { id: 'https://example.com/Post/1', cardTitle: 'My Post' };
    assert.strictEqual(
      markdownEmbedForCard(card, { kind: 'inline' }),
      ':card[https://example.com/Post/1]',
    );
  });

  test('block embed with size specifier', function (assert) {
    let card = { id: 'https://example.com/Post/1' };
    assert.strictEqual(
      markdownEmbedForCard(card, { size: 'fitted 250x40' }),
      '::card[https://example.com/Post/1 | fitted 250x40]',
    );
  });

  test('block embed with isolated size', function (assert) {
    let card = { id: 'https://example.com/Post/1' };
    assert.strictEqual(
      markdownEmbedForCard(card, { size: 'isolated' }),
      '::card[https://example.com/Post/1 | isolated]',
    );
  });

  test('size specifier is honored for inline embeds', function (assert) {
    let card = { id: 'https://example.com/Post/1' };
    assert.strictEqual(
      markdownEmbedForCard(card, { kind: 'inline', size: 'strip' }),
      ':card[https://example.com/Post/1 | strip]',
    );
  });

  test('inline embed with embedded size', function (assert) {
    let card = { id: 'https://example.com/Post/1' };
    assert.strictEqual(
      markdownEmbedForCard(card, { kind: 'inline', size: 'embedded' }),
      ':card[https://example.com/Post/1 | embedded]',
    );
  });

  test('embed returns empty string for null card', function (assert) {
    assert.strictEqual(markdownEmbedForCard(null), '');
    assert.strictEqual(markdownEmbedForCard(undefined), '');
  });

  test('embed returns empty string for card with no id', function (assert) {
    assert.strictEqual(markdownEmbedForCard({ cardTitle: 'No ID' }), '');
  });

  // -- markdownEmbedsForCards -----------------------------------------------

  test('block embeds separated by double newline (default)', function (assert) {
    let cards = [
      { id: 'https://example.com/A/1', cardTitle: 'Alice' },
      { id: 'https://example.com/B/2', cardTitle: 'Bob' },
    ];
    assert.strictEqual(
      markdownEmbedsForCards(cards),
      '::card[https://example.com/A/1]\n\n::card[https://example.com/B/2]',
    );
  });

  test('inline embeds separated by space', function (assert) {
    let cards = [
      { id: 'https://example.com/A/1', cardTitle: 'Alice' },
      { id: 'https://example.com/B/2', cardTitle: 'Bob' },
    ];
    assert.strictEqual(
      markdownEmbedsForCards(cards, { kind: 'inline' }),
      ':card[https://example.com/A/1] :card[https://example.com/B/2]',
    );
  });

  test('custom separator', function (assert) {
    let cards = [
      { id: 'https://example.com/A/1' },
      { id: 'https://example.com/B/2' },
    ];
    assert.strictEqual(
      markdownEmbedsForCards(cards, { separator: '\n' }),
      '::card[https://example.com/A/1]\n::card[https://example.com/B/2]',
    );
  });

  test('embeds with size specifier', function (assert) {
    let cards = [
      { id: 'https://example.com/A/1' },
      { id: 'https://example.com/B/2' },
    ];
    assert.strictEqual(
      markdownEmbedsForCards(cards, { size: 'strip' }),
      '::card[https://example.com/A/1 | strip]\n\n::card[https://example.com/B/2 | strip]',
    );
  });

  test('embed null entries in array are skipped', function (assert) {
    let cards = [
      { id: 'https://example.com/A/1' },
      null,
      undefined,
      { id: 'https://example.com/B/2' },
    ];
    assert.strictEqual(
      markdownEmbedsForCards(cards),
      '::card[https://example.com/A/1]\n\n::card[https://example.com/B/2]',
    );
  });

  test('embed empty array returns empty string', function (assert) {
    assert.strictEqual(markdownEmbedsForCards([]), '');
  });

  test('embed null/undefined array returns empty string', function (assert) {
    assert.strictEqual(markdownEmbedsForCards(null), '');
    assert.strictEqual(markdownEmbedsForCards(undefined), '');
  });
});
