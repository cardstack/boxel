// Pretui — Carousel unit tests. Scoped styles are inert in this harness, so
// slides are not laid out and scroll positions are not asserted; the current
// dot and the status are what a reader gets, and those are.
import { module, test } from 'qunit';
import { render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Carousel } from './carousel';

const TEAS = ['Gyokuro', 'Sencha', 'Hojicha', 'Matcha'];

class State {
  @tracked index = 0;
  set = (next: number) => (this.index = next);
}

function current(): string | null | undefined {
  return document.querySelector('[data-test-pretui-carousel-dot][aria-current="true"]')?.getAttribute('data-test-pretui-carousel-dot');
}

module('Pretui | components/carousel', function (hooks) {
  setupCardTest(hooks);

  test('a controlled @index moves the carousel when the parent changes it', async function (assert) {
    let state = new State();
    await render(
      <template>
        <Carousel @items={{TEAS}} @label='Teas' @index={{state.index}} @onIndexChange={{state.set}}>
          <:slide as |tea|>{{tea}}</:slide>
        </Carousel>
      </template>,
    );
    assert.strictEqual(current(), '0');
    state.index = 2;
    await settled();
    assert.strictEqual(current(), '2', 'the parent moved it to slide three');
    assert.true(document.querySelector('[data-test-pretui-carousel-status]')?.textContent?.includes('3'), 'and the status says so');
  });
});
