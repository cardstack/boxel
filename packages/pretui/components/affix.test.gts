// Pretui — Affix unit tests: the wrapper is sticky, and scrolling past it
// reports and yields the pinned state.
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render, waitUntil } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Affix } from './affix';
import { htmlSafe } from '@ember/template';

const PANE = htmlSafe('block-size: 120px; overflow-y: auto;');
const INTRO = htmlSafe('block-size: 40px;');
const STICKY_BAR = htmlSafe('position: sticky; top: 0; block-size: 20px;');
const CONTENT = htmlSafe('block-size: 600px;');

function affix(): HTMLElement {
  return document.querySelector('[data-test-pretui-affix]') as HTMLElement;
}

module('Pretui | components/affix', function (hooks) {
  setupCardTest(hooks);

  test('it wraps the child, top by default, and starts unpinned', async function (assert) {
    await render(<template><Affix data-bar='tools'><span class='t-child'>Tools</span></Affix></template>);
    assert.strictEqual(affix().dataset['position'], 'top');
    assert.strictEqual(affix().dataset['pinned'], 'false');
    assert.strictEqual(affix().getAttribute('data-bar'), 'tools');
    assert.ok(affix().querySelector('.t-child'));
  });

  test('scrolling the pane past it pins it, and scrolling back releases it', async function (assert) {
    let seen: boolean[] = [];
    let change = (pinned: boolean) => seen.push(pinned);
    await render(<template>
      <div class='t-pane' style={{PANE}}>
        <div style={{INTRO}}>Intro</div>
        <Affix @onChange={{change}} as |pinned|>
          <div class='t-bar' style={{STICKY_BAR}} data-pinned={{if pinned 'yes' 'no'}}>Tools</div>
        </Affix>
        <div style={{CONTENT}}>Content</div>
      </div>
    </template>);
    let pane = document.querySelector('.t-pane') as HTMLElement;
    pane.scrollTop = 200;
    await waitUntil(() => affix().dataset['pinned'] === 'true', { timeout: 2000 });
    assert.strictEqual(document.querySelector('.t-bar')?.getAttribute('data-pinned'), 'yes', 'the block is told');
    pane.scrollTop = 0;
    await waitUntil(() => affix().dataset['pinned'] === 'false', { timeout: 2000 });
    assert.deepEqual(seen, [true, false]);
  });

  test('bottom position', async function (assert) {
    await render(<template><Affix @position='bottom' @offset='8px'><span>Save</span></Affix></template>);
    assert.strictEqual(affix().dataset['position'], 'bottom');
    assert.ok(affix().getAttribute('style')?.includes('--pretui-affix-offset: 8px'));
  });
});
