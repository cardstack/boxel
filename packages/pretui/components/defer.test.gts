// Pretui — Defer unit tests.
import { module, test } from 'qunit';
import { render, waitUntil } from '@ember/test-helpers';
import { htmlSafe } from '@ember/template';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Defer } from './defer';

const SCROLLER = htmlSafe('height: 100px; overflow: auto');
const SPACER = htmlSafe('height: 600px');

function state(): string | undefined {
  return (document.querySelector('[data-test-pretui-defer]') as HTMLElement | null)?.dataset['state'];
}

module('Pretui | components/defer', function (hooks) {
  setupCardTest(hooks);

  test('once=false reveals on entry and re-hides on exit; onReveal fires once', async function (assert) {
    let reveals = 0;
    let onReveal = () => reveals++;
    await render(
      <template>
        <div class='t-scroller' style={{SCROLLER}}>
          <div style={{SPACER}}></div>
          <Defer @once={{false}} @rootMargin='0px' @minHeight='40px' @onReveal={{onReveal}}>
            <p data-test-heavy>heavy</p>
          </Defer>
          <div style={{SPACER}}></div>
        </div>
      </template>,
    );
    let scroller = document.querySelector('.t-scroller') as HTMLElement;
    assert.strictEqual(state(), 'pending', 'off-screen: not rendered');

    scroller.scrollTop = 560;
    await waitUntil(() => state() === 'revealed', { timeout: 2000 });
    assert.ok(document.querySelector('[data-test-heavy]'), 'scrolled in: rendered');

    scroller.scrollTop = 0;
    await waitUntil(() => state() === 'pending', { timeout: 2000 });
    assert.notOk(document.querySelector('[data-test-heavy]'), 'scrolled away: unmounted again');

    scroller.scrollTop = 560;
    await waitUntil(() => state() === 'revealed', { timeout: 2000 });
    assert.strictEqual(reveals, 1, 'onReveal is the first reveal only');
  });

  test('the default stays revealed after the content scrolls away', async function (assert) {
    await render(
      <template>
        <div class='t-scroller' style={{SCROLLER}}>
          <div style={{SPACER}}></div>
          <Defer @rootMargin='0px' @minHeight='40px'><p data-test-heavy>heavy</p></Defer>
          <div style={{SPACER}}></div>
        </div>
      </template>,
    );
    let scroller = document.querySelector('.t-scroller') as HTMLElement;
    scroller.scrollTop = 560;
    await waitUntil(() => state() === 'revealed', { timeout: 2000 });
    scroller.scrollTop = 0;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    assert.strictEqual(state(), 'revealed');
  });
});
