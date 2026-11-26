// The showcase: moving between home and the docs inside one card, the docs
// sidebar's category groups, search, and the hero's theme cycle.
import { module, test } from 'qunit';
import { render, click, triggerEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { PretUIHome } from './pretui-home';
import { PretUIOverview } from './pretui-overview';
import { ThemeStage } from './showcase-stage';
import { CATEGORIES } from './showcase-data';
import { SpecCatalog } from './showcase-chrome';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Home = PretUIHome.isolated as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Overview = PretUIOverview.isolated as any;
const GROUP = `[data-test-showcase-group='${CATEGORIES[1].name}']`;

module('Pretui | showcase', function (hooks) {
  setupCardTest(hooks);

  test('a category tile opens the docs on that category, in the same card', async function (assert) {
    let model = {};
    await render(<template><Home @model={{model}} /></template>);
    assert
      .dom('[data-test-showcase-tile]')
      .exists({ count: CATEGORIES.length });
    await click(
      "[data-test-showcase-tile='agentic'] [data-test-showcase-tile-open]",
    );
    assert.dom('[data-test-showcase-hero]').doesNotExist();
    assert.dom('[data-test-showcase-title]').hasText('Agentic');
    assert
      .dom('[data-test-showcase-group][aria-expanded="true"]')
      .exists({ count: 1 })
      .containsText('Agentic');
  });

  test('the top bar moves between home and the docs', async function (assert) {
    let model = {};
    await render(<template><Home @model={{model}} /></template>);
    await click('[data-test-showcase-docs-link]');
    assert.dom('[data-test-showcase-title]').hasText('Components');
    assert
      .dom('[data-test-showcase-docs-link]')
      .hasAttribute('aria-current', 'page');
    await click('[data-test-showcase-home-link]');
    assert.dom('[data-test-showcase-hero]').exists();
    assert
      .dom('[data-test-showcase-home-link]')
      .hasAttribute('aria-current', 'page');
  });

  test('an overview card opens the docs on its category', async function (assert) {
    let model = { category: 'Media' };
    await render(<template><Overview @model={{model}} /></template>);
    assert.dom('[data-test-showcase-title]').hasText('Media');
    await click('[data-test-showcase-all]');
    assert.dom('[data-test-showcase-title]').hasText('Components');
    assert
      .dom('[data-test-showcase-catcard]')
      .exists({ count: CATEGORIES.length });
  });

  test('a category group folds open and shut', async function (assert) {
    let model = {};
    await render(<template><Overview @model={{model}} /></template>);
    assert
      .dom('[data-test-showcase-group][aria-expanded="true"]')
      .doesNotExist();
    await click(GROUP);
    assert
      .dom('[data-test-showcase-group][aria-expanded="true"]')
      .exists({ count: 1 });
    await click(GROUP);
    assert
      .dom('[data-test-showcase-group][aria-expanded="true"]')
      .doesNotExist();
  });

  test('the color scheme switch applies to the whole page', async function (assert) {
    let model = {};
    await render(<template><Home @model={{model}} /></template>);
    assert.dom('[data-test-showcase]').doesNotHaveAttribute('data-theme');
    await click('[data-test-showcase-scheme] input[value="dark"]');
    assert.dom('[data-test-showcase]').hasAttribute('data-theme', 'dark');
    await click('[data-test-showcase-docs-link]');
    assert
      .dom('[data-test-showcase]')
      .hasAttribute('data-theme', 'dark', 'it holds across views');
    await click('[data-test-showcase-scheme] input[value="auto"]');
    assert.dom('[data-test-showcase]').doesNotHaveAttribute('data-theme');
  });

  test('a specimen opens its component docs in place', async function (assert) {
    let model = {};
    await render(<template><Home @model={{model}} /></template>);
    await click('[data-specimen="Rating"] [data-test-showcase-specimen-open]');
    assert.dom('[data-test-showcase-hero]').doesNotExist();
    assert.dom('[data-test-showcase-docs]').exists();
  });

  test('the hero tours the themes and stops when the reader steps', async function (assert) {
    let themes = [
      {
        id: 't/a',
        cardTitle: 'Alpha',
        cssVariables: ':root { --primary: red; }',
      },
      {
        id: 't/b',
        cardTitle: 'Beta',
        cssVariables: ':root { --primary: blue; }',
      },
      {
        id: 't/c',
        cardTitle: 'Gamma',
        cssVariables: ':root { --primary: green; }',
      },
    ];
    let context = { getCards: () => ({ instances: themes }) };
    await render(<template><ThemeStage @context={{context}} /></template>);

    assert.dom('[data-test-theme-name]').hasText('Alpha');
    assert.dom('[data-test-theme-position]').hasText('1 / 3');
    await triggerEvent('[data-test-theme-tick]', 'animationiteration');
    assert.dom('[data-test-theme-name]').hasText('Beta');
    assert.dom('style[data-boxel-theme-style]').includesText('blue');

    await click('[aria-label="Next theme"]');
    assert.dom('[data-test-theme-name]').hasText('Gamma');
    assert
      .dom('[data-test-theme-tick]')
      .doesNotExist('stepping pauses the tour');

    await click('[data-test-theme-play]');
    assert.dom('[data-test-theme-tick]').exists('play resumes it');
    await click('[aria-label="Previous theme"]');
    assert.dom('[data-test-theme-name]').hasText('Beta');
  });
  test('search matches split names and each word, best match first', function (assert) {
    let specs = new SpecCatalog(
      [
        {
          id: 'a',
          componentName: 'List',
          cardTitle: 'List',
          brief: 'Rows with selection',
        },
        {
          id: 'b',
          componentName: 'DatePicker',
          cardTitle: 'DatePicker',
          brief: 'Pick a day',
        },
        {
          id: 'c',
          componentName: 'LayoutControl',
          cardTitle: 'LayoutControl',
          brief: 'Toolbar row that fits its controls',
        },
        {
          id: 'd',
          componentName: 'EmptyState',
          cardTitle: 'EmptyState',
          brief: 'Nothing-here surface',
        },
        {
          id: 'e',
          componentName: 'SheetToolbar',
          cardTitle: 'SheetToolbar',
          brief: 'Spreadsheet bar',
        },
        {
          id: 'f',
          componentName: 'Toolbar',
          cardTitle: 'Toolbar',
          brief: 'A row of controls',
        },
        {
          id: 'g',
          componentName: 'Spinner',
          cardTitle: 'Spinner',
          brief: 'Loading ring',
        },
        {
          id: 'h',
          componentName: 'PinInput',
          cardTitle: 'PinInput',
          brief: 'One box per digit',
        },
      ],
      false,
    );
    let ids = (text: string) => specs.search(text).map((spec) => spec.id);
    assert.deepEqual(
      ids('date picker'),
      ['b'],
      'a spaced name finds the joined one',
    );
    assert.deepEqual(
      ids('toolbar'),
      ['f', 'e', 'c'],
      'the exact name first, then a longer name, then a brief',
    );
    assert.deepEqual(ids('pin'), ['h'], 'a word inside a name is no match');
    assert.deepEqual(
      ids('date pick'),
      ['b'],
      'every word must match when some component matches them all',
    );
    assert.deepEqual(
      ids('empty list'),
      ['a', 'd'],
      'when none matches every word, each word finds its own',
    );
    assert.deepEqual(ids('picker date'), ['b'], 'word order does not matter');
    assert.deepEqual(
      ids('spread'),
      ['e'],
      'a brief matches from the start of a word',
    );
    assert.deepEqual(ids(' - '), [], 'a search without words lists nothing');
  });
});
