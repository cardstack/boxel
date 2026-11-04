// Pretui — Sidebar unit tests for the drawer's own state, the pinned rail
// and the shortcut's routing between several sidebars.
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { tracked } from '@glimmer/tracking';
import { click, render, settled, triggerKeyEvent, waitUntil } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Sidebar, SidebarGroup, SidebarItem } from './sidebar';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

// A boxel-icon stand-in: an svg that carries its own 24px size.
const Icon24: TemplateOnlyComponent<{ Element: SVGSVGElement }> = <template>
  <svg width='24' height='24' viewBox='0 0 24 24' ...attributes><circle cx='12' cy='12' r='10' /></svg>
</template>;

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
const seamEl = () => document.querySelector('[data-test-pretui-sidebar-resize]') as HTMLElement;
// The harness delivers no stylesheet and may scale its container, so a drag
// is written in layout px and converted, as in the ResizeHandle tests.
async function drag(from: number, to: number) {
  let el = seamEl();
  let scale = el.getBoundingClientRect().width / parseFloat(getComputedStyle(el).width);
  let fire = (type: string, x: number) =>
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, clientX: x * scale }));
  fire('pointerdown', from);
  fire('pointermove', to);
  fire('pointerup', to);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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

  // The harness leaves a component's own `<style scoped>` inert (see
  // stacking-cards.test.gts), so these pin the markup contract the collapsed-rail
  // CSS and the accessible names rest on; the look itself is checked by eye.
  const names = () => [...document.querySelectorAll('[data-test-pretui-sidebar-item]')].map((el) => el.getAttribute('aria-label'));
  const railState = () => document.querySelector('[data-test-pretui-sidebar-rail]')?.getAttribute('data-state');

  test('the collapsed icon rail renders no item label or badge when the caller passes @collapsed, and keeps each item named', async function (assert) {
    await render(<template>
      <Sidebar @label='Library' @open={{false}} @mobile={{false}}>
        <:nav as |bar|>
          <SidebarGroup @label='Pages'>
            <SidebarItem @label='Home' @badge='6' @href='#home' @collapsed={{bar.collapsed}}><:icon>H</:icon></SidebarItem>
            <SidebarItem @label='About' @collapsed={{bar.collapsed}} @onClick={{noop}}><:icon>A</:icon></SidebarItem>
          </SidebarGroup>
        </:nav>
      </Sidebar>
    </template>);
    assert.strictEqual(railState(), 'collapsed', 'the rail is the icon rail');
    assert.dom('[data-test-pretui-sidebar-item-label]').doesNotExist('no item label');
    assert.dom('[data-test-pretui-sidebar-item-badge]').doesNotExist('no badge');
    assert.deepEqual(names(), ['Home', 'About'], 'each item keeps its accessible name');
  });

  test('without @collapsed the items still carry their accessible name and the group stays named, so the CSS can hide the text', async function (assert) {
    await render(<template>
      <Sidebar @label='Library' @open={{false}} @mobile={{false}}>
        <:nav>
          <SidebarGroup @label='Pages'>
            <SidebarItem @label='Home' @badge='6' @href='#home'><:icon>H</:icon></SidebarItem>
            <SidebarItem @label='About' @onClick={{noop}}><:icon>A</:icon></SidebarItem>
          </SidebarGroup>
        </:nav>
      </Sidebar>
    </template>);
    assert.strictEqual(railState(), 'collapsed');
    assert.deepEqual(names(), ['Home', 'About'], 'the name no longer depends on the visible label');
    assert.dom('[data-test-pretui-sidebar-item-label]').exists({ count: 2 }, 'the text is rendered, for the rail CSS to hide');
    assert.dom('[data-test-pretui-sidebar-item-badge]').exists({ count: 1 });
    assert.strictEqual(
      document.querySelector('[data-test-pretui-sidebar-item]')?.getAttribute('aria-describedby'),
      document.querySelector('[data-test-pretui-sidebar-item-badge]')?.id,
      'the badge stays reachable as the item description',
    );
    assert.strictEqual(
      document.querySelector('[data-test-pretui-sidebar-group]')?.getAttribute('aria-labelledby'),
      document.querySelector('[data-test-pretui-sidebar-group-label]')?.id,
      'the group is named by its label',
    );
  });

  test('the drawer rail carries no data-state, so the collapsed-rail properties never reach it', async function (assert) {
    await render(<template>
      <Sidebar @label='Library' @mobile={{true}} @open={{true}}>
        <:nav>
          <SidebarGroup @label='Pages'><SidebarItem @label='Home' @href='#home'><:icon>H</:icon></SidebarItem></SidebarGroup>
        </:nav>
      </Sidebar>
    </template>);
    assert.dom('[data-test-pretui-sidebar-rail]').doesNotHaveAttribute('data-state');
  });

  test("@scroll: 'content' is opt-in and reaches the shell's hook", async function (assert) {
    await render(<template>
      <Sidebar @label='A'><:nav>Lots</:nav></Sidebar>
      <Sidebar @label='B' @scroll='content'><:nav>Lots</:nav></Sidebar>
    </template>);
    let [a, b] = shells();
    assert.strictEqual(a?.dataset['scroll'], 'page', 'default is page, today\'s behaviour');
    assert.strictEqual(b?.dataset['scroll'], 'content');
  });

  test('@scroll: the content element survives a collapse, so its scroll position does', async function (assert) {
    await render(<template><Sidebar @label='Library' @mobile={{false}} @scroll='content'><:nav>Lots</:nav><:default>Page</:default></Sidebar></template>);
    let content = shells()[0]!.querySelector('[data-test-pretui-sidebar-content]');
    await click('[data-test-pretui-sidebar-handle]');
    assert.strictEqual(state(), 'collapsed');
    assert.strictEqual(shells()[0]!.querySelector('[data-test-pretui-sidebar-content]'), content, 'same element');
  });

  test('@resizable: the seam is a named separator with its range', async function (assert) {
    await render(<template><Sidebar @label='Library' @mobile={{false}} @resizable={{true}} @width='200px' @minWidth={{150}} @maxWidth={{300}}><:nav>Lots</:nav></Sidebar></template>);
    assert.dom('[data-test-pretui-sidebar-handle]').doesNotExist('the separator replaces the toggle button');
    assert.dom('[data-test-pretui-sidebar-resize]').hasAttribute('role', 'separator').hasAttribute('aria-label', 'Resize Library').hasAttribute('aria-valuenow', '200').hasAttribute('aria-valuemin', '0').hasAttribute('aria-valuemax', '300');
    assert.dom('[data-test-pretui-sidebar-resize]').hasAttribute('aria-controls', document.querySelector('[data-test-pretui-sidebar-rail]')!.id);
  });

  test('@resizable: drag sets the width, clamps at the max, and does not toggle', async function (assert) {
    await render(<template><Sidebar @label='Library' @mobile={{false}} @resizable={{true}} @width='200px' @minWidth={{150}} @maxWidth={{300}}><:nav>Lots</:nav></Sidebar></template>);
    await drag(200, 250);
    assert.dom('[data-test-pretui-sidebar-resize]').hasAttribute('aria-valuenow', '250');
    assert.strictEqual(shells()[0]!.style.getPropertyValue('--pretui-sidebar-width'), '250px', 'the rail width follows');
    assert.strictEqual(state(), 'expanded', 'the click that ends a drag does not toggle');
    await drag(250, 900);
    assert.dom('[data-test-pretui-sidebar-resize]').hasAttribute('aria-valuenow', '300', 'clamped at the max');
  });

  test('@resizable: dragging below the minimum folds, a plain click toggles', async function (assert) {
    await render(<template><Sidebar @label='Library' @mobile={{false}} @resizable={{true}} @width='200px' @minWidth={{150}}><:nav>Lots</:nav></Sidebar></template>);
    await click('[data-test-pretui-sidebar-resize]');
    assert.strictEqual(state(), 'collapsed', 'a click toggles');
    assert.dom('[data-test-pretui-sidebar-resize]').doesNotExist('folded, the seam is the plain toggle');
    await click('[data-test-pretui-sidebar-handle]');
    await drag(200, 100);
    assert.strictEqual(state(), 'collapsed', 'below the minimum folds');
  });

  test('@resizable: arrow keys resize, and a key press is not taken for a drag', async function (assert) {
    await render(<template><Sidebar @label='Library' @mobile={{false}} @resizable={{true}} @width='200px'><:nav>Lots</:nav></Sidebar></template>);
    await triggerKeyEvent('[data-test-pretui-sidebar-resize]', 'keydown', 'ArrowRight');
    assert.dom('[data-test-pretui-sidebar-resize]').hasAttribute('aria-valuenow', '216');
    await triggerKeyEvent('[data-test-pretui-sidebar-resize]', 'keydown', 'ArrowLeft');
    assert.dom('[data-test-pretui-sidebar-resize]').hasAttribute('aria-valuenow', '200');
    await click('[data-test-pretui-sidebar-resize]');
    assert.strictEqual(state(), 'collapsed', 'the next click still toggles');
  });

  test('@resizable with @persistKey remembers the width', async function (assert) {
    localStorage.removeItem('pretui-sidebar:t-width');
    localStorage.removeItem('pretui-sidebar:t-width:width');
    await render(<template><Sidebar @label='Library' @mobile={{false}} @resizable={{true}} @width='200px' @persistKey='t-width'><:nav>Lots</:nav></Sidebar></template>);
    await triggerKeyEvent('[data-test-pretui-sidebar-resize]', 'keydown', 'ArrowRight');
    assert.strictEqual(localStorage.getItem('pretui-sidebar:t-width:width'), '216');
    await render(<template><span></span></template>);
    await render(<template><Sidebar @label='Library' @mobile={{false}} @resizable={{true}} @width='200px' @persistKey='t-width'><:nav>Lots</:nav></Sidebar></template>);
    assert.dom('[data-test-pretui-sidebar-resize]').hasAttribute('aria-valuenow', '216', 'restored on mount');
    localStorage.removeItem('pretui-sidebar:t-width:width');
  });

  test('without @resizable the seam is the plain toggle', async function (assert) {
    await render(<template><Sidebar @label='Library' @mobile={{false}}><:nav>Lots</:nav></Sidebar></template>);
    assert.dom('[data-test-pretui-sidebar-resize]').doesNotExist();
    assert.dom('[data-test-pretui-sidebar-handle]').exists();
  });

  test('SidebarItem @icon renders the icon into the sized slot, decorative', async function (assert) {
    await render(<template><SidebarItem @label='Lots' @icon={{Icon24}} /></template>);
    assert.dom('[data-test-pretui-sidebar-item-icon] > svg').exists();
    assert.dom('[data-test-pretui-sidebar-item] svg').hasAttribute('aria-hidden', 'true');
    assert.dom('[data-test-pretui-sidebar-item]').hasAttribute('aria-label', 'Lots');
  });
});
