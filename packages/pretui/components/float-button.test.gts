// Pretui — FloatButton unit tests: the single action, the placement mapping,
// and the speed dial's disclosure contract — expanded state, Escape, outside
// click and choosing an action all close it and give focus back.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`.
import { module, test } from 'qunit';
import { click, render, triggerEvent, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { FloatButton } from './float-button';
import type { FloatButtonAction } from './float-button';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';

class Open {
  @tracked open = true;
  set = (v: boolean) => (this.open = v);
}

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-float-button]') as HTMLElement;
}
function main(): HTMLButtonElement {
  return document.querySelector('[data-test-pretui-float-main]') as HTMLButtonElement;
}
function dial(): HTMLElement {
  return document.querySelector('[data-test-pretui-float-dial]') as HTMLElement;
}

module('Pretui | components/float-button', function (hooks) {
  setupCardTest(hooks);

  test('a single action is a named button that fires @onAction', async function (assert) {
    let fired = 0;
    let act = () => fired++;
    await render(<template><FloatButton @label='Compose' @onAction={{act}} data-pane='inbox' /></template>);
    assert.strictEqual(root().getAttribute('data-pane'), 'inbox');
    assert.strictEqual(main().getAttribute('aria-label'), 'Compose', 'icon-only, so the label is the name');
    assert.notOk(main().hasAttribute('aria-expanded'), 'no dial, no disclosure state');
    assert.notOk(dial(), 'no dial rendered');
    await click(main());
    assert.strictEqual(fired, 1);
  });

  test('@extended shows the label as text and drops the redundant aria-label', async function (assert) {
    await render(<template><FloatButton @label='Compose' @extended={{true}} /></template>);
    assert.strictEqual(main().textContent?.trim(), 'Compose');
    assert.notOk(main().hasAttribute('aria-label'));
  });

  test('placement defaults to bottom-end and maps the physical spellings', async function (assert) {
    await render(<template>
      <div class='t-a'><FloatButton @label='A' /></div>
      <div class='t-b'><FloatButton @label='B' @placement='top-left' /></div>
      <div class='t-c'><FloatButton @label='C' @placement='sideways' /></div>
    </template>);
    let at = (sel: string) =>
      (document.querySelector(`${sel} [data-test-pretui-float-button]`) as HTMLElement).dataset['placement'];
    assert.strictEqual(at('.t-a'), 'bottom-end');
    assert.strictEqual(at('.t-b'), 'top-start');
    assert.strictEqual(at('.t-c'), 'bottom-end', 'an unknown placement falls back');
  });

  test('with @actions it is a disclosure that opens a labelled list and does not fire @onAction', async function (assert) {
    let fired = 0;
    let act = () => fired++;
    let actions: FloatButtonAction[] = [
      { id: 'note', label: 'New note' },
      { id: 'task', label: 'New task' },
    ];
    await render(<template><FloatButton @label='Create' @actions={{actions}} @onAction={{act}} /></template>);
    assert.strictEqual(main().getAttribute('aria-expanded'), 'false');
    assert.strictEqual(main().getAttribute('aria-controls'), dial().id, 'the button controls the dial');
    assert.true(dial().hidden, 'closed, the dial is hidden');
    await click(main());
    assert.strictEqual(main().getAttribute('aria-expanded'), 'true');
    assert.false(dial().hidden);
    assert.strictEqual(fired, 0, 'the dial replaces the single action');
    let labels = [...dial().querySelectorAll('button')].map((b) => b.textContent?.trim());
    assert.deepEqual(labels, ['New note', 'New task'], 'each action is a button named by its label');
    assert.notStrictEqual(document.activeElement?.closest('[data-test-pretui-float-dial]'), dial(), 'opening does not move focus into the dial');
  });

  test('choosing an action fires it, closes the dial and returns focus to the button', async function (assert) {
    let chosen: string[] = [];
    let actions: FloatButtonAction[] = [
      { id: 'note', label: 'New note', onSelect: () => chosen.push('note') },
      { id: 'task', label: 'New task', onSelect: () => chosen.push('task') },
    ];
    await render(<template><FloatButton @label='Create' @actions={{actions}} /></template>);
    await click(main());
    await click('[data-test-pretui-float-action="task"]');
    assert.deepEqual(chosen, ['task']);
    assert.strictEqual(main().getAttribute('aria-expanded'), 'false');
    assert.strictEqual(document.activeElement, main(), 'focus is back on the button');
  });

  test('Escape closes the dial and returns focus to the button', async function (assert) {
    let actions: FloatButtonAction[] = [{ id: 'note', label: 'New note' }];
    await render(<template><FloatButton @label='Create' @actions={{actions}} /></template>);
    await click(main());
    (dial().querySelector('button') as HTMLButtonElement).focus();
    await triggerKeyEvent(document.activeElement as Element, 'keydown', 'Escape');
    assert.strictEqual(main().getAttribute('aria-expanded'), 'false');
    assert.strictEqual(document.activeElement, main());
  });

  test('a pointer press outside closes the dial; one inside does not', async function (assert) {
    let actions: FloatButtonAction[] = [{ id: 'note', label: 'New note' }];
    await render(<template>
      <p class='t-outside'>Elsewhere</p>
      <FloatButton @label='Create' @actions={{actions}} />
    </template>);
    await click(main());
    await triggerEvent(dial(), 'pointerdown');
    assert.strictEqual(main().getAttribute('aria-expanded'), 'true', 'inside keeps it open');
    await triggerEvent('.t-outside', 'pointerdown');
    assert.strictEqual(main().getAttribute('aria-expanded'), 'false', 'outside closes it');
  });

  test('controlled: @open drives the dial and @onOpenChange reports requests', async function (assert) {
    let requests: boolean[] = [];
    let report = (open: boolean) => requests.push(open);
    let actions: FloatButtonAction[] = [{ id: 'note', label: 'New note' }];
    await render(<template>
      <FloatButton @label='Create' @actions={{actions}} @open={{true}} @onOpenChange={{report}} />
    </template>);
    assert.false(dial().hidden, 'open because the caller says so');
    await click(main());
    assert.deepEqual(requests, [false], 'the toggle is reported');
    assert.false(dial().hidden, 'and the caller still owns the state');
  });

  test('Escape from another widget is that widget’s, not the dial’s', async function (assert) {
    let actions: FloatButtonAction[] = [{ id: 'note', label: 'New note' }];
    let heard = 0;
    let hear = (e: Event) => {
      if ((e as KeyboardEvent).key === 'Escape') heard++;
    };
    await render(<template>
      <input class='t-other' aria-label='Other' {{on 'keydown' hear}} />
      <FloatButton @label='Create' @actions={{actions}} />
    </template>);
    await click(main());
    let other = document.querySelector('.t-other') as HTMLElement;
    other.focus();
    await triggerKeyEvent(other, 'keydown', 'Escape');
    assert.strictEqual(heard, 1, 'the other widget heard its Escape');
    assert.strictEqual(main().getAttribute('aria-expanded'), 'true', 'and the dial stayed open');
  });

  test('a dial opened through @open, never clicked, still returns focus to the button', async function (assert) {
    let actions: FloatButtonAction[] = [{ id: 'note', label: 'New note' }];
    let state = new Open();
    await render(<template><FloatButton @label='Create' @actions={{actions}} @open={{state.open}} @onOpenChange={{state.set}} /></template>);
    let action = document.querySelector('[data-test-pretui-float-action="note"]') as HTMLElement;
    action.focus();
    await click(action);
    assert.false(state.open, 'the choice closed it');
    assert.strictEqual(document.activeElement, main(), 'and focus went back to the button, not the page');
  });

  test('a caller id does not break outside-press detection', async function (assert) {
    let actions: FloatButtonAction[] = [{ id: 'note', label: 'New note' }];
    await render(<template><FloatButton @label='Create' @actions={{actions}} id='fab' /></template>);
    await click(main());
    await triggerEvent(dial(), 'pointerdown');
    assert.strictEqual(main().getAttribute('aria-expanded'), 'true', 'a press inside is not outside');
  });
});
