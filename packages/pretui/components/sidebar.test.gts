// Pretui — Sidebar unit tests for the drawer's own state, the pinned rail
// and the shortcut's routing between several sidebars.
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { click, render, settled, triggerKeyEvent, waitUntil } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Sidebar, SidebarGroup, SidebarItem, SidebarTrigger } from './sidebar';
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
// Resizes the pane and waits one rendering step: a ResizeObserver reports in
// the frame's rendering step, so it has fired before the next frame's
// animation callback. For a resize that changes no visible state.
async function resizeQuietly(width: number) {
  pane().style.inlineSize = width + 'px';
  let done = false;
  requestAnimationFrame(() => requestAnimationFrame(() => (done = true)));
  await waitUntil(() => done, { timeout: 2000 });
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
  // a real browser renders between the move and the release, so a fold has
  // already unmounted the seam when its click arrives
  await settled();
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
    // already folded, so the rail band changes nothing visible to wait on
    await resizeQuietly(800);
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

  test("@railBreakpoint folds an offcanvas rail away, and @mobileBreakpoint={{0}} keeps it out of the drawer", async function (assert) {
    await render(<template><div data-test-pane><Sidebar @label='Library' @collapsible='offcanvas' @mobileBreakpoint={{0}} @railBreakpoint={{640}}><:nav>Lots</:nav></Sidebar></div></template>);
    await resizeTo(400, () => state() === 'collapsed');
    assert.strictEqual(mobile(), 'false', 'still a rail in a narrow pane, not a drawer');
    await click('[data-test-pretui-sidebar-handle]');
    assert.strictEqual(state(), 'expanded', 'a toggle opens it in the narrow band');
    await resizeQuietly(900);
    assert.strictEqual(state(), 'expanded', 'open in the wide band');
    await resizeTo(400, () => state() === 'collapsed');
    assert.strictEqual(state(), 'collapsed', 'crossing back folds it away again');
  });

  test('@railBreakpoint: a change the pane made lands at once, and a toggle slides', async function (assert) {
    const slides = () => shells()[0]?.dataset['slides'];
    await render(<template><div data-test-pane><Sidebar @label='Library' @collapsible='offcanvas' @mobileBreakpoint={{0}} @railBreakpoint={{640}}><:nav>Lots</:nav></Sidebar></div></template>);
    await resizeTo(400, () => state() === 'collapsed');
    assert.strictEqual(slides(), 'false', 'the first measurement folds without the slide');
    await click('[data-test-pretui-sidebar-handle]');
    assert.strictEqual(slides(), 'true', 'a toggle slides');
    await resizeQuietly(900);
    await resizeTo(400, () => state() === 'collapsed');
    assert.strictEqual(slides(), 'false', 'a band crossing lands at once');
  });

  test("@railBreakpoint: after a band crossing, a controlled caller's own changes to @open slide", async function (assert) {
    const slides = () => shells()[0]?.dataset['slides'];
    class Parent {
      @tracked open = true;
    }
    let parent = new Parent();
    let follow = (next: boolean) => (parent.open = next);
    await render(<template><div data-test-pane><Sidebar @label='Library' @collapsible='offcanvas' @mobileBreakpoint={{0}} @railBreakpoint={{640}} @open={{parent.open}} @onOpenChange={{follow}}><:nav>Lots</:nav></Sidebar></div></template>);
    await resizeTo(400, () => state() === 'collapsed');
    assert.strictEqual(slides(), 'false', 'the crossing lands at once');
    // a frame on, as any change after the crossing is
    await new Promise((r) => requestAnimationFrame(r));
    parent.open = true;
    await settled();
    assert.strictEqual(slides(), 'true', "the caller's own opening slides");
    parent.open = false;
    await settled();
    assert.strictEqual(slides(), 'true', 'and so does its closing, back to the state the crossing chose');
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
    assert.strictEqual(a?.dataset['scroll'], 'page', 'default is page');
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
    await click('[data-test-pretui-sidebar-handle]');
    await click('[data-test-pretui-sidebar-resize]');
    assert.strictEqual(state(), 'collapsed', 'the first click after a folding drag toggles');
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

  test('@resizable: a drag past a bound is still a drag, not a click', async function (assert) {
    await render(<template><Sidebar @label='Library' @mobile={{false}} @resizable={{true}} @width='300px' @maxWidth={{300}}><:nav>Lots</:nav></Sidebar></template>);
    await drag(300, 900);
    assert.dom('[data-test-pretui-sidebar-resize]').hasAttribute('aria-valuenow', '300');
    assert.strictEqual(state(), 'expanded', 'no size change, still no toggle');
  });

  test('@resizable: a restored width is clamped to the current bounds', async function (assert) {
    localStorage.setItem('pretui-sidebar:t-clamp:width', '500');
    await render(<template><Sidebar @label='Library' @mobile={{false}} @resizable={{true}} @maxWidth={{300}} @persistKey='t-clamp'><:nav>Lots</:nav></Sidebar></template>);
    assert.dom('[data-test-pretui-sidebar-resize]').hasAttribute('aria-valuenow', '300');
    assert.strictEqual(shells()[0]!.style.getPropertyValue('--pretui-sidebar-width'), '300px', 'the rail matches what is announced');
    localStorage.removeItem('pretui-sidebar:t-clamp:width');
  });

  test('@resizable: @maxWidth below @minWidth is floored at the minimum', async function (assert) {
    await render(<template><Sidebar @label='Library' @mobile={{false}} @resizable={{true}} @width='300px' @minWidth={{300}} @maxWidth={{200}}><:nav>Lots</:nav></Sidebar></template>);
    assert.dom('[data-test-pretui-sidebar-resize]').hasAttribute('aria-valuemax', '300');
    assert.dom('[data-test-pretui-sidebar-resize]').hasAttribute('aria-valuenow', '300', 'announces the width it renders');
    await triggerKeyEvent('[data-test-pretui-sidebar-resize]', 'keydown', 'ArrowRight');
    assert.dom('[data-test-pretui-sidebar-resize]').hasAttribute('aria-valuenow', '300', 'held at the floored max');
  });

  test('@resizable: the max stays 3rem inside a narrow pane, and never below the min', async function (assert) {
    const seam = () => document.querySelector('[data-test-pretui-sidebar-resize]');
    await render(<template><div data-test-pane><Sidebar @label='Library' @mobile={{false}} @resizable={{true}} @width='200px' @minWidth={{150}} @maxWidth={{400}}><:nav>Lots</:nav></Sidebar></div></template>);
    await resizeTo(300, () => seam()?.getAttribute('aria-valuemax') === String(300 - 48));
    assert.dom(seam()!).hasAttribute('aria-valuemax', '252', 'the pane less 3rem');
    assert.dom(seam()!).hasAttribute('aria-valuenow', '200', 'a width inside it is untouched');
    await resizeTo(220, () => seam()?.getAttribute('aria-valuemax') === '172');
    assert.dom(seam()!).hasAttribute('aria-valuenow', '172', 'the rail gives way to keep its seam in the pane');
    assert.strictEqual(shells()[0]!.style.getPropertyValue('--pretui-sidebar-width'), '172px', 'and renders the width it announces');
    await resizeTo(180, () => seam()?.getAttribute('aria-valuemax') === '150');
    assert.dom(seam()!).hasAttribute('aria-valuenow', '150', 'floored at the min');
  });

  test('without @resizable the seam is the plain toggle', async function (assert) {
    await render(<template><Sidebar @label='Library' @mobile={{false}}><:nav>Lots</:nav></Sidebar></template>);
    assert.dom('[data-test-pretui-sidebar-resize]').doesNotExist();
    assert.dom('[data-test-pretui-sidebar-handle]').exists();
  });

  test('@resizable: focus stays on the seam control across the swap', async function (assert) {
    await render(<template><Sidebar @label='Library' @mobile={{false}} @resizable={{true}} @width='200px'><:nav>Lots</:nav></Sidebar></template>);
    seamEl().focus();
    await triggerKeyEvent('[data-test-pretui-sidebar-resize]', 'keydown', 'Home');
    assert.strictEqual(state(), 'collapsed', 'Home folds');
    assert.strictEqual(document.activeElement, document.querySelector('[data-test-pretui-sidebar-handle]'), 'the toggle button takes focus');
    await click('[data-test-pretui-sidebar-handle]');
    assert.strictEqual(state(), 'expanded');
    assert.strictEqual(document.activeElement, seamEl(), 'the separator takes focus back');
  });

  test('@resizable: focus the user moved elsewhere is not taken back', async function (assert) {
    class Knobs {
      @tracked open = true;
    }
    let knobs = new Knobs();
    // the parent moves focus and applies the fold in one call, so the swap's
    // render still sees the hand-off pending
    let onOpenChange = (v: boolean) => {
      (document.querySelector('[data-test-outside]') as HTMLElement).focus();
      knobs.open = v;
    };
    await render(<template><Sidebar @label='Library' @mobile={{false}} @open={{knobs.open}} @onOpenChange={{onOpenChange}} @resizable={{true}}><:nav>Lots</:nav><:default><button type='button' data-test-outside>Out</button></:default></Sidebar></template>);
    seamEl().focus();
    await triggerKeyEvent('[data-test-pretui-sidebar-resize]', 'keydown', 'Home');
    assert.strictEqual(state(), 'collapsed');
    assert.dom('[data-test-outside]').isFocused('focus stays where the user put it');
  });

  test('@resizable: a fold the controlled parent ignores does not steal focus later', async function (assert) {
    class Knobs {
      @tracked open = true;
    }
    let knobs = new Knobs();
    let calls: boolean[] = [];
    let onOpenChange = (v: boolean) => calls.push(v);
    await render(<template><Sidebar @label='Library' @mobile={{false}} @open={{knobs.open}} @onOpenChange={{onOpenChange}} @resizable={{true}}><:nav>Lots</:nav></Sidebar></template>);
    seamEl().focus();
    await triggerKeyEvent('[data-test-pretui-sidebar-resize]', 'keydown', 'Home');
    assert.deepEqual(calls, [false], 'the parent hears the fold');
    assert.strictEqual(state(), 'expanded', 'and ignores it');
    seamEl().blur();
    knobs.open = false;
    await settled();
    assert.strictEqual(state(), 'collapsed');
    assert.notStrictEqual(document.activeElement, document.querySelector('[data-test-pretui-sidebar-handle]'), 'the toggle button does not take focus');
  });

  test('@resizable: a pane resize that swaps nothing leaves focus alone later', async function (assert) {
    class Knobs {
      @tracked open = true;
    }
    let knobs = new Knobs();
    await render(<template><div data-test-pane><Sidebar @label='Library' @open={{knobs.open}} @resizable={{true}}><:nav>Lots</:nav></Sidebar></div></template>);
    await resizeTo(1200, () => !!seamEl());
    seamEl().focus();
    await resizeQuietly(1100);
    seamEl().blur();
    knobs.open = false;
    await settled();
    assert.strictEqual(state(), 'collapsed');
    assert.notStrictEqual(document.activeElement, document.querySelector('[data-test-pretui-sidebar-handle]'), 'the toggle button does not take focus');
  });

  test('@resizable: the first seam click after a band reopen toggles', async function (assert) {
    await render(<template><div data-test-pane><Sidebar @label='Library' @resizable={{true}} @width='200px' @minWidth={{150}} @railBreakpoint={{1024}}><:nav>Lots</:nav></Sidebar></div></template>);
    await resizeTo(1200, () => state() === 'expanded' && !!seamEl());
    await drag(200, 100);
    assert.strictEqual(state(), 'collapsed', 'the drag folds the rail');
    // already folded, so the rail band changes nothing visible to wait on
    await resizeQuietly(800);
    await resizeTo(1200, () => state() === 'expanded');
    await click('[data-test-pretui-sidebar-resize]');
    assert.strictEqual(state(), 'collapsed', 'the click toggles');
  });

  test("@resizable with @collapsible='none': the seam only resizes", async function (assert) {
    let calls: boolean[] = [];
    let onOpenChange = (v: boolean) => calls.push(v);
    await render(<template><Sidebar @label='Library' @mobile={{false}} @collapsible='none' @onOpenChange={{onOpenChange}} @resizable={{true}} @width='200px' @minWidth={{150}}><:nav>Lots</:nav></Sidebar></template>);
    assert.dom('[data-test-pretui-sidebar-resize]').hasAttribute('aria-valuemin', '150', 'a pinned rail cannot fold');
    await click('[data-test-pretui-sidebar-resize]');
    assert.deepEqual(calls, [], 'a click does not toggle');
    assert.strictEqual(state(), 'expanded');
  });

  test('@resizable: @width is clamped into the bounds where it renders', async function (assert) {
    await render(<template><Sidebar @label='Library' @mobile={{false}} @resizable={{true}} @width='500px' @maxWidth={{300}}><:nav>Lots</:nav></Sidebar></template>);
    assert.strictEqual(shells()[0]!.style.getPropertyValue('--pretui-sidebar-width'), '300px');
    assert.dom('[data-test-pretui-sidebar-resize]').hasAttribute('aria-valuenow', '300', 'the rail matches what is announced');
  });

  test('without @resizable a stored width is not restored', async function (assert) {
    localStorage.setItem('pretui-sidebar:t-noresize:width', '250');
    await render(<template><Sidebar @label='Library' @mobile={{false}} @width='200px' @persistKey='t-noresize'><:nav>Lots</:nav></Sidebar></template>);
    assert.strictEqual(shells()[0]!.style.getPropertyValue('--pretui-sidebar-width'), '200px');
    localStorage.removeItem('pretui-sidebar:t-noresize:width');
  });

  test('turning @resizable on does not re-read the stored open state', async function (assert) {
    class Knobs {
      @tracked resizable = false;
    }
    let knobs = new Knobs();
    localStorage.setItem('pretui-sidebar:t-flip', 'open');
    localStorage.setItem('pretui-sidebar:t-flip:width', '250');
    await render(<template><Sidebar @label='Library' @mobile={{false}} @persistKey='t-flip' @resizable={{knobs.resizable}}><:nav>Lots</:nav></Sidebar></template>);
    // a state the rail never applied, as another tab would leave it
    localStorage.setItem('pretui-sidebar:t-flip', 'closed');
    knobs.resizable = true;
    await settled();
    assert.strictEqual(state(), 'expanded', 'the open state is restored once, on insert');
    assert.dom('[data-test-pretui-sidebar-resize]').hasAttribute('aria-valuenow', '250', 'the stored width applies');
    localStorage.removeItem('pretui-sidebar:t-flip');
    localStorage.removeItem('pretui-sidebar:t-flip:width');
  });

  // The seam's geometry is CSS the harness doesn't apply, so these pin the
  // hook it keys off; the 24px lane itself is checked in the screenshots.
  const lane = () => shells().map((s) => s.dataset['seamLane'] ?? 'none');

  test("@placement='end' with @scroll='content': the seam keeps its hit lane inside the rail", async function (assert) {
    await render(<template>
      <Sidebar @label='A' @mobile={{false}} @placement='end' @scroll='content' @resizable={{true}}><:nav>Lots</:nav></Sidebar>
      <Sidebar @label='B' @mobile={{false}} @placement='start' @scroll='content' @resizable={{true}}><:nav>Lots</:nav></Sidebar>
      <Sidebar @label='C' @mobile={{false}} @placement='end' @scroll='page' @resizable={{true}}><:nav>Lots</:nav></Sidebar>
    </template>);
    assert.deepEqual(lane(), ['true', 'none', 'none'], 'only where the content scrollbar runs along the seam');
  });

  test("@placement='end' with @scroll='content': the plain toggle keeps the same lane, and no control means no lane", async function (assert) {
    await render(<template>
      <Sidebar @label='A' @mobile={{false}} @placement='end' @scroll='content'><:nav>Lots</:nav></Sidebar>
      <Sidebar @label='B' @mobile={{false}} @placement='end' @scroll='content' @open={{false}}><:nav>Lots</:nav></Sidebar>
      <Sidebar @label='C' @mobile={{false}} @placement='end' @scroll='content' @collapsible='none'><:nav>Lots</:nav></Sidebar>
      <Sidebar @label='D' @mobile={{true}} @placement='end' @scroll='content'><:nav>Lots</:nav></Sidebar>
    </template>);
    assert.dom('[data-test-pretui-sidebar-handle]').exists({ count: 2 });
    assert.deepEqual(lane(), ['true', 'true', 'none', 'none'], 'expanded and icon rail alike; not for a pinned rail or the drawer');
  });

  test('@resizable: a rem @width keeps its unit until the seam moves', async function (assert) {
    let rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    await render(<template><Sidebar @label='Library' @mobile={{false}} @resizable={{true}} @width='15rem'><:nav>Lots</:nav></Sidebar></template>);
    assert.strictEqual(shells()[0]!.style.getPropertyValue('--pretui-sidebar-width'), '15rem', 'the caller\'s unit');
    assert.dom('[data-test-pretui-sidebar-resize]').hasAttribute('aria-valuenow', String(Math.round(15 * rem)), 'announced in px');
    await triggerKeyEvent('[data-test-pretui-sidebar-resize]', 'keydown', 'ArrowRight');
    assert.strictEqual(shells()[0]!.style.getPropertyValue('--pretui-sidebar-width'), Math.round(15 * rem + 16) + 'px', 'px once resized');
  });

  test('@resizable: a rem @width outside the bounds is still clamped', async function (assert) {
    await render(<template><Sidebar @label='Library' @mobile={{false}} @resizable={{true}} @width='40rem' @maxWidth={{300}}><:nav>Lots</:nav></Sidebar></template>);
    assert.strictEqual(shells()[0]!.style.getPropertyValue('--pretui-sidebar-width'), '300px');
  });

  // The slide itself is CSS the harness doesn't apply. What it rests on: a
  // resize only moves the width, and a fold or open only flips the state, so
  // the registered open fraction slides while the width follows at once.
  test('@resizable: a keyboard resize moves only the width, a keyboard fold and open only the state', async function (assert) {
    const width = () => shells()[0]!.style.getPropertyValue('--pretui-sidebar-width');
    await render(<template><Sidebar @label='Library' @mobile={{false}} @resizable={{true}} @width='200px'><:nav>Lots</:nav></Sidebar></template>);
    seamEl().focus();
    await triggerKeyEvent('[data-test-pretui-sidebar-resize]', 'keydown', 'ArrowRight');
    assert.deepEqual([state(), width()], ['expanded', '216px'], 'the arrow key changes the width alone');
    await triggerKeyEvent('[data-test-pretui-sidebar-resize]', 'keydown', 'Home');
    assert.deepEqual([state(), width()], ['collapsed', '216px'], 'Home folds and keeps the width');
    await click('[data-test-pretui-sidebar-handle]');
    assert.deepEqual([state(), width()], ['expanded', '216px'], 'reopening returns to it');
    assert.strictEqual(document.activeElement, seamEl(), 'focus is back on the seam');
  });

  test("a folded offcanvas rail drops the seam lane, so its toggle sits on the shell's edge", async function (assert) {
    await render(<template><Sidebar @label='A' @mobile={{false}} @placement='end' @scroll='content' @collapsible='offcanvas' @open={{false}}><:nav>Lots</:nav></Sidebar></template>);
    assert.dom('[data-test-pretui-sidebar-handle]').exists();
    assert.deepEqual(lane(), ['none']);
  });

  // The centering is CSS the harness doesn't apply; this pins the markup it
  // rests on, and the screenshots the look.
  test('SidebarItem: icon and label are siblings on the row, in the expanded list and the icon rail alike', async function (assert) {
    await render(<template>
      <SidebarItem @label='Lots' @icon={{Icon24}} @onClick={{noop}} />
      <SidebarItem @label='Bids' @collapsed={{true}} @onClick={{noop}}><:icon><Icon24 /></:icon></SidebarItem>
    </template>);
    let [expanded, rail] = [...document.querySelectorAll('[data-test-pretui-sidebar-item]')];
    let kids = (el: Element | undefined) => [...(el?.children ?? [])].map((c) => c.hasAttribute('data-test-pretui-sidebar-item-icon') ? 'icon' : c.hasAttribute('data-test-pretui-sidebar-item-label') ? 'label' : c.tagName);
    assert.deepEqual(kids(expanded), ['icon', 'label'], 'one row, icon then label');
    assert.deepEqual(kids(rail), ['icon'], 'the rail square holds the icon alone');
    assert.dom('[data-test-pretui-sidebar-item-icon] > svg', rail as HTMLElement).exists('a yielded glyph sits directly in the icon box');
  });

  test('SidebarItem @icon renders the icon into the sized slot, decorative', async function (assert) {
    await render(<template><SidebarItem @label='Lots' @icon={{Icon24}} /></template>);
    assert.dom('[data-test-pretui-sidebar-item-icon] > svg').exists();
    assert.dom('[data-test-pretui-sidebar-item] svg').hasAttribute('aria-hidden', 'true');
    assert.dom('[data-test-pretui-sidebar-item]').hasAttribute('aria-label', 'Lots');
  });

  test('SidebarTrigger takes the attributes it is given', async function (assert) {
    await render(<template><SidebarTrigger @open={{true}} @onToggle={{noop}} @controls='rail' class='t-trigger' data-test-mine /></template>);
    assert.dom('[data-test-pretui-sidebar-trigger]').hasClass('t-trigger').hasAttribute('data-test-mine');
  });

  test('SidebarItem <:action> sits beside the row control, not inside it, and the row carries the active state', async function (assert) {
    let picked: string[] = [];
    let pick = () => picked.push('row');
    let add = () => picked.push('add');
    await render(<template>
      <SidebarItem @label='Notes' @badge={{3}} @active={{true}} @onClick={{pick}}>
        <:action><button type='button' class='t-add' {{on 'click' add}}>New Note</button></:action>
      </SidebarItem>
    </template>);
    let item = document.querySelector('[data-test-pretui-sidebar-item]')!;
    let action = document.querySelector('[data-test-pretui-sidebar-item-action]')!;
    assert.notOk(item.contains(action), 'the action is not nested in the row control');
    assert.strictEqual(action.parentElement, item.parentElement, 'they share the row');
    assert.dom('[data-test-pretui-sidebar-item-row]').hasAttribute('data-action', 'true').hasAttribute('data-active', 'true');
    await click('.t-add');
    await click('[data-test-pretui-sidebar-item]');
    assert.deepEqual(picked, ['add', 'row'], 'each control acts on its own');
  });

  test('SidebarItem: the icon rail drops the action, and a row without one has none', async function (assert) {
    await render(<template>
      <SidebarItem @label='Notes' @collapsed={{true}} @onClick={{noop}}><:action><button type='button'>New Note</button></:action></SidebarItem>
      <SidebarItem @label='Files' @onClick={{noop}} />
    </template>);
    assert.dom('[data-test-pretui-sidebar-item-action]').doesNotExist();
    assert.dom('[data-test-pretui-sidebar-item-row]').hasAttribute('data-action', 'false');
  });

  test('SidebarItem: a disabled row takes its action out of reach too', async function (assert) {
    await render(<template>
      <SidebarItem @label='Notes' @disabled={{true}} @onClick={{noop}}><:action><button type='button' class='t-add-notes'>New Note</button></:action></SidebarItem>
      <SidebarItem @label='Files' @onClick={{noop}}><:action><button type='button' class='t-add-files'>New File</button></:action></SidebarItem>
    </template>);
    let [notes, files] = [...document.querySelectorAll('[data-test-pretui-sidebar-item-action]')];
    assert.true(notes?.hasAttribute('inert'), "the disabled row's action is inert");
    assert.false(files?.hasAttribute('inert'), "an enabled row's action is not");
    let addNote = document.querySelector('.t-add-notes') as HTMLElement;
    addNote.focus();
    assert.notStrictEqual(document.activeElement, addNote, 'so it takes no focus');
  });

  test('SidebarItem: a numeric badge shows, a count of 0 included', async function (assert) {
    await render(<template>
      <SidebarItem @label='Notes' @badge={{0}} @onClick={{noop}} />
      <SidebarItem @label='Files' @onClick={{noop}} />
    </template>);
    assert.dom('[data-test-pretui-sidebar-item-badge]').exists({ count: 1 }).hasText('0');
    assert.strictEqual(
      document.querySelector('[data-test-pretui-sidebar-item]')?.getAttribute('aria-describedby'),
      document.querySelector('[data-test-pretui-sidebar-item-badge]')?.id,
      'the count describes its row',
    );
  });
});
