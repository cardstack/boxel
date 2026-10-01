// Pretui — proof for AlertDialog, Popconfirm and HoverCard
// (overlay-confirm.gts).
//
// The assertions are chosen around the four things that separate these three
// from the overlays they compose, because those are the parts a screenshot
// cannot show and the parts that regress silently:
//
//  * AlertDialog: `role='alertdialog'`, an outside click that does NOTHING,
//    Escape that cancels, and focus that lands on Cancel with no focus() call.
//  * Popconfirm: the trigger's ARIA contract being applied AND restored, and
//    focus moving into the bubble and back to the trigger.
//  * HoverCard: focus opening it with no delay, the content keeping its own
//    tab stops (the Radix defect), and Escape returning focus.
//
// No computed styles are asserted anywhere: `boxel test` stamps the scoped-CSS
// attribute and delivers no stylesheet, so every one would read as an initial
// value.
//
// Local-only test file; run with `boxel test` from this directory — do NOT
// push to the realm.
import { module, test } from 'qunit';
import { render, click, focus, blur, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { AlertDialog } from './components/alert-dialog';
import { HoverCard } from './components/hover-card';
import { Popconfirm } from './components/popconfirm';
import { DEMOS_ALERT_DIALOG } from './components/alert-dialog.usage';
import { DEMOS_POPCONFIRM } from './components/popconfirm.usage';
import { DEMOS_HOVER_CARD } from './components/hover-card.usage';

class Toggle {
  @tracked open = false;
  @tracked log: string[] = [];
  setOpen = (next: boolean) => {
    this.open = next;
    this.log = [...this.log, next ? 'open' : 'close'];
  };
}

// ── AlertDialog ──────────────────────────────────────────────────────────

module('Pretui | AlertDialog', function (hooks) {
  setupCardTest(hooks);

  test('it is an alertdialog, labelled and described by its own content', async function (assert) {
    let host = new Toggle();
    host.open = true;

    await render(<template>
      <AlertDialog
        @open={{host.open}}
        @onOpenChange={{host.setOpen}}
        @title='Delete 47 records?'
        @description='This cannot be undone.'
      />
    </template>);

    let dialog = document.querySelector(
      '[data-test-pretui-alertdialog]',
    ) as HTMLElement;
    assert.ok(dialog, 'the dialog renders');
    assert.strictEqual(
      dialog.getAttribute('role'),
      'alertdialog',
      'the role tells assistive tech this interrupts rather than presents',
    );

    let labelId = dialog.getAttribute('aria-labelledby');
    let descId = dialog.getAttribute('aria-describedby');
    assert.ok(labelId, 'it is labelled');
    assert.ok(descId, 'and described');
    assert.strictEqual(
      dialog.querySelector('#' + labelId)?.textContent?.trim(),
      'Delete 47 records?',
      'the label points at the question',
    );
    assert.strictEqual(
      dialog.querySelector('#' + descId)?.textContent?.trim(),
      'This cannot be undone.',
      'and the description at the consequence',
    );
  });

  test('Cancel is first in DOM order, so the platform focuses the safe choice', async function (assert) {
    let host = new Toggle();
    host.open = true;

    await render(<template>
      <AlertDialog
        @open={{host.open}}
        @onOpenChange={{host.setOpen}}
        @title='Delete?'
      />
    </template>);

    let dialog = document.querySelector('[data-test-pretui-alertdialog]');
    let buttons = dialog?.querySelectorAll('button') as NodeListOf<HTMLElement>;
    assert.strictEqual(
      buttons[0]?.getAttribute('data-test-pretui-alertdialog-cancel'),
      '',
      'Cancel is the first focusable in the dialog',
    );
    assert.strictEqual(
      buttons[1]?.getAttribute('data-test-pretui-alertdialog-confirm'),
      '',
      'and Confirm follows it',
    );
  });

  test('an outside click does nothing; Escape cancels', async function (assert) {
    let host = new Toggle();
    let cancelled = 0;
    let cancel = () => cancelled++;
    host.open = true;

    await render(<template>
      <AlertDialog
        @open={{host.open}}
        @onOpenChange={{host.setOpen}}
        @onCancel={{cancel}}
        @title='Delete?'
      />
    </template>);

    let dialog = document.querySelector(
      '[data-test-pretui-alertdialog]',
    ) as HTMLElement;

    // A click landing on the <dialog> itself is a click on its ::backdrop.
    await click(dialog);
    assert.true(host.open, 'a stray click outside is not an answer');
    assert.strictEqual(cancelled, 0, 'and does not fire onCancel');

    await triggerKeyEvent(document, 'keydown', 'Escape');
    assert.false(host.open, 'Escape cancels');
    assert.strictEqual(cancelled, 1, 'through the cancel path, once');
  });

  test('busy keeps the dialog open, keeps the button focusable, and refuses a second activation', async function (assert) {
    let host = new Toggle();
    let confirmed = 0;
    let busy = new Toggle();
    let confirm = () => {
      confirmed++;
      // the shape a real caller has: the work starts, and the dialog is held
      // open until it finishes
      busy.open = true;
    };
    host.open = true;

    await render(<template>
      <AlertDialog
        @open={{host.open}}
        @onOpenChange={{host.setOpen}}
        @onConfirm={{confirm}}
        @busy={{busy.open}}
        @title='Delete?'
      />
    </template>);

    let button = document.querySelector(
      '[data-test-pretui-alertdialog-confirm]',
    ) as HTMLElement;
    await click(button);

    assert.strictEqual(confirmed, 1, 'the work was requested');
    assert.true(
      host.open,
      'the dialog stayed open, so a failure still has somewhere to be reported',
    );
    assert.strictEqual(
      button.getAttribute('aria-busy'),
      'true',
      'the button announces itself as pending',
    );
    assert.strictEqual(
      button.getAttribute('disabled'),
      null,
      'and is NOT natively disabled, which would have dropped focus onto the body',
    );

    await click(button);
    assert.strictEqual(
      confirmed,
      1,
      'a second activation while pending is inert',
    );
  });

  test('the trigger block opens it, uncontrolled', async function (assert) {
    await render(<template>
      <AlertDialog @title='Delete?'>
        <:trigger as |isOpen toggle|>
          <button type='button' data-test-open {{on 'click' toggle}}>
            {{if isOpen 'open' 'closed'}}
          </button>
        </:trigger>
      </AlertDialog>
    </template>);

    let dialog = document.querySelector(
      '[data-test-pretui-alertdialog]',
    ) as HTMLDialogElement;
    assert.false(dialog.open, 'it starts closed');

    await click('[data-test-open]');
    assert.true(dialog.open, 'and the yielded toggle opens it with no wiring');
  });
});

// ── Popconfirm ───────────────────────────────────────────────────────────

module('Pretui | Popconfirm', function (hooks) {
  setupCardTest(hooks);

  test('the trigger gets the disclosure contract and gives it back', async function (assert) {
    let host = new Toggle();

    await render(<template>
      <Popconfirm
        @open={{host.open}}
        @onOpenChange={{host.setOpen}}
        @title='Remove?'
      >
        <:trigger as |isOpen toggle|>
          <button type='button' data-test-pc-trigger {{on 'click' toggle}}>
            {{if isOpen 'open' 'Remove'}}
          </button>
        </:trigger>
      </Popconfirm>
    </template>);

    let trigger = document.querySelector(
      '[data-test-pc-trigger]',
    ) as HTMLElement;
    assert.strictEqual(
      trigger.getAttribute('aria-haspopup'),
      'dialog',
      'the caller wired only a click and still got the ARIA',
    );
    assert.strictEqual(
      trigger.getAttribute('aria-expanded'),
      'false',
      'with a live expanded state',
    );

    await click(trigger);
    assert.true(host.open, 'the toggle opens it');
    assert.strictEqual(
      trigger.getAttribute('aria-expanded'),
      'true',
      'and the state follows',
    );
    assert.ok(
      document.querySelector('[data-test-pretui-popconfirm-panel]'),
      'the bubble is a dialog panel',
    );
    assert.strictEqual(
      document
        .querySelector('[data-test-pretui-popconfirm-panel]')
        ?.getAttribute('aria-label'),
      'Remove?',
      'named by its own question',
    );
  });

  test('focus opens on Cancel and Escape returns it to the trigger', async function (assert) {
    let host = new Toggle();
    let cancelled = 0;
    let cancel = () => cancelled++;

    await render(<template>
      <Popconfirm
        @open={{host.open}}
        @onOpenChange={{host.setOpen}}
        @onCancel={{cancel}}
        @title='Remove?'
      >
        <:trigger as |isOpen toggle|>
          <button type='button' data-test-pc-trigger {{on 'click' toggle}}>
            {{if isOpen 'open' 'Remove'}}
          </button>
        </:trigger>
      </Popconfirm>
    </template>);

    let trigger = document.querySelector(
      '[data-test-pc-trigger]',
    ) as HTMLElement;
    await click(trigger);

    assert.strictEqual(
      document.activeElement,
      document.querySelector('[data-test-pretui-popconfirm-cancel]'),
      'focus lands on the safe choice, not on the destructive one',
    );

    await triggerKeyEvent(document, 'keydown', 'Escape');
    assert.false(host.open, 'Escape closes it');
    assert.strictEqual(cancelled, 1, 'through the cancel path');
    assert.strictEqual(
      document.activeElement,
      trigger,
      'and focus is back on the trigger rather than on the body',
    );
  });

  test('confirm fires, closes, and restores focus', async function (assert) {
    let host = new Toggle();
    let confirmed = 0;
    let confirm = () => confirmed++;

    await render(<template>
      <Popconfirm
        @open={{host.open}}
        @onOpenChange={{host.setOpen}}
        @onConfirm={{confirm}}
        @title='Remove?'
      >
        <:trigger as |isOpen toggle|>
          <button type='button' data-test-pc-trigger {{on 'click' toggle}}>
            {{if isOpen 'open' 'Remove'}}
          </button>
        </:trigger>
      </Popconfirm>
    </template>);

    await click('[data-test-pc-trigger]');
    await click('[data-test-pretui-popconfirm-confirm]');

    assert.strictEqual(confirmed, 1, 'the action ran');
    assert.false(host.open, 'the bubble closed');
    assert.strictEqual(
      document.activeElement,
      document.querySelector('[data-test-pc-trigger]'),
      'and focus went home',
    );
  });

  test('showCancel=false leaves the confirm button holding the opening focus', async function (assert) {
    let host = new Toggle();

    await render(<template>
      <Popconfirm
        @open={{host.open}}
        @onOpenChange={{host.setOpen}}
        @showCancel={{false}}
        @title='Remove?'
      >
        <:trigger as |_isOpen toggle|>
          <button type='button' data-test-pc-trigger {{on 'click' toggle}}>go</button>
        </:trigger>
      </Popconfirm>
    </template>);

    await click('[data-test-pc-trigger]');
    assert.notOk(
      document.querySelector('[data-test-pretui-popconfirm-cancel]'),
      'no cancel button',
    );
    assert.strictEqual(
      document.activeElement,
      document.querySelector('[data-test-pretui-popconfirm-confirm]'),
      'so focus is never nowhere',
    );
  });

  test('a disabled trigger opens nothing', async function (assert) {
    let host = new Toggle();

    await render(<template>
      <Popconfirm
        @open={{host.open}}
        @onOpenChange={{host.setOpen}}
        @disabled={{true}}
        @title='Remove?'
      >
        <:trigger as |_isOpen toggle|>
          <button type='button' data-test-pc-trigger {{on 'click' toggle}}>go</button>
        </:trigger>
      </Popconfirm>
    </template>);

    await click('[data-test-pc-trigger]');
    assert.false(host.open, 'the toggle is inert');
    assert.notOk(
      document.querySelector('[data-test-pretui-popconfirm-panel]'),
      'and nothing was rendered',
    );
  });
});

// ── HoverCard ────────────────────────────────────────────────────────────

module('Pretui | HoverCard', function (hooks) {
  setupCardTest(hooks);

  test('focus opens it with no delay and wires the trigger relationship', async function (assert) {
    let host = new Toggle();

    await render(<template>
      <HoverCard @open={{host.open}} @onOpenChange={{host.setOpen}}>
        <:trigger>
          <a href='#x' data-test-hc-trigger>Ama Boateng</a>
        </:trigger>
        <:default>
          <a href='#profile' data-test-hc-link>Open profile</a>
        </:default>
      </HoverCard>
    </template>);

    let trigger = document.querySelector(
      '[data-test-hc-trigger]',
    ) as HTMLElement;
    assert.strictEqual(
      trigger.getAttribute('aria-expanded'),
      'false',
      'the trigger announces the collapsed preview',
    );
    assert.ok(
      trigger.getAttribute('aria-controls'),
      'and points at it, which Radix and shadcn never do',
    );

    await focus(trigger);
    assert.true(
      host.open,
      'focus opens it immediately — a hover delay would be pure latency for a reader who already tabbed here',
    );
    assert.strictEqual(
      trigger.getAttribute('aria-expanded'),
      'true',
      'and the state follows',
    );
  });

  test('the card keeps its own tab stops — the Radix defect, fixed', async function (assert) {
    let host = new Toggle();
    host.open = true;

    await render(<template>
      <HoverCard @open={{host.open}} @onOpenChange={{host.setOpen}}>
        <:trigger>
          <a href='#x' data-test-hc-trigger>Ama Boateng</a>
        </:trigger>
        <:default>
          <a href='#profile' data-test-hc-link>Open profile</a>
        </:default>
      </HoverCard>
    </template>);

    let link = document.querySelector('[data-test-hc-link]') as HTMLElement;
    assert.ok(link, 'the card content rendered');
    assert.strictEqual(
      link.getAttribute('tabindex'),
      null,
      'its links are NOT forced out of the tab order, so a keyboard reader can actually reach them',
    );

    let panel = document.querySelector('[data-test-pretui-hovercard-panel]');
    assert.strictEqual(
      panel?.getAttribute('role'),
      'dialog',
      'the card is a navigable region rather than an unnamed div',
    );
    assert.strictEqual(
      panel?.getAttribute('id'),
      document
        .querySelector('[data-test-hc-trigger]')
        ?.getAttribute('aria-controls'),
      'and it is the thing the trigger points at',
    );
  });

  test('Escape closes it and returns focus to the trigger', async function (assert) {
    let host = new Toggle();

    await render(<template>
      <HoverCard @open={{host.open}} @onOpenChange={{host.setOpen}}>
        <:trigger>
          <a href='#x' data-test-hc-trigger>Ama Boateng</a>
        </:trigger>
        <:default>
          <a href='#profile' data-test-hc-link>Open profile</a>
        </:default>
      </HoverCard>
    </template>);

    let trigger = document.querySelector(
      '[data-test-hc-trigger]',
    ) as HTMLElement;
    await focus(trigger);
    assert.true(host.open, 'open');

    await triggerKeyEvent(document, 'keydown', 'Escape');
    assert.false(host.open, 'Escape closes it');
    assert.strictEqual(
      document.activeElement,
      trigger,
      'and hands focus back rather than stranding it',
    );
  });

  test('focus leaving the whole surface closes it', async function (assert) {
    let host = new Toggle();

    await render(<template>
      <HoverCard @open={{host.open}} @onOpenChange={{host.setOpen}}>
        <:trigger>
          <a href='#x' data-test-hc-trigger>Ama Boateng</a>
        </:trigger>
        <:default>
          <a href='#profile' data-test-hc-link>Open profile</a>
        </:default>
      </HoverCard>
      <button type='button' data-test-elsewhere>elsewhere</button>
    </template>);

    await focus('[data-test-hc-trigger]');
    assert.true(host.open, 'open on focus');

    await blur('[data-test-hc-trigger]');
    assert.false(host.open, 'and closed when focus leaves the surface entirely');
  });
});

// ── Usage pages ──────────────────────────────────────────────────────────
//
// The demo registry is what the gallery mounts. Rendering each page here is
// the cheap standing regression for it: a usage page that throws takes the
// whole gallery down, and it does so at a point far from the edit that caused
// it.

/* eslint-disable @typescript-eslint/no-explicit-any -- the DEMOS_* registries
   are Record<string, unknown> by contract; the gallery casts them the same
   way. */
const PAGES: Record<string, any> = { ...DEMOS_ALERT_DIALOG, ...DEMOS_POPCONFIRM, ...DEMOS_HOVER_CARD } as Record<string, any>;

module('Pretui | DEMOS_OVERLAY_CONFIRM | usage pages', function (hooks) {
  setupCardTest(hooks);

  test('the AlertDialog usage page renders', async function (assert) {
    let Page = PAGES['AlertDialog'];
    assert.ok(Page, 'the page is in the registry');
    await render(<template><Page /></template>);
    assert.dom('.FreestyleUsage').exists('the page mounted');
  });

  test('the Popconfirm usage page renders', async function (assert) {
    let Page = PAGES['Popconfirm'];
    assert.ok(Page, 'the page is in the registry');
    await render(<template><Page /></template>);
    assert.dom('.FreestyleUsage').exists('the page mounted');
  });

  test('the HoverCard usage page renders', async function (assert) {
    let Page = PAGES['HoverCard'];
    assert.ok(Page, 'the page is in the registry');
    await render(<template><Page /></template>);
    assert.dom('.FreestyleUsage').exists('the page mounted');
  });
});
