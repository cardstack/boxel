// Pretui — render + semantics proof for Sidebar, SidebarTrigger, SidebarGroup,
// SidebarItem and ScrollArea.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
//
// Nothing here asserts a computed style (the harness delivers no scoped
// stylesheet). What is asserted is what these components actually control:
// landmark roles and names, the aria-expanded / aria-controls relationship
// that every source library omits, keyboard reachability, the
// controlled/uncontrolled contract, and the opt-in persistence boundary.
import { module, test } from 'qunit';
import { click, render, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';

import { ScrollArea } from './components/scroll-area';
import { Sidebar, SidebarGroup, SidebarItem, SidebarTrigger } from './components/sidebar';

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}

/** The storage key namespace the component owns. Removed around every test
 * that touches persistence so one test cannot seed another. */
const KEY = 'pretui-sidebar:t-suite';
function clearKey() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable in this context; the tests that need it skip below.
  }
}
function storageWorks(): boolean {
  try {
    localStorage.setItem(KEY, 'open');
    localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

// ── Sidebar ──────────────────────────────────────────────────────────────

module('Pretui | structure-shell | Sidebar', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(10000);
    clearKey();
  });
  hooks.afterEach(function () {
    clearKey();
  });

  test('the rail is a named landmark and the handle is wired to it', async function (assert) {
    await render(
      <template>
        <Sidebar @label='Workspace'>
          <:nav><span>nav</span></:nav>
          <:default><span>page</span></:default>
        </Sidebar>
      </template>,
    );
    let rail = root().querySelector('[data-test-pretui-sidebar-rail]');
    let handle = root().querySelector('[data-test-pretui-sidebar-handle]');
    assert.ok(rail, 'the rail renders');
    assert.strictEqual(
      rail?.tagName,
      'NAV',
      'a real landmark — shadcn ships a bare div with no role at all',
    );
    assert.strictEqual(rail?.getAttribute('aria-label'), 'Workspace');
    assert.ok(rail?.id, 'and it has an id to be referenced by');

    assert.ok(handle, 'the handle renders');
    assert.strictEqual(
      handle?.tagName,
      'BUTTON',
      'a real button, not a div with a click handler',
    );
    assert.strictEqual(
      (handle as HTMLButtonElement).tabIndex,
      0,
      'IN the tab order — shadcn sets tabIndex -1 and Ant has no tab stop at all',
    );
    assert.strictEqual(
      handle?.getAttribute('aria-controls'),
      rail?.id,
      'aria-controls points at the rail',
    );
    assert.strictEqual(handle?.getAttribute('aria-expanded'), 'true');
    assert.strictEqual(
      handle?.getAttribute('aria-label'),
      'Collapse Workspace',
      'the name states the ACTION and names which rail',
    );
  });

  test('the handle name follows the state', async function (assert) {
    await render(
      <template>
        <Sidebar @label='Workspace' @defaultOpen={{false}}>
          <:nav><span>nav</span></:nav>
          <:default><span>page</span></:default>
        </Sidebar>
      </template>,
    );
    let handle = root().querySelector('[data-test-pretui-sidebar-handle]');
    assert.strictEqual(handle?.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(handle?.getAttribute('aria-label'), 'Expand Workspace');
  });

  test('uncontrolled: the handle toggles state and reports it', async function (assert) {
    let seen: boolean[] = [];
    let record = (next: boolean) => seen.push(next);
    await render(
      <template>
        <Sidebar @label='W' @onOpenChange={{record}}>
          <:nav><span>nav</span></:nav>
          <:default><span>page</span></:default>
        </Sidebar>
      </template>,
    );
    let shell = root().querySelector('[data-test-pretui-sidebar]');
    assert.strictEqual(shell?.getAttribute('data-state'), 'expanded');
    await click('[data-test-pretui-sidebar-handle]');
    assert.strictEqual(shell?.getAttribute('data-state'), 'collapsed');
    await click('[data-test-pretui-sidebar-handle]');
    assert.strictEqual(shell?.getAttribute('data-state'), 'expanded');
    assert.deepEqual(seen, [false, true], 'the callback carries the next state');
  });

  test('controlled: the component obeys the arg and still reports', async function (assert) {
    let seen: boolean[] = [];
    let record = (next: boolean) => seen.push(next);
    await render(
      <template>
        <Sidebar @label='W' @open={{true}} @onOpenChange={{record}}>
          <:nav><span>nav</span></:nav>
          <:default><span>page</span></:default>
        </Sidebar>
      </template>,
    );
    await click('[data-test-pretui-sidebar-handle]');
    assert.strictEqual(
      root().querySelector('[data-test-pretui-sidebar]')?.getAttribute('data-state'),
      'expanded',
      'the arg wins over the click',
    );
    assert.deepEqual(seen, [false], 'and the parent is told what was asked');
  });

  test('collapsible none pins the rail open and removes the handle', async function (assert) {
    await render(
      <template>
        <Sidebar @label='W' @collapsible='none'>
          <:nav><span>nav</span></:nav>
          <:default><span>page</span></:default>
        </Sidebar>
      </template>,
    );
    assert.strictEqual(
      root().querySelectorAll('[data-test-pretui-sidebar-handle]').length,
      0,
      'no affordance for something that cannot happen',
    );
    assert.strictEqual(
      root().querySelector('[data-test-pretui-sidebar]')?.getAttribute(
        'data-collapsible',
      ),
      'none',
    );
  });

  test('a physical placement is mapped to the logical one', async function (assert) {
    await render(
      <template>
        <Sidebar @label='W' @placement='right'>
          <:nav><span>nav</span></:nav>
          <:default><span>page</span></:default>
        </Sidebar>
      </template>,
    );
    assert.strictEqual(
      root().querySelector('[data-test-pretui-sidebar]')?.getAttribute(
        'data-placement',
      ),
      'end',
      'right resolves to end, so RTL is a dir attribute rather than a rewrite',
    );
  });

  test('the default block is handed the toggle and the rail id', async function (assert) {
    await render(
      <template>
        <Sidebar @label='W'>
          <:nav><span>nav</span></:nav>
          <:default as |bar|>
            <SidebarTrigger
              @open={{bar.open}}
              @onToggle={{bar.toggle}}
              @controls={{bar.controls}}
              @label='workspace rail'
            />
          </:default>
        </Sidebar>
      </template>,
    );
    let rail = root().querySelector('[data-test-pretui-sidebar-rail]');
    let trigger = root().querySelector('[data-test-pretui-sidebar-trigger]');
    assert.ok(trigger, 'the trigger renders from the yielded hash');
    assert.strictEqual(
      trigger?.getAttribute('aria-controls'),
      rail?.id,
      'the yielded id is the rail id — no context provider to forget',
    );
    assert.strictEqual(trigger?.getAttribute('aria-expanded'), 'true');
    assert.strictEqual(
      trigger?.getAttribute('aria-label'),
      'Collapse workspace rail',
    );
    await click('[data-test-pretui-sidebar-trigger]');
    assert.strictEqual(
      root().querySelector('[data-test-pretui-sidebar]')?.getAttribute('data-state'),
      'collapsed',
      'and the yielded toggle works',
    );
  });

  test('the nav block is told whether it is at icon width', async function (assert) {
    await render(
      <template>
        <Sidebar @label='W' @collapsible='rail' @defaultOpen={{false}}>
          <:nav as |bar|>
            <span class='t-state'>{{if bar.collapsed 'icon' 'full'}}</span>
          </:nav>
          <:default><span>page</span></:default>
        </Sidebar>
      </template>,
    );
    assert.strictEqual(
      root().querySelector('.t-state')?.textContent?.trim(),
      'icon',
      'so an item can shrink without a context read',
    );
  });

  test('Cmd/Ctrl + the shortcut key toggles the rail', async function (assert) {
    await render(
      <template>
        <Sidebar @label='W'>
          <:nav><span>nav</span></:nav>
          <:default><span>page</span></:default>
        </Sidebar>
      </template>,
    );
    let shell = root().querySelector('[data-test-pretui-sidebar]') as HTMLElement;
    // Uppercase: triggerKeyEvent rejects a lowercase single-character key, and
    // the component matches case-insensitively because a real browser reports
    // `b` with caps off and `B` with shift or caps on.
    await triggerKeyEvent(shell, 'keydown', 'B', { ctrlKey: true });
    assert.strictEqual(shell.getAttribute('data-state'), 'collapsed');
    await triggerKeyEvent(shell, 'keydown', 'B', { metaKey: true });
    assert.strictEqual(shell.getAttribute('data-state'), 'expanded');
  });

  test('the bare key without a modifier does nothing', async function (assert) {
    await render(
      <template>
        <Sidebar @label='W'>
          <:nav><span>nav</span></:nav>
          <:default><span>page</span></:default>
        </Sidebar>
      </template>,
    );
    let shell = root().querySelector('[data-test-pretui-sidebar]') as HTMLElement;
    await triggerKeyEvent(shell, 'keydown', 'B');
    assert.strictEqual(shell.getAttribute('data-state'), 'expanded');
  });

  test('the shortcut stays out of the way while you are typing', async function (assert) {
    await render(
      <template>
        <Sidebar @label='W'>
          <:nav><span>nav</span></:nav>
          <:default><input class='t-field' aria-label='Search' /></:default>
        </Sidebar>
      </template>,
    );
    let field = root().querySelector('.t-field') as HTMLInputElement;
    await triggerKeyEvent(field, 'keydown', 'B', { metaKey: true });
    assert.strictEqual(
      root().querySelector('[data-test-pretui-sidebar]')?.getAttribute('data-state'),
      'expanded',
      'Cmd+B in a text field is bold, not a layout toggle — the bug shadcn ships',
    );
  });

  test('the shortcut can be turned off, and the key renamed', async function (assert) {
    await render(
      <template>
        <Sidebar @label='Off' @shortcut={{false}}>
          <:nav><span>nav</span></:nav>
          <:default><span>page</span></:default>
        </Sidebar>
      </template>,
    );
    let shell = root().querySelector('[data-test-pretui-sidebar]') as HTMLElement;
    await triggerKeyEvent(shell, 'keydown', 'B', { metaKey: true });
    assert.strictEqual(shell.getAttribute('data-state'), 'expanded');

    await render(
      <template>
        <Sidebar @label='Renamed' @shortcutKey='j'>
          <:nav><span>nav</span></:nav>
          <:default><span>page</span></:default>
        </Sidebar>
      </template>,
    );
    let two = root().querySelector('[data-test-pretui-sidebar]') as HTMLElement;
    await triggerKeyEvent(two, 'keydown', 'B', { metaKey: true });
    assert.strictEqual(two.getAttribute('data-state'), 'expanded', 'b is inert now');
    await triggerKeyEvent(two, 'keydown', 'J', { metaKey: true });
    assert.strictEqual(two.getAttribute('data-state'), 'collapsed', 'j toggles');
  });

  test('with no persistKey nothing is written to storage', async function (assert) {
    if (!storageWorks()) {
      assert.ok(true, 'storage unavailable in this context — nothing to prove');
      return;
    }
    await render(
      <template>
        <Sidebar @label='W'>
          <:nav><span>nav</span></:nav>
          <:default><span>page</span></:default>
        </Sidebar>
      </template>,
    );
    await click('[data-test-pretui-sidebar-handle]');
    assert.strictEqual(
      localStorage.getItem(KEY),
      null,
      'opt-in means opt-in — shadcn writes a cookie on every toggle regardless',
    );
  });

  test('persistKey writes the preference and restores it on the next mount', async function (assert) {
    if (!storageWorks()) {
      assert.ok(true, 'storage unavailable in this context — nothing to prove');
      return;
    }
    await render(
      <template>
        <Sidebar @label='W' @persistKey='t-suite'>
          <:nav><span>nav</span></:nav>
          <:default><span>page</span></:default>
        </Sidebar>
      </template>,
    );
    await click('[data-test-pretui-sidebar-handle]');
    assert.strictEqual(
      localStorage.getItem(KEY),
      'closed',
      'the collapse is written under the namespaced key',
    );

    // A second mount with the opposite default must still restore `closed`.
    await render(
      <template>
        <Sidebar @label='W' @persistKey='t-suite' @defaultOpen={{true}}>
          <:nav><span>nav</span></:nav>
          <:default><span>page</span></:default>
        </Sidebar>
      </template>,
    );
    assert.strictEqual(
      root().querySelector('[data-test-pretui-sidebar]')?.getAttribute('data-state'),
      'collapsed',
      'the stored preference beats defaultOpen',
    );
  });

  test('a stored preference never fights a controlled parent', async function (assert) {
    if (!storageWorks()) {
      assert.ok(true, 'storage unavailable in this context — nothing to prove');
      return;
    }
    localStorage.setItem(KEY, 'closed');
    await render(
      <template>
        <Sidebar @label='W' @persistKey='t-suite' @open={{true}}>
          <:nav><span>nav</span></:nav>
          <:default><span>page</span></:default>
        </Sidebar>
      </template>,
    );
    assert.strictEqual(
      root().querySelector('[data-test-pretui-sidebar]')?.getAttribute('data-state'),
      'expanded',
      'the controlled arg owns the value; restore stays out of it',
    );
  });

  test('the drawer mode moves the rail into the top layer', async function (assert) {
    await render(
      <template>
        <Sidebar @label='W' @mobile={{true}}>
          <:nav><span class='t-nav'>nav</span></:nav>
          <:default><span>page</span></:default>
        </Sidebar>
      </template>,
    );
    let shell = root().querySelector('[data-test-pretui-sidebar]');
    assert.strictEqual(shell?.getAttribute('data-mobile'), 'true');
    let drawer = root().querySelector('[data-test-pretui-drawer]');
    assert.ok(drawer, 'the rail is inside the kit Drawer, not a hand-rolled sheet');
    assert.strictEqual(
      drawer?.tagName,
      'DIALOG',
      'so the focus trap, Escape and stacking come from the platform',
    );
    assert.ok(
      drawer?.querySelector('[data-test-pretui-sidebar-rail]'),
      'and the rail is inside it',
    );
    assert.strictEqual(
      root().querySelectorAll('[data-test-pretui-sidebar-handle]').length,
      0,
      'the seam handle has no meaning in the drawer mode',
    );
  });
});

