// Pretui — Scroller unit tests. Scoped styles are inert in this harness, so the
// viewport's box is set inline here to give it something to overflow.
import { module, test } from 'qunit';
import { render, settled, waitUntil } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Scroller } from './scroller';

const WIDE = htmlSafe('display: inline-block; width: 600px');

class State {
  @tracked more = false;
}

module('Pretui | components/scroller', function (hooks) {
  setupCardTest(hooks);

  test('content added after install re-measures the edges', async function (assert) {
    let state = new State();
    await render(
      <template>
        <Scroller @label='Lots'>
          <span>short</span>
          {{#if state.more}}<span style={{WIDE}}>a long row</span>{{/if}}
        </Scroller>
      </template>,
    );
    let viewport = document.querySelector('[data-test-pretui-scroller-viewport]') as HTMLElement;
    viewport.style.width = '100px';
    viewport.style.overflowX = 'auto';
    viewport.style.whiteSpace = 'nowrap';
    await waitUntil(() => viewport.dataset['endX'] === 'flush', { timeout: 1000 });
    state.more = true;
    await settled();
    await waitUntil(() => viewport.dataset['endX'] === 'clipped', { timeout: 1000 });
    assert.strictEqual(viewport.dataset['endX'], 'clipped', 'the new child made the content overflow, and the edge says so');
  });
});
