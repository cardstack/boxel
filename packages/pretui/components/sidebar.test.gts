// Pretui — Sidebar unit tests for the drawer's own state, the pinned rail
// and the shortcut's routing between several sidebars.
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { tracked } from '@glimmer/tracking';
import { click, render, settled, triggerKeyEvent, waitUntil } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Sidebar, SidebarGroup, SidebarItem } from './sidebar';

const noop = () => {};

function shells(): HTMLElement[] {
  return [...document.querySelectorAll('[data-test-pretui-sidebar]')] as HTMLElement[];
}

function pane(): HTMLElement {
  return document.querySelector('[data-test-pane]') as HTMLElement;
}
// Resizes the pane and waits for the ResizeObserver to report the new band.
async function resizeTo(width: number, until: () => boolean) {
  pane().style.inlineSize = width + 'px';
  await waitUntil(until, { timeout: 2000 });
  await settled();
}
const state = () => shells()[0]?.dataset['state'];
const mobile = () => shells()[0]?.dataset['mobile'];

module('Pretui | components/sidebar', function (hooks) {
  setupCardTest(hooks);

  test('in mobile mode the drawer starts closed', async function (assert) {
    await render(<template><Sidebar @mobile={{true}} @label='Library'><:nav>Lots</:nav></Sidebar></template>);
    assert.notOk(document.querySelector('[data-test-pretui-sidebar] dialog[open]'), 'no modal opens on the first render');
  });

  test('a pinned rail stays open: the shortcut does nothing', async function (assert) {
    await render(<template><Sidebar @collapsible='none' @label='Library'><:nav>Lots</:nav></Sidebar></template>);
    let before = shells()[0]?.dataset['state'];
    await triggerKeyEvent(document.body, 'keydown', 'B', { metaKey: true });
    await settled();
    assert.strictEqual(shells()[0]?.dataset['state'], before, 'the state did not flip');
  });

  test('with two sidebars, one press toggles the one that holds focus', async function (assert) {
    await render(<template>
      <Sidebar @label='Shell'><:nav><button type='button' class='t-outer'>Outer</button></:nav></Sidebar>
      <Sidebar @label='Inspector'><:nav><button type='button' class='t-inner'>Inner</button></:nav></Sidebar>
    </template>);
    let [outer, inner] = shells();
    let outerBefore = outer?.dataset['state'];
    let innerBefore = inner?.dataset['state'];
    (document.querySelector('.t-inner') as HTMLElement).focus();
    await triggerKeyEvent(document.querySelector('.t-inner') as HTMLElement, 'keydown', 'B', { metaKey: true });
    await settled();
    assert.strictEqual(outer?.dataset['state'], outerBefore, 'the other rail is untouched');
    assert.notStrictEqual(inner?.dataset['state'], innerBefore, 'the focused one toggled');
  });

  test('with focus in neither, one press toggles exactly one', async function (assert) {
    await render(<template>
      <Sidebar @label='A'><:nav>A</:nav></Sidebar>
      <Sidebar @label='B'><:nav>B</:nav></Sidebar>
    </template>);
    let before = shells().map((s) => s.dataset['state']);
    await triggerKeyEvent(document.body, 'keydown', 'B', { metaKey: true });
    await settled();
    let after = shells().map((s) => s.dataset['state']);
    let changed = after.filter((state, i) => state !== before[i]).length;
    assert.strictEqual(changed, 1);
  });

  test('@railBreakpoint: full, icon rail and drawer bands', async function (assert) {
    await render(<template><div data-test-pane><Sidebar @label='Library' @railBreakpoint={{1024}}><:nav>Lots</:nav></Sidebar></div></template>);
    await resizeTo(1200, () => state() === 'expanded');
    assert.strictEqual(state(), 'expanded', 'full at or above the breakpoint');
    await resizeTo(800, () => state() === 'collapsed');
    assert.strictEqual(mobile(), 'false', 'icon rail between the breakpoints');
    await resizeTo(500, () => mobile() === 'true');
    assert.strictEqual(mobile(), 'true', 'drawer below the mobile breakpoint');
    await resizeTo(1200, () => mobile() === 'false' && state() === 'expanded');
    assert.strictEqual(state(), 'expanded', 'full again');
  });

  test('@railBreakpoint: a manual toggle holds within a band and is released on crossing', async function (assert) {
    await render(<template><div data-test-pane><Sidebar @label='Library' @railBreakpoint={{1024}}><:nav>Lots</:nav></Sidebar></div></template>);
    await resizeTo(800, () => state() === 'collapsed');
    await click('[data-test-pretui-sidebar-handle]');
    assert.strictEqual(state(), 'expanded', 'the toggle wins in the rail band');
    pane().style.inlineSize = '700px';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await settled();
    assert.strictEqual(state(), 'expanded', 'still held after a resize within the band');
    await resizeTo(1200, () => state() === 'expanded');
    await click('[data-test-pretui-sidebar-handle]');
    assert.strictEqual(state(), 'collapsed', 'collapsed by hand in the full band');
    await resizeTo(800, () => state() === 'collapsed');
    await resizeTo(1200, () => state() === 'expanded');
    assert.strictEqual(state(), 'expanded', 'crossing back hands control to the automatic choice');
  });

  test('@railBreakpoint: a controlled @open receives the band change and stays in charge', async function (assert) {
    let calls: boolean[] = [];
    let onOpenChange = (v: boolean) => calls.push(v);
    await render(<template><div data-test-pane><Sidebar @label='Library' @open={{true}} @onOpenChange={{onOpenChange}} @railBreakpoint={{1024}}><:nav>Lots</:nav></Sidebar></div></template>);
    await resizeTo(800, () => calls.length > 0);
    assert.deepEqual(calls, [false], 'the caller is told to close');
    assert.strictEqual(state(), 'expanded', 'the sidebar waits for the caller to apply it');
  });

  test('@railBreakpoint: hysteresis keeps the icon rail just above the breakpoint', async function (assert) {
    await render(<template><div data-test-pane><Sidebar @label='Library' @railBreakpoint={{1024}}><:nav>Lots</:nav></Sidebar></div></template>);
    await resizeTo(800, () => state() === 'collapsed');
    pane().style.inlineSize = '1030px';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await settled();
    assert.strictEqual(state(), 'collapsed', 'still the icon rail within 16px of the edge');
    await resizeTo(1050, () => state() === 'expanded');
    assert.strictEqual(state(), 'expanded', 'full once clearly past the edge');
  });

  test('@railBreakpoint: changing the breakpoint re-sorts the pane at the same width', async function (assert) {
    class Knobs {
      @tracked rb = 1024;
    }
    let knobs = new Knobs();
    await render(<template><div data-test-pane><Sidebar @label='Library' @railBreakpoint={{knobs.rb}}><:nav>Lots</:nav></Sidebar></div></template>);
    await resizeTo(800, () => state() === 'collapsed');
    knobs.rb = 700;
    await waitUntil(() => state() === 'expanded', { timeout: 2000 });
    assert.strictEqual(state(), 'expanded', 'the same 800px pane is now in the full band');
  });

  test('@railBreakpoint is ignored while @mobile forces the mode', async function (assert) {
    let calls: boolean[] = [];
    let onOpenChange = (v: boolean) => calls.push(v);
    await render(<template><div data-test-pane><Sidebar @label='Library' @mobile={{true}} @open={{false}} @onOpenChange={{onOpenChange}} @railBreakpoint={{1024}}><:nav>Lots</:nav></Sidebar></div></template>);
    pane().style.inlineSize = '800px';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    pane().style.inlineSize = '1200px';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await settled();
    assert.deepEqual(calls, [], 'no band change reaches the caller');
    assert.notOk(document.querySelector('[data-test-pretui-sidebar] dialog[open]'), 'the drawer stays closed');
  });

  test('@railBreakpoint: the rail stays hidden until the first measurement', async function (assert) {
    await render(<template><div data-test-pane><Sidebar @label='Library' @railBreakpoint={{1024}}><:nav>Lots</:nav></Sidebar></div></template>);
    await resizeTo(800, () => state() === 'collapsed');
    let rail = document.querySelector('[data-test-pretui-sidebar-rail]') as HTMLElement;
    assert.notOk(rail.hasAttribute('data-measuring'), 'visible once measured, already in the icon rail');
  });

  test('without @railBreakpoint a mid-width pane keeps the full rail', async function (assert) {
    await render(<template><div data-test-pane><Sidebar @label='Library'><:nav>Lots</:nav></Sidebar></div></template>);
    pane().style.inlineSize = '800px';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await settled();
    assert.strictEqual(state(), 'expanded');
    assert.strictEqual(mobile(), 'false');
  });

  // The consumer here forgets @collapsed and @hideLabel: the rail still shows icons only.
  test('the collapsed icon rail hides group labels, item labels and badges but keeps each item named', async function (assert) {
    await render(<template>
      <Sidebar @label='Library' @open={{false}}>
        <:nav>
          <SidebarGroup @label='Pages'>
            <SidebarItem @label='Home' @badge='6' @href='#home'><:icon>H</:icon></SidebarItem>
            <SidebarItem @label='About' @onClick={{noop}}><:icon>A</:icon></SidebarItem>
          </SidebarGroup>
        </:nav>
      </Sidebar>
    </template>);
    let shown = (selector: string) => getComputedStyle(document.querySelector(selector) as Element).display !== 'none';
    assert.notOk(shown('.pretui-sbgroup-label'), 'the group label is not shown');
    assert.notOk(shown('.pretui-sbitem-label'), 'the item label is not shown');
    assert.notOk(shown('.pretui-sbitem-badge'), 'the badge is not shown');
    assert.deepEqual(
      [...document.querySelectorAll('[data-test-pretui-sidebar-item]')].map((el) => el.getAttribute('aria-label')),
      ['Home', 'About'],
      'each item keeps its accessible name',
    );
    assert.strictEqual(
      document.querySelector('[data-test-pretui-sidebar-group]')?.getAttribute('aria-labelledby'),
      document.querySelector('.pretui-sbgroup-label')?.id,
      'the group stays named',
    );
  });

  test('the expanded rail still shows labels and badges', async function (assert) {
    await render(<template>
      <Sidebar @label='Library'>
        <:nav>
          <SidebarGroup @label='Pages'>
            <SidebarItem @label='Home' @badge='6' @href='#home'><:icon>H</:icon></SidebarItem>
          </SidebarGroup>
        </:nav>
      </Sidebar>
    </template>);
    for (let selector of ['.pretui-sbgroup-label', '.pretui-sbitem-label', '.pretui-sbitem-badge']) {
      assert.notStrictEqual(getComputedStyle(document.querySelector(selector) as Element).display, 'none', selector);
    }
  });
});