// ── SidebarGroup ─────────────────────────────────────────────────────────

module('Pretui | structure-shell | SidebarGroup', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(10000);
  });

  test('a label names the group', async function (assert) {
    await render(
      <template>
        <SidebarGroup @label='Library'><span class='t-kid'>x</span></SidebarGroup>
      </template>,
    );
    let group = root().querySelector('[data-test-pretui-sidebar-group]');
    let label = group?.querySelector('.pretui-sbgroup-label');
    assert.strictEqual(group?.getAttribute('role'), 'group');
    assert.strictEqual(
      group?.getAttribute('aria-labelledby'),
      label?.id,
      'the group is named by its own heading',
    );
    assert.strictEqual(label?.textContent?.trim(), 'Library');
    assert.ok(root().querySelector('.t-kid'), 'children render');
  });

  test('hideLabel keeps the name and removes the picture', async function (assert) {
    await render(
      <template>
        <SidebarGroup @label='Library' @hideLabel={{true}}><span>x</span></SidebarGroup>
      </template>,
    );
    let group = root().querySelector('[data-test-pretui-sidebar-group]');
    let label = group?.querySelector('.pretui-sbgroup-label');
    assert.strictEqual(
      label?.getAttribute('data-hidden'),
      'true',
      'the sr-only treatment, not a label yanked off screen with opacity',
    );
    assert.strictEqual(
      group?.getAttribute('aria-labelledby'),
      label?.id,
      'and it is still the accessible name',
    );
  });

  test('no label means no dangling reference', async function (assert) {
    await render(
      <template><SidebarGroup><span>x</span></SidebarGroup></template>,
    );
    assert.notOk(
      root()
        .querySelector('[data-test-pretui-sidebar-group]')
        ?.getAttribute('aria-labelledby'),
    );
  });
});

