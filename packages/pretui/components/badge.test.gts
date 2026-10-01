// Pretui — Badge unit tests: count display, max, dot, zero, invisibility and
// the spoken run that keeps the child's own name.
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Badge } from './badge';

function mark(sel = ''): HTMLElement | null {
  return document.querySelector(`${sel} [data-test-pretui-badge-mark]`);
}
function spoken(sel = ''): string | undefined {
  return document.querySelector(`${sel} [data-test-pretui-badge-spoken]`)?.textContent?.trim();
}

module('Pretui | components/badge', function (hooks) {
  setupCardTest(hooks);

  test('it overlays the count on the child, hides the mark and speaks the meaning', async function (assert) {
    await render(<template>
      <Badge @count={{3}} @label='unread' data-kind='inbox'><button type='button'>Messages</button></Badge>
    </template>);
    let root = document.querySelector('[data-test-pretui-badge]') as HTMLElement;
    assert.strictEqual(root.getAttribute('data-kind'), 'inbox');
    assert.strictEqual(mark()?.textContent?.trim(), '3');
    assert.strictEqual(mark()?.getAttribute('aria-hidden'), 'true', 'the bare number is not read');
    assert.strictEqual(spoken(), '3 unread');
    assert.strictEqual(document.querySelector('[data-test-pretui-badge] button')?.textContent?.trim(), 'Messages', 'the child keeps its own name');
    assert.strictEqual(root.dataset['placement'], 'top-end');
  });

  test('above @max it reads max+, and the spoken count stays exact', async function (assert) {
    await render(<template>
      <div class='t-a'><Badge @count={{120}}><span>A</span></Badge></div>
      <div class='t-b'><Badge @count={{12}} @max={{9}} @label='new'><span>B</span></Badge></div>
    </template>);
    assert.strictEqual(mark('.t-a')?.textContent?.trim(), '99+');
    assert.strictEqual(spoken('.t-a'), '120');
    assert.strictEqual(mark('.t-b')?.textContent?.trim(), '9+');
    assert.strictEqual(spoken('.t-b'), '12 new');
  });

  test('zero hides the badge unless @showZero', async function (assert) {
    await render(<template>
      <div class='t-a'><Badge @count={{0}}><span>A</span></Badge></div>
      <div class='t-b'><Badge @count={{0}} @showZero={{true}}><span>B</span></Badge></div>
    </template>);
    assert.notOk(mark('.t-a'));
    assert.notOk(spoken('.t-a'), 'and says nothing');
    assert.strictEqual(mark('.t-b')?.textContent?.trim(), '0');
  });

  test('@dot, or no count, draws a dot with no number', async function (assert) {
    await render(<template>
      <div class='t-a'><Badge @dot={{true}} @count={{4}} @label='unread'><span>A</span></Badge></div>
      <div class='t-b'><Badge @label='new activity'><span>B</span></Badge></div>
    </template>);
    assert.strictEqual(mark('.t-a')?.dataset['dot'], 'true');
    assert.strictEqual(mark('.t-a')?.textContent?.trim(), '');
    assert.strictEqual(spoken('.t-a'), '4 unread', 'the count is still spoken');
    assert.strictEqual(mark('.t-b')?.dataset['dot'], 'true');
    assert.strictEqual(spoken('.t-b'), 'new activity');
  });

  test('@invisible hides mark and speech but keeps the child', async function (assert) {
    await render(<template><Badge @count={{5}} @invisible={{true}}><span class='t-child'>A</span></Badge></template>);
    assert.notOk(mark());
    assert.notOk(spoken());
    assert.ok(document.querySelector('.t-child'));
  });

  test('tone and placement resolve their aliases', async function (assert) {
    await render(<template><Badge @count={{1}} @tone='error' @placement='bottom-left'><span>A</span></Badge></template>);
    assert.strictEqual(mark()?.dataset['tone'], 'danger');
    assert.strictEqual((document.querySelector('[data-test-pretui-badge]') as HTMLElement).dataset['placement'], 'bottom-start');
  });

  test('a focusable child is described by the spoken count, keeping its own descriptions', async function (assert) {
    await render(<template>
      <p id='t-hint'>Opens the inbox</p>
      <Badge @count={{3}} @label='unread'><button type='button' aria-describedby='t-hint'>Messages</button></Badge>
    </template>);
    let btn = document.querySelector('[data-test-pretui-badge] button') as HTMLElement;
    let spokenEl = document.querySelector('[data-test-pretui-badge-spoken]') as HTMLElement;
    let ids = (btn.getAttribute('aria-describedby') ?? '').split(' ');
    assert.true(ids.includes('t-hint'), 'the existing description stays');
    assert.true(ids.includes(spokenEl.id), 'and the count is added');
  });

  test('a hidden badge describes nothing', async function (assert) {
    await render(<template><Badge @count={{0}} @label='unread'><button type='button'>Messages</button></Badge></template>);
    let btn = document.querySelector('[data-test-pretui-badge] button') as HTMLElement;
    assert.notOk(btn.hasAttribute('aria-describedby'));
  });
});
