// Pretui — ToolRow unit tests: the status word per state, the live region,
// ToolLine's spoken tone, the receipt action's focus, and the gate handing
// focus back to the row's header.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness.
import { module, test } from 'qunit';
import { render, click, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ToolRow, ToolLine, ToolReceiptAction } from './tool-row';

function statusOf(row: Element): string {
  return row.querySelector('[data-test-pretui-tool-row-status]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

class Receipt {
  @tracked refusal: string | undefined;
}

class Gate {
  @tracked open = true;
}

// focus and mutation callbacks settle in microtasks and the next task
async function flush() {
  await settled();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

module('Pretui | components/tool-row', function (hooks) {
  setupCardTest(hooks);

  test('a timed completed call says only its time; other done states keep their word', async function (assert) {
    await render(
      <template>
        <ToolRow @name='read' @state='completed' @duration={{12}} data-test-row='completed' />
        <ToolRow @name='write' @state='partial' @duration={{12}} data-test-row='partial' />
        <ToolRow @name='write' @state='kept' @duration={{3}} data-test-row='kept' />
      </template>,
    );
    let completed = document.querySelector('[data-test-row="completed"]')!;
    let partial = document.querySelector('[data-test-row="partial"]')!;
    let kept = document.querySelector('[data-test-row="kept"]')!;
    assert.strictEqual(statusOf(completed), '12s');
    assert.strictEqual(statusOf(partial), '12s partly kept', 'a partial keep never reads like a success');
    assert.strictEqual(statusOf(kept), '3s kept');
    assert.dom('[data-test-pretui-tool-row-status]', completed).hasAttribute('data-timed');
    assert.dom('[data-test-pretui-tool-row-status]', partial).doesNotHaveAttribute('data-timed');
  });

  test('the live region is polite for a failure and assertive only for a call that needs the reader', async function (assert) {
    await render(
      <template>
        <ToolRow @name='read' @state='failed' data-test-row='failed' />
        <ToolRow @name='read' @state='awaiting-approval' data-test-row='attention' />
      </template>,
    );
    assert.dom('[data-test-row="failed"] [data-test-pretui-tool-row-live]').hasAttribute('aria-live', 'polite');
    assert.dom('[data-test-row="failed"] [data-test-pretui-tool-row-live]').hasText('Read: failed');
    assert.dom('[data-test-row="attention"] [data-test-pretui-tool-row-live]').hasAttribute('aria-live', 'assertive');
  });

  test('a failed or attention ToolLine says its tone in words', async function (assert) {
    await render(
      <template>
        <ToolLine @tone='failed' @glyph='✕' data-test-line='failed'>Fetch menus</ToolLine>
        <ToolLine @tone='attention' @glyph='!' data-test-line='attention'>Pick a layout</ToolLine>
        <ToolLine @tone='done' @glyph='✓' data-test-line='done'>Read plan.gts</ToolLine>
      </template>,
    );
    assert.dom('[data-test-line="failed"] [data-test-pretui-tool-line-tone]').hasText('Failed:');
    assert.dom('[data-test-line="attention"] [data-test-pretui-tool-line-tone]').hasText('Needs attention:');
    assert.dom('[data-test-line="done"] [data-test-pretui-tool-line-tone]').doesNotExist();
  });

  test('a refused receipt action announces in a region that was already there, and keeps focus', async function (assert) {
    let state = new Receipt();
    const undo = () => undefined;
    await render(<template><ToolReceiptAction @label='Undo' @onAct={{undo}} @refusal={{state.refusal}} /></template>);
    assert.dom('[role="status"]').exists('the live region is present before anything is refused');
    let button = document.querySelector('[data-test-pretui-tool-receipt-action]') as HTMLElement;
    button.focus();
    state.refusal = 'Not undone · file changed since the run';
    await flush();
    assert.dom('[role="status"] [data-test-pretui-tool-receipt-refusal]').hasText('Not undone · file changed since the run');
    assert.strictEqual(
      document.activeElement,
      document.querySelector('[data-test-pretui-tool-receipt-refusal]'),
      'focus moves to the refusal, not to the page body',
    );
  });

  test('a busy receipt action keeps focus and refuses a second press', async function (assert) {
    let calls = 0;
    let finish: () => void = () => undefined;
    const undo = () => {
      calls++;
      return new Promise<void>((resolve) => (finish = resolve));
    };
    await render(<template><ToolReceiptAction @label='Undo' @onAct={{undo}} /></template>);
    let button = document.querySelector('[data-test-pretui-tool-receipt-action]') as HTMLButtonElement;
    button.focus();
    click(button);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.false(button.disabled, 'busy is not the disabled attribute');
    assert.dom(button).hasAttribute('aria-disabled', 'true');
    assert.strictEqual(document.activeElement, button);
    await click(button);
    assert.strictEqual(calls, 1, 'the second press does nothing');
    finish();
    await settled();
    assert.dom(button).doesNotHaveAttribute('aria-disabled');
  });

  test('when the gate closes with focus in it, focus goes to the row header, on a row with no body too', async function (assert) {
    let gate = new Gate();
    await render(
      <template>
        <ToolRow @name='run' @state='awaiting-approval'>
          <:gate>{{#if gate.open}}<button type='button' data-test-allow>Allow</button>{{/if}}</:gate>
        </ToolRow>
      </template>,
    );
    (document.querySelector('[data-test-allow]') as HTMLElement).focus();
    gate.open = false;
    await flush();
    let header = document.querySelector('[data-toolrow-header]') as HTMLElement;
    assert.strictEqual(document.activeElement, header, 'the static header takes focus');
    assert.dom(header).hasAttribute('tabindex', '-1');
  });

  test('a gate change after the reader left for blank space moves no focus', async function (assert) {
    let gate = new Gate();
    await render(
      <template>
        <ToolRow @name='run' @state='awaiting-approval'>
          <:gate>{{#if gate.open}}<button type='button' data-test-allow>Allow</button>{{/if}}</:gate>
        </ToolRow>
      </template>,
    );
    let allow = document.querySelector('[data-test-allow]') as HTMLElement;
    allow.focus();
    // a click on blank page space: focus leaves with no related target
    allow.blur();
    await flush();
    gate.open = false;
    await flush();
    assert.notStrictEqual(document.activeElement, document.querySelector('[data-toolrow-header]'), 'focus stays where the reader left it');
  });
});