// ── SidebarItem ──────────────────────────────────────────────────────────

module('Pretui | structure-shell | SidebarItem', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(10000);
  });

  test('an href navigates and marks the current page', async function (assert) {
    await render(
      <template>
        <SidebarItem @label='Lots' @href='#lots' @active={{true}} />
      </template>,
    );
    let item = root().querySelector('[data-test-pretui-sidebar-item]');
    assert.strictEqual(item?.tagName, 'A', 'a thing that navigates is a link');
    assert.strictEqual(item?.getAttribute('href'), '#lots');
    assert.strictEqual(
      item?.getAttribute('aria-current'),
      'page',
      'and the current location is stated, not just coloured',
    );
    assert.strictEqual(item?.getAttribute('data-active'), 'true');
  });

  test('no href means a button', async function (assert) {
    let hits = 0;
    let bump = () => {
      hits = hits + 1;
    };
    await render(
      <template><SidebarItem @label='Lots' @onClick={{bump}} /></template>,
    );
    let item = root().querySelector('[data-test-pretui-sidebar-item]');
    assert.strictEqual(item?.tagName, 'BUTTON', 'a thing that acts is a button');
    assert.strictEqual((item as HTMLButtonElement).type, 'button');
    await click('[data-test-pretui-sidebar-item]');
    assert.strictEqual(hits, 1, 'and it fires');
    assert.notOk(
      item?.getAttribute('aria-current'),
      'a non-current row says nothing rather than saying false',
    );
  });

  test('disabled stays focusable and refuses to act', async function (assert) {
    let hits = 0;
    let bump = () => {
      hits = hits + 1;
    };
    await render(
      <template>
        <SidebarItem @label='Lots' @disabled={{true}} @onClick={{bump}} />
      </template>,
    );
    let item = root().querySelector(
      '[data-test-pretui-sidebar-item]',
    ) as HTMLButtonElement;
    assert.strictEqual(item.getAttribute('aria-disabled'), 'true');
    assert.notOk(item.hasAttribute('disabled'), 'never the native attribute');
    await click('[data-test-pretui-sidebar-item]');
    assert.strictEqual(hits, 0, 'and the handler is the gate');
  });

  test('an href plus disabled degrades to a button, because a link cannot be disabled', async function (assert) {
    await render(
      <template>
        <SidebarItem @label='Lots' @href='#lots' @disabled={{true}} />
      </template>,
    );
    assert.strictEqual(
      root().querySelector('[data-test-pretui-sidebar-item]')?.tagName,
      'BUTTON',
      'shadcn styles a disabled anchor, which does nothing at all',
    );
  });

  test('collapsed keeps the name and adds a tooltip', async function (assert) {
    await render(
      <template>
        <SidebarItem @label='Lots' @collapsed={{true}}>
          <:icon><span class='t-icon'>i</span></:icon>
        </SidebarItem>
      </template>,
    );
    let item = root().querySelector('[data-test-pretui-sidebar-item]');
    assert.strictEqual(item?.getAttribute('data-collapsed'), 'true');
    assert.strictEqual(
      item?.getAttribute('aria-label'),
      'Lots',
      'the name is an argument, so it cannot go missing when the text does',
    );
    assert.strictEqual(
      item?.querySelectorAll('.pretui-sbitem-label').length,
      0,
      'the visible label is gone',
    );
    assert.ok(
      root().querySelector('[data-test-pretui-sidebar-item-tip]'),
      'and a tooltip carries it for sighted users',
    );
    assert.ok(root().querySelector('.t-icon'), 'the icon survives the collapse');
  });

  test('expanded shows the label and the badge', async function (assert) {
    await render(
      <template><SidebarItem @label='Lots' @badge='12' /></template>,
    );
    let item = root().querySelector('[data-test-pretui-sidebar-item]');
    assert.strictEqual(item?.getAttribute('data-collapsed'), 'false');
    assert.strictEqual(
      item?.querySelector('.pretui-sbitem-label')?.textContent?.trim(),
      'Lots',
    );
    assert.strictEqual(
      item?.querySelector('.pretui-sbitem-badge')?.textContent?.trim(),
      '12',
    );
    assert.strictEqual(
      root().querySelectorAll('[data-test-pretui-sidebar-item-tip]').length,
      0,
      'no tooltip when the label is already visible',
    );
  });
});

