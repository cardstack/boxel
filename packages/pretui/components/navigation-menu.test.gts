// Pretui — NavigationMenu unit tests: links stay links, panels are
// disclosures, and every way of closing one.
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`.
import { module, test } from 'qunit';
import { click, render, triggerEvent, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { NavigationMenu } from './navigation-menu';
import type { NavigationMenuItem } from './navigation-menu';

const SITE: NavigationMenuItem[] = [
  { id: 'home', label: 'Home', href: '#home' },
  {
    id: 'coffee',
    label: 'Coffee',
    children: [
      { id: 'single', label: 'Single origin', href: '#single', description: 'One farm, one lot' },
      { id: 'blends', label: 'Blends', href: '#blends' },
    ],
  },
  { id: 'tea', label: 'Tea', children: [{ id: 'green', label: 'Green', href: '#green' }] },
];

function trigger(id: string): HTMLButtonElement {
  return document.querySelector(`[data-test-pretui-navigation-trigger="${id}"]`) as HTMLButtonElement;
}
function panel(id: string): HTMLElement {
  return document.querySelector(`[data-test-pretui-navigation-panel="${id}"]`) as HTMLElement;
}

module('Pretui | components/navigation-menu', function (hooks) {
  setupCardTest(hooks);

  test('a named nav; a destination is a link, an item with children is a disclosure button', async function (assert) {
    await render(<template><NavigationMenu @items={{SITE}} @label='Site' /></template>);
    let nav = document.querySelector('[data-test-pretui-navigation-menu]') as HTMLElement;
    assert.strictEqual(nav.tagName, 'NAV');
    assert.strictEqual(nav.getAttribute('aria-label'), 'Site');
    let home = document.querySelector('[data-test-pretui-navigation-link="home"]') as HTMLElement;
    assert.strictEqual(home.tagName, 'A');
    assert.strictEqual(trigger('coffee').tagName, 'BUTTON');
    assert.strictEqual(trigger('coffee').getAttribute('aria-expanded'), 'false');
    assert.strictEqual(trigger('coffee').getAttribute('aria-controls'), panel('coffee').id);
    assert.true(panel('coffee').hidden);
  });

  test('clicking opens one panel of real links; clicking again closes it', async function (assert) {
    await render(<template><NavigationMenu @items={{SITE}} @openOnHover={{false}} /></template>);
    await click(trigger('coffee'));
    assert.strictEqual(trigger('coffee').getAttribute('aria-expanded'), 'true');
    assert.false(panel('coffee').hidden);
    let link = panel('coffee').querySelector('[data-test-pretui-navigation-link="single"]') as HTMLAnchorElement;
    assert.strictEqual(link.getAttribute('href'), '#single');
    await click(trigger('tea'));
    assert.true(panel('coffee').hidden, 'only one open at a time');
    assert.false(panel('tea').hidden);
    await click(trigger('tea'));
    assert.true(panel('tea').hidden);
  });

  test('hover opens and leaving the nav closes a hover-opened panel', async function (assert) {
    await render(<template><NavigationMenu @items={{SITE}} /></template>);
    await triggerEvent(trigger('coffee'), 'pointerenter');
    assert.false(panel('coffee').hidden);
    await triggerEvent('[data-test-pretui-navigation-menu]', 'pointerleave');
    assert.true(panel('coffee').hidden);
  });

  test('Escape closes and returns focus to the trigger', async function (assert) {
    await render(<template><NavigationMenu @items={{SITE}} /></template>);
    await click(trigger('coffee'));
    let link = panel('coffee').querySelector('a') as HTMLElement;
    link.focus();
    await triggerKeyEvent(link, 'keydown', 'Escape');
    assert.true(panel('coffee').hidden);
    assert.strictEqual(document.activeElement, trigger('coffee'));
  });

  test('a press outside closes it', async function (assert) {
    await render(<template><p class='t-out'>x</p><NavigationMenu @items={{SITE}} /></template>);
    await click(trigger('coffee'));
    await triggerEvent('.t-out', 'pointerdown');
    assert.true(panel('coffee').hidden);
  });

  test('@current marks the page link and its parent trigger', async function (assert) {
    await render(<template><NavigationMenu @items={{SITE}} @current='blends' /></template>);
    assert.strictEqual(trigger('coffee').dataset['current'], 'true');
    let link = panel('coffee').querySelector('[data-test-pretui-navigation-link="blends"]') as HTMLElement;
    assert.strictEqual(link.getAttribute('aria-current'), 'page');
  });

  test('with the default hover, a mouse click (which enters first) pins the panel open', async function (assert) {
    await render(<template><NavigationMenu @items={{SITE}} /></template>);
    await triggerEvent(trigger('coffee'), 'pointerenter');
    await click(trigger('coffee'));
    assert.false(panel('coffee').hidden, 'still open after the click');
    await triggerEvent('[data-test-pretui-navigation-menu]', 'pointerleave');
    assert.false(panel('coffee').hidden, 'pinned: leaving no longer closes it');
    await click(trigger('coffee'));
    assert.true(panel('coffee').hidden, 'a second click closes it');
  });

  test('leaving with keyboard focus inside keeps a hover-opened panel', async function (assert) {
    await render(<template><NavigationMenu @items={{SITE}} /></template>);
    await triggerEvent(trigger('coffee'), 'pointerenter');
    let link = panel('coffee').querySelector('a') as HTMLElement;
    link.focus();
    await triggerEvent('[data-test-pretui-navigation-menu]', 'pointerleave');
    assert.false(panel('coffee').hidden);
    assert.strictEqual(document.activeElement, link, 'focus did not fall to the page');
  });
});
