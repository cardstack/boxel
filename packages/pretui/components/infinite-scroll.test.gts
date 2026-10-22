// Pretui — InfiniteScroll unit tests: the sentinel asks for more inside the
// pane, the button is always there, busy holds off, the end is shown.
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { click, render, settled, waitUntil } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { InfiniteScroll } from './infinite-scroll';
import { htmlSafe } from '@ember/template';

const PANE = htmlSafe('block-size: 100px; overflow-y: auto;');
const ROW = htmlSafe('block-size: 30px;');

class Pages {
  @tracked hasMore = true;
  last = () => (this.hasMore = false);
}

const ROWS = Array.from({ length: 20 }, (_, i) => `Lot ${i + 1}`);

module('Pretui | components/infinite-scroll', function (hooks) {
  setupCardTest(hooks);

  test('scrolling the pane near the end asks for the next page', async function (assert) {
    let asks = 0;
    let more = () => asks++;
    await render(<template>
      <div class='t-pane' style={{PANE}}>
        <InfiniteScroll @onLoadMore={{more}} @rootMargin='0px'>
          {{#each ROWS as |row|}}<div style={{ROW}}>{{row}}</div>{{/each}}
        </InfiniteScroll>
      </div>
    </template>);
    assert.strictEqual(asks, 0, 'nothing until the end is near');
    let pane = document.querySelector('.t-pane') as HTMLElement;
    pane.scrollTop = pane.scrollHeight;
    await waitUntil(() => asks > 0, { timeout: 2000 });
    assert.ok(asks >= 1);
    let sentinel = document.querySelector('[data-test-pretui-infinite-sentinel]') as HTMLElement;
    assert.strictEqual(sentinel.getAttribute('aria-hidden'), 'true');
  });

  test('the Load more button is always there and asks too', async function (assert) {
    let asks = 0;
    let more = () => asks++;
    await render(<template><InfiniteScroll @onLoadMore={{more}} @auto={{false}} @loadLabel='More lots'><p>Lot 1</p></InfiniteScroll></template>);
    let button = document.querySelector('[data-test-pretui-infinite-load]') as HTMLButtonElement;
    assert.strictEqual(button.textContent?.trim(), 'More lots');
    await click(button);
    assert.strictEqual(asks, 1);
  });

  test('busy marks the region and refuses a second request', async function (assert) {
    let asks = 0;
    let more = () => asks++;
    await render(<template><InfiniteScroll @onLoadMore={{more}} @busy={{true}} @auto={{false}}><p>Lot 1</p></InfiniteScroll></template>);
    assert.strictEqual(
      (document.querySelector('[data-test-pretui-infinite-scroll]') as HTMLElement).getAttribute('aria-busy'),
      'true',
    );
    await click('[data-test-pretui-infinite-load]');
    assert.strictEqual(asks, 0);
  });

  test('with nothing more, the end block replaces the button and nothing is asked', async function (assert) {
    await render(<template>
      <InfiniteScroll @hasMore={{false}}>
        <:default><p>Lot 1</p></:default>
        <:end>That is every lot.</:end>
      </InfiniteScroll>
    </template>);
    assert.notOk(document.querySelector('[data-test-pretui-infinite-load]'));
    assert.strictEqual(document.querySelector('[data-test-pretui-infinite-end]')?.textContent?.trim(), 'That is every lot.');
  });

  test('the loaded message is one polite line', async function (assert) {
    await render(<template><InfiniteScroll @loadedMessage='Loaded 20 more lots'><p>Lot 1</p></InfiniteScroll></template>);
    let status = document.querySelector('[data-test-pretui-infinite-status]') as HTMLElement;
    assert.strictEqual(status.getAttribute('role'), 'status');
    assert.strictEqual(status.textContent?.trim(), 'Loaded 20 more lots');
  });

  test('when the last page lands, focus moves from the removed button to the end of the list', async function (assert) {
    let pages = new Pages();
    await render(<template>
      <InfiniteScroll @onLoadMore={{pages.last}} @hasMore={{pages.hasMore}} @auto={{false}}>
        <:default><p>Lot 1</p></:default>
        <:end>That is every lot.</:end>
      </InfiniteScroll>
    </template>);
    let button = document.querySelector('[data-test-pretui-infinite-load]') as HTMLElement;
    button.focus();
    await click(button);
    await settled();
    assert.strictEqual(document.activeElement, document.querySelector('[data-test-pretui-infinite-end]'), 'not the page');
  });
});
