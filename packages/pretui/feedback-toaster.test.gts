// Pretui — proof for the toast host (feedback-toaster.gts).
//
// Two halves, and the split is the same one menubar.test.gts uses:
//
//  1. **The queue and politeness rules as pure functions.** `visibleToasts`,
//     `queuedCount`, `toastRole`, `toastLive` and `resolveToastPlacement` take
//     data and return data, so the cap, the queue and the severity mapping are
//     driven directly rather than inferred from a rendered stack.
//
//  2. **Render proof** for the parts only a browser settles: the region's
//     role and name, the per-toast roles, the cap, the queue indicator, the
//     dismiss path, and — the one that matters most — that dismissing a
//     focused toast hands focus on rather than dropping it on the body.
//
// **What is deliberately NOT tested: auto-dismiss.** The clock is a CSS
// animation, and `boxel test` stamps the scoped-CSS attribute while delivering
// no stylesheet, so no animation runs and `animationend` never fires. Asserting
// on it here would be asserting on the harness. The mechanism is instead proved
// structurally (the life element exists, carries its duration, and is absent on
// a sticky toast) and by `boxel read-transpiled`, which shows the keyframes and
// `animation-play-state` surviving the transpile.
//
// Run with `boxel test` from this directory; deployment leaves `*.test.gts`
// off the realm.
import { module, test } from 'qunit';
import { render, click, focus, settled, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { DEMOS_TOASTER } from './components/toaster.usage';
import { tracked } from '@glimmer/tracking';
import { Toaster, ToastStore, queuedCount, resolveToastPlacement, toastLive, toastRole, visibleToasts } from './components/toaster';
import type { ToastItem } from './components/toaster';

function fixture(n: number): ToastItem[] {
  let out: ToastItem[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: 't' + i, title: 'Toast ' + i });
  }
  return out;
}

// ── 1. The rules, as data ────────────────────────────────────────────────

module('Pretui | toaster | rules', function () {
  test('the cap renders the oldest, newest-first, and queues the rest', function (assert) {
    let items = fixture(6);
    assert.deepEqual(
      visibleToasts(items, 3).map((t) => t.id),
      ['t3', 't4', 't5'],
      'the three that arrived first render; newer ones wait',
    );
    assert.strictEqual(queuedCount(items, 3), 3, 'three wait behind the cap');
    assert.strictEqual(
      queuedCount(items, 10),
      0,
      'a cap above the count queues nothing',
    );
    assert.strictEqual(
      visibleToasts(items, 0).length,
      0,
      'a cap of zero renders nothing rather than throwing',
    );
    assert.strictEqual(
      queuedCount(items, -4),
      6,
      'a negative cap is clamped, not trusted',
    );
  });

  test('severity picks the live-region politeness', function (assert) {
    assert.strictEqual(toastRole('danger'), 'alert', 'danger interrupts');
    assert.strictEqual(toastRole('warning'), 'alert', 'so does warning');
    assert.strictEqual(toastRole('success'), 'status', 'success waits');
    assert.strictEqual(toastRole('info'), 'status', 'info waits');
    assert.strictEqual(toastRole(undefined), 'status', 'and so does the default');

    assert.strictEqual(toastLive('danger'), 'assertive', 'alert is assertive');
    assert.strictEqual(toastLive('info'), 'polite', 'status is polite');
  });

  test('React placement spellings map onto the logical enum', function (assert) {
    assert.strictEqual(resolveToastPlacement('bottom-right'), 'bottom-end');
    assert.strictEqual(resolveToastPlacement('top-left'), 'top-start');
    assert.strictEqual(resolveToastPlacement('top-center'), 'top');
    assert.strictEqual(
      resolveToastPlacement('bottom-start'),
      'bottom-start',
      'a house value passes through untouched',
    );
    assert.strictEqual(
      resolveToastPlacement(undefined),
      'bottom-end',
      'and the default is the Sonner corner',
    );
  });
});

// ── 2. The store ─────────────────────────────────────────────────────────

