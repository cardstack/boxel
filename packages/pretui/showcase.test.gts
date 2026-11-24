// The showcase: moving between home and the docs inside one card, the docs
// sidebar's category groups, and the hero's theme cycle.
import { module, test } from 'qunit';
import { render, click, triggerEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { PretUIHome } from './pretui-home';
import { PretUIOverview } from './pretui-overview';
import { ThemeStage } from './showcase-stage';
import { CATEGORIES } from './showcase-data';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Home = PretUIHome.isolated as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Overview = PretUIOverview.isolated as any;

module('Pretui | showcase', function (hooks) {
  setupCardTest(hooks);

  test('a category tile opens the docs on that category, in the same card', async function (assert) {
    let model = {};
    await render(<template><Home @model={{model}} /></template>);
    assert.dom('.tile').exists({ count: CATEGORIES.length });
    await click(".tile[data-category='agentic'] .tile-open");
    assert.dom('.hero').doesNotExist();
    assert.dom('.docs-landing h1').hasText('Agentic');
    assert
      .dom('.docs-group-head[aria-expanded="true"]')
      .exists({ count: 1 })
      .containsText('Agentic');
  });

  test('the top bar moves between home and the docs', async function (assert) {
    let model = {};
    await render(<template><Home @model={{model}} /></template>);
    await click('.sc-nav-link');
    assert.dom('.docs-landing h1').hasText('Components');
    assert.dom('.sc-nav-link').hasAttribute('aria-current', 'page');
    await click('.sc-brand');
    assert.dom('.hero').exists();
    assert.dom('.sc-brand').hasAttribute('aria-current', 'page');
  });

  test('an overview card opens the docs on its category', async function (assert) {
    let model = { category: 'Media' };
    await render(<template><Overview @model={{model}} /></template>);
    assert.dom('.docs-landing h1').hasText('Media');
    await click('.docs-all');
    assert.dom('.docs-landing h1').hasText('Components');
    assert.dom('.docs-catcard').exists({ count: CATEGORIES.length });
  });

  test('a category group folds open and shut', async function (assert) {
    let model = {};
    await render(<template><Overview @model={{model}} /></template>);
    assert.dom('.docs-group-head[aria-expanded="true"]').doesNotExist();
    await click('.docs-group:nth-of-type(2) .docs-group-head');
    assert.dom('.docs-group-head[aria-expanded="true"]').exists({ count: 1 });
    await click('.docs-group:nth-of-type(2) .docs-group-head');
    assert.dom('.docs-group-head[aria-expanded="true"]').doesNotExist();
  });

  test('the color scheme switch applies to the whole page', async function (assert) {
    let model = {};
    await render(<template><Home @model={{model}} /></template>);
    assert.dom('.showcase').doesNotHaveAttribute('data-theme');
    await click('.sc-top-end input[value="dark"]');
    assert.dom('.showcase').hasAttribute('data-theme', 'dark');
    await click('.sc-nav-link');
    assert
      .dom('.showcase')
      .hasAttribute('data-theme', 'dark', 'it holds across views');
    await click('.sc-top-end input[value="auto"]');
    assert.dom('.showcase').doesNotHaveAttribute('data-theme');
  });

  test('a specimen opens its component docs in place', async function (assert) {
    let model = {};
    await render(<template><Home @model={{model}} /></template>);
    await click('.gallery [data-specimen="Rating"] .spec-open');
    assert.dom('.hero').doesNotExist();
    assert.dom('.docs').exists();
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

    assert.dom('.picker-name').hasText('Alpha');
    assert.dom('.picker-pos').hasText('1 / 3');
    await triggerEvent('.picker-tick', 'animationiteration');
    assert.dom('.picker-name').hasText('Beta');
    assert.dom('style[data-boxel-theme-style]').includesText('blue');

    await click('[aria-label="Next theme"]');
    assert.dom('.picker-name').hasText('Gamma');
    assert.dom('.picker-tick').doesNotExist('stepping pauses the tour');

    await click('.picker-play');
    assert.dom('.picker-tick').exists('play resumes it');
    await click('[aria-label="Previous theme"]');
    assert.dom('.picker-name').hasText('Beta');
  });
});