// ── ScrollArea ───────────────────────────────────────────────────────────

module('Pretui | structure-shell | ScrollArea', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(10000);
  });

  test('delegates to Scroller and names the region', async function (assert) {
    await render(
      <template>
        <ScrollArea @label='Activity' @orientation='vertical'>
          <span class='t-kid'>x</span>
        </ScrollArea>
      </template>,
    );
    let area = root().querySelector('[data-test-pretui-scroll-area]');
    let viewport = root().querySelector('[data-test-pretui-scroller-viewport]');
    assert.ok(area, 'the alias renders');
    assert.ok(viewport, 'and it IS a Scroller — one implementation, two names');
    assert.strictEqual(viewport?.getAttribute('role'), 'region');
    assert.strictEqual(viewport?.getAttribute('aria-label'), 'Activity');
    assert.strictEqual(viewport?.getAttribute('data-orientation'), 'vertical');
    assert.ok(root().querySelector('.t-kid'), 'children render');
  });

  test('vertical is the default, matching what Radix implies', async function (assert) {
    await render(
      <template><ScrollArea><span>x</span></ScrollArea></template>,
    );
    assert.strictEqual(
      root()
        .querySelector('[data-test-pretui-scroller-viewport]')
        ?.getAttribute('data-orientation'),
      'vertical',
    );
  });

  test('the Radix type vocabulary maps onto the native scrollbar', async function (assert) {
    await render(
      <template>
        <ScrollArea @label='A' @type='hover'><span>x</span></ScrollArea>
      </template>,
    );
    assert.strictEqual(
      root()
        .querySelector('[data-test-pretui-scroller-viewport]')
        ?.getAttribute('data-hide-scrollbar'),
      'true',
      'hover hides the native bar and leans on the edge affordance',
    );
    assert.strictEqual(
      root().querySelector('[data-test-pretui-scroll-area]')?.getAttribute('data-type'),
      'hover',
      'and the requested policy is reflected for styling and tests',
    );

    await render(
      <template>
        <ScrollArea @label='A' @type='always'><span>x</span></ScrollArea>
      </template>,
    );
    assert.notOk(
      root()
        .querySelector('[data-test-pretui-scroller-viewport]')
        ?.getAttribute('data-hide-scrollbar'),
      'always keeps the native bar, which is the whole point of not rebuilding one',
    );
  });

  test('an unnamed area is not promoted to a landmark', async function (assert) {
    await render(
      <template><ScrollArea><span>x</span></ScrollArea></template>,
    );
    assert.notOk(
      root()
        .querySelector('[data-test-pretui-scroller-viewport]')
        ?.getAttribute('role'),
      'an unnamed region is noise in a rotor, so the role waits for a name',
    );
  });
});