module('Pretui | toaster | store', function () {
  test('show adds newest-first and returns a stable id', function (assert) {
    let store = new ToastStore();
    let first = store.show({ title: 'One' });
    let second = store.show({ title: 'Two' });
    assert.notStrictEqual(first, second, 'ids do not collide');
    assert.deepEqual(
      store.items.map((t) => t.title),
      ['Two', 'One'],
      'the newest toast is at the head',
    );
  });

  test('an auto id skips one a caller already supplied', function (assert) {
    let store = new ToastStore();
    store.show({ id: 'toast-1', title: 'Supplied' });
    let auto = store.show({ title: 'Auto' });
    assert.notStrictEqual(auto, 'toast-1', 'the generated id is a fresh one');
    assert.deepEqual(
      store.items.map((t) => t.title),
      ['Auto', 'Supplied'],
      'both toasts are in the stack',
    );
  });

  test('showing an existing id replaces in place rather than reordering', function (assert) {
    let store = new ToastStore();
    store.show({ id: 'job', title: 'Saving…' });
    store.show({ title: 'Something else' });
    store.show({ id: 'job', title: 'Saved', tone: 'success' });
    assert.deepEqual(
      store.items.map((t) => t.title),
      ['Something else', 'Saved'],
      'the updated toast keeps its position in the stack',
    );
    assert.strictEqual(store.items.length, 2, 'and does not duplicate');
  });

  test('dismiss and clear fire each onDismiss exactly once', function (assert) {
    let store = new ToastStore();
    let gone: string[] = [];
    let a = store.show({ title: 'A', onDismiss: () => gone.push('A') });
    store.show({ title: 'B', onDismiss: () => gone.push('B') });

    store.dismiss(a);
    store.dismiss(a);
    assert.deepEqual(gone, ['A'], 'dismissing twice notifies once');

    store.clear();
    assert.deepEqual(gone, ['A', 'B'], 'clear notifies the survivors');
    assert.strictEqual(store.items.length, 0, 'and empties the store');
  });
});

// ── 3. Render proof ──────────────────────────────────────────────────────

class Host {
  @tracked store = new ToastStore();
}

