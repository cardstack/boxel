// Pretui — proof of the React-dialect alias layer on the overlay territory.
// Placement is the axis four kits spell four ways (Radix `side`+`align`,
// Mantine `position`, Vaul/shadcn `direction`, everyone else `placement`),
// so most of this file exercises the resolver directly as a pure function —
// the popup's actual placement lands in inline top/left, which `boxel test`
// cannot meaningfully assert.

import { module, test } from 'qunit';
import { on } from '@ember/modifier';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';
import { Dialog } from './components/dialog';
import { Drawer } from './components/drawer';
import { Popover } from './components/popover';
import { resolveDrawerPlacement, resolveOpen, resolvePlacement } from './internal/overlay';

class Sink {
  @tracked last: unknown = undefined;
  @tracked calls = 0;
  take = (v: unknown) => {
    this.last = v;
    this.calls += 1;
  };
}

function q(sel: string): HTMLElement | null {
  return document.querySelector(sel);
}

module('Pretui | React-dialect aliases — overlay', function (hooks) {
  setupCardTest(hooks);

  test('resolvePlacement folds side+align, position and logical edges into @placement', function (assert) {
    assert.strictEqual(
      resolvePlacement({ placement: 'top-end' }, 'bottom-start'),
      'top-end',
      'the house spelling passes through untouched',
    );
    assert.strictEqual(
      resolvePlacement({ side: 'top', align: 'end' }, 'bottom-start'),
      'top-end',
      "Radix's split pair composes",
    );
    assert.strictEqual(
      resolvePlacement({ side: 'right' }, 'bottom-start'),
      'right',
      'a bare side centres, as Radix does',
    );
    assert.strictEqual(
      resolvePlacement({ position: 'bottom-start' }, 'top'),
      'bottom-start',
      "Mantine's composite `position`",
    );
    assert.strictEqual(
      resolvePlacement({ placement: 'start' }, 'bottom'),
      'left',
      'logical start → left in LTR',
    );
    assert.strictEqual(
      resolvePlacement({ placement: 'inline-end' }, 'bottom'),
      'right',
      'inline-end survives the hyphen split intact',
    );
    assert.strictEqual(
      resolvePlacement({ placement: 'sideways' }, 'bottom-start'),
      'bottom-start',
      'an unrecognised placement falls back instead of positioning nowhere',
    );
    assert.strictEqual(
      resolvePlacement({}, 'bottom-start'),
      'bottom-start',
      'nothing supplied keeps the default',
    );
  });

  test('resolveDrawerPlacement maps physical edges onto the logical pair', function (assert) {
    assert.strictEqual(resolveDrawerPlacement({ placement: 'right' }), 'end');
    assert.strictEqual(resolveDrawerPlacement({ direction: 'left' }), 'start');
    assert.strictEqual(
      resolveDrawerPlacement({ position: 'bottom' }),
      'bottom',
    );
    assert.strictEqual(
      resolveDrawerPlacement({ side: 'top' }),
      'end',
      'a Drawer has no top edge; the unsupported value falls back',
    );
  });

  test('resolveOpen accepts isOpen and opened', function (assert) {
    assert.strictEqual(resolveOpen({ isOpen: true }), true);
    assert.strictEqual(resolveOpen({ opened: false }), false);
    assert.strictEqual(resolveOpen({ open: false, isOpen: true }), false);
    assert.strictEqual(resolveOpen({}), undefined);
  });

  test('Dialog accepts isOpen, lg and onOpenChange', async function (assert) {
    let sink = new Sink();
    await render(<template>
      <Dialog @isOpen={{true}} @size='lg' @onOpenChange={{sink.take}}>
        <:title>Confirm</:title>
        <:default>Body</:default>
      </Dialog>
    </template>);
    let dialog = q('[data-test-pretui-dialog]') as HTMLDialogElement;
    assert.true(dialog.open, '@isOpen opened it');
    assert.strictEqual(dialog.dataset['size'], 'l', 'lg → l');

    await click(dialog);
    assert.strictEqual(
      sink.last,
      false,
      '@onOpenChange(false) fired on a backdrop dismiss — no @onClose passed, ' +
        'which used to be a hard TypeError',
    );
  });

  test('Drawer accepts direction=left and onOpenChange', async function (assert) {
    let sink = new Sink();
    await render(<template>
      <Drawer @opened={{true}} @direction='left' @onOpenChange={{sink.take}}>
        <:default>Panel</:default>
      </Drawer>
    </template>);
    let drawer = q('[data-test-pretui-drawer]') as HTMLDialogElement;
    assert.true(drawer.open, '@opened opened it');
    assert.strictEqual(
      drawer.dataset['placement'],
      'start',
      'direction=left → the logical start edge',
    );
    await click(drawer);
    assert.strictEqual(sink.last, false, '@onOpenChange fired');
  });

  test('Popover is now a hybrid: defaultOpen + onOpenChange, uncontrolled still works', async function (assert) {
    let sink = new Sink();
    await render(<template>
      <Popover @defaultOpen={{true}} @side='top' @onOpenChange={{sink.take}}>
        <:trigger as |open toggle|>
          <button type='button' data-test-pop-trigger {{on 'click' toggle}}>
            {{if open 'Close' 'Open'}}
          </button>
        </:trigger>
        <:default>Panel body</:default>
      </Popover>
    </template>);
    assert.ok(
      q('[data-test-pretui-popover] .pretui-popover-panel'),
      '@defaultOpen opened it without a controlled arg',
    );
    await click('[data-test-pop-trigger]');
    assert.strictEqual(sink.calls, 1, '@onOpenChange fired on close');
    assert.strictEqual(sink.last, false, '…with the next open state');
    assert.notOk(
      q('[data-test-pretui-popover] .pretui-popover-panel'),
      'uncontrolled state still moves on its own',
    );
  });

  test('Popover honours a controlled @open', async function (assert) {
    let sink = new Sink();
    await render(<template>
      <Popover @open={{true}} @onOpenChange={{sink.take}}>
        <:trigger as |open toggle|>
          <button type='button' data-test-pop2-trigger {{on 'click' toggle}}>
            {{if open 'Close' 'Open'}}
          </button>
        </:trigger>
        <:default>Panel body</:default>
      </Popover>
    </template>);
    await click('[data-test-pop2-trigger]');
    assert.strictEqual(sink.last, false, 'the parent is told');
    assert.ok(
      q('[data-test-pretui-popover] .pretui-popover-panel'),
      'but the panel stays open until the parent says otherwise',
    );
  });
});