module('Pretui | toaster | render', function (hooks) {
  setupCardTest(hooks);

  test('the region is a named landmark and each toast carries its own role', async function (assert) {
    let store = new ToastStore();
    store.show({ id: 'ok', title: 'Saved', tone: 'success' });
    store.show({ id: 'bad', title: 'Failed', tone: 'danger' });

    await render(<template><Toaster @store={{store}} /></template>);

    let region = document.querySelector('[data-test-pretui-toaster]');
    assert.ok(region, 'the region renders');
    assert.strictEqual(
      region?.tagName,
      'SECTION',
      'a named <section> is a region landmark, so F6 has something to land on',
    );
    assert.strictEqual(
      region?.getAttribute('aria-label'),
      'Notifications',
      'with a default accessible name',
    );

    let ok = region?.querySelector('[data-test-pretui-toast-item="ok"]');
    let bad = region?.querySelector('[data-test-pretui-toast-item="bad"]');
    assert.strictEqual(ok?.getAttribute('role'), 'status', 'success is polite');
    assert.strictEqual(
      ok?.getAttribute('aria-live'),
      'polite',
      'and says so explicitly',
    );
    assert.strictEqual(
      bad?.getAttribute('role'),
      'alert',
      'danger interrupts',
    );
    assert.strictEqual(bad?.getAttribute('aria-live'), 'assertive');
    assert.strictEqual(
      bad?.getAttribute('data-tone'),
      'danger',
      'and reflects its tone for styling',
    );
  });

  test('the cap renders a slice and announces the queue', async function (assert) {
    let store = new ToastStore();
    for (let i = 0; i < 5; i++) {
      store.show({ id: 'q' + i, title: 'Toast ' + i });
    }

    await render(<template><Toaster @store={{store}} @limit={{2}} /></template>);

    let region = document.querySelector('[data-test-pretui-toaster]');
    assert.strictEqual(
      region?.querySelectorAll('[data-test-pretui-toast-item]').length,
      2,
      'only the cap is in the DOM',
    );
    assert.ok(
      region?.querySelector('[data-test-pretui-toaster-queued]'),
      'and the overflow is stated rather than silently dropped',
    );
    assert.notOk(
      region?.querySelector('[data-test-pretui-toast-item="q4"]'),
      'a queued toast has no element, so its clock has not started',
    );
  });

  test('a toast already on screen stays when more arrive past the cap', async function (assert) {
    let store = new ToastStore();
    await render(<template><Toaster @store={{store}} @limit={{2}} /></template>);
    store.show({ id: 'first', title: 'First', duration: 0 });
    await settled();
    let first = document.querySelector('[data-test-pretui-toast-item="first"]');
    assert.ok(first, 'the first toast renders');
    store.show({ id: 'second', title: 'Second', duration: 0 });
    store.show({ id: 'third', title: 'Third', duration: 0 });
    await settled();
    assert.strictEqual(
      document.querySelector('[data-test-pretui-toast-item="first"]'),
      first,
      'the same element, never pushed out and re-mounted',
    );
    assert.notOk(document.querySelector('[data-test-pretui-toast-item="third"]'), 'the newest waits');
  });

  test('replacing a toast by id restarts its clock', async function (assert) {
    let store = new ToastStore();
    await render(<template><Toaster @store={{store}} /></template>);
    store.show({ id: 'save', title: 'Saving…', duration: 30 });
    await settled();
    let before = document.querySelector('[data-test-pretui-toast-item="save"] [data-test-pretui-toast-life]');
    store.show({ id: 'save', title: 'Saved', duration: 30 });
    await settled();
    let after = document.querySelector('[data-test-pretui-toast-item="save"] [data-test-pretui-toast-life]');
    assert.ok(before && after);
    assert.notStrictEqual(after, before, 'a fresh life bar, so the clock starts again');
  });

  test('the life bar carries its own duration and a sticky toast has none', async function (assert) {
    let store = new ToastStore();
    store.show({ id: 'timed', title: 'Timed', duration: 9 });
    store.show({ id: 'sticky', title: 'Sticky', duration: 0 });

    await render(<template><Toaster @store={{store}} /></template>);

    let region = document.querySelector('[data-test-pretui-toaster]');
    let timed = region?.querySelector(
      '[data-test-pretui-toast-item="timed"]',
    ) as HTMLElement | null;
    let sticky = region?.querySelector(
      '[data-test-pretui-toast-item="sticky"]',
    ) as HTMLElement | null;

    assert.strictEqual(
      timed?.style.getPropertyValue('--pretui-toast-life'),
      '9s',
      'the duration reaches CSS as seconds',
    );
    assert.ok(
      timed?.querySelector('[data-test-pretui-toast-life]'),
      'a timed toast has a clock element to age out on',
    );
    assert.notOk(
      sticky?.querySelector('[data-test-pretui-toast-life]'),
      'a sticky toast has none, so nothing can ever remove it but a dismissal',
    );
  });

  test('dismissing removes the toast and fires its callback', async function (assert) {
    let store = new ToastStore();
    let gone = 0;
    store.show({ id: 'x', title: 'Bye', onDismiss: () => gone++ });
    let host = new Host();
    host.store = store;

    await render(<template><Toaster @store={{host.store}} /></template>);

    let region = document.querySelector('[data-test-pretui-toaster]');
    let button = region?.querySelector(
      '[data-test-pretui-toast-dismiss]',
    ) as HTMLElement;
    assert.strictEqual(
      button.getAttribute('aria-label'),
      'Dismiss',
      'the icon-only control has a required accessible name',
    );

    await click(button);
    assert.strictEqual(gone, 1, 'onDismiss fired once');
    assert.strictEqual(
      document.querySelectorAll('[data-test-pretui-toast-item]').length,
      0,
      'and the toast is gone',
    );
  });

  test('dismissing a focused toast hands focus to its neighbour, then back out', async function (assert) {
    let store = new ToastStore();
    store.show({ id: 'a', title: 'A' });
    store.show({ id: 'b', title: 'B' });

    await render(<template>
      <button type='button' data-test-outside>outside</button>
      <Toaster @store={{store}} />
    </template>);

    let outside = document.querySelector('[data-test-outside]') as HTMLElement;
    await focus(outside);

    let region = document.querySelector('[data-test-pretui-toaster]');
    let buttons = region?.querySelectorAll(
      '[data-test-pretui-toast-dismiss]',
    ) as NodeListOf<HTMLElement>;
    assert.strictEqual(buttons.length, 2, 'both toasts are dismissible');

    await focus(buttons[0]);
    await click(buttons[0]);

    let remaining = document.querySelectorAll(
      '[data-test-pretui-toast-dismiss]',
    ) as NodeListOf<HTMLElement>;
    assert.strictEqual(remaining.length, 1, 'one toast left');
    assert.strictEqual(
      document.activeElement,
      remaining[0],
      'focus moved to the surviving toast rather than onto the body',
    );

    await click(remaining[0]);
    assert.strictEqual(
      document.activeElement,
      outside,
      'and the last dismissal returns focus to where it came from',
    );
  });

  test('F6 moves focus into the region and F6 again returns it', async function (assert) {
    let store = new ToastStore();
    store.show({ id: 'a', title: 'A' });

    await render(<template>
      <button type='button' data-test-outside>outside</button>
      <Toaster @store={{store}} />
    </template>);

    let outside = document.querySelector('[data-test-outside]') as HTMLElement;
    await focus(outside);

    let f6 = new KeyboardEvent('keydown', {
      key: 'F6',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(f6);
    assert.true(
      f6.defaultPrevented,
      'the toaster consumes F6 so the browser does not move focus again',
    );
    let inside = document.querySelector(
      '[data-test-pretui-toast-dismiss]',
    ) as HTMLElement;
    assert.strictEqual(
      document.activeElement,
      inside,
      'F6 reaches a toast that is otherwise outside the working tab order',
    );

    await triggerKeyEvent(document, 'keydown', 'F6');
    assert.strictEqual(
      document.activeElement,
      outside,
      'and F6 from inside is a safe way back',
    );
  });

  test('an action fires and dismisses; a controlled host is asked rather than told', async function (assert) {
    let acted = 0;
    let removed: string[] = [];
    let items: ToastItem[] = [
      { id: 'u', title: 'Archived', actionLabel: 'Undo', onAction: () => acted++ },
    ];
    let onDismiss = (id: string) => removed.push(id);

    await render(<template>
      <Toaster @toasts={{items}} @onDismiss={{onDismiss}} />
    </template>);

    let doIt = document.querySelector(
      '[data-test-pretui-toast-action]',
    ) as HTMLElement;
    await click(doIt);

    assert.strictEqual(acted, 1, 'the action ran');
    assert.deepEqual(
      removed,
      ['u'],
      'and the controlled host was asked to remove it rather than the component removing it itself',
    );
    assert.strictEqual(
      document.querySelectorAll('[data-test-pretui-toast-item]').length,
      1,
      'the toast is still there, because in controlled mode the parent owns the list',
    );
  });
});

// ── Usage pages ──────────────────────────────────────────────────────────
//
// The demo registry is what the gallery mounts. Rendering each page here is
// the cheap standing regression for it: a usage page that throws takes the
// whole gallery down, and it does so at a point far from the edit that caused
// it.

/* eslint-disable @typescript-eslint/no-explicit-any -- a DEMOS_* registry is
   Record<string, unknown> by contract; the gallery casts it the same way. */
const PAGES: Record<string, any> = DEMOS_TOASTER as Record<string, any>;

module('Pretui | Toaster | usage page', function (hooks) {
  setupCardTest(hooks);

  test('the Toaster usage page renders', async function (assert) {
    let Page = PAGES['Toaster'];
    assert.ok(Page, 'the page is in the registry');
    await render(<template><Page /></template>);
    assert.dom('.FreestyleUsage').exists('the page mounted');
  });
});
