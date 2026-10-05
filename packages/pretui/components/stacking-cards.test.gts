// Pretui — StackingCards unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm. The one computed-style read is the injection pin; the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { StackingCards } from './stacking-cards';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-stacking-cards]') as HTMLElement;
}

module('Pretui | components/stacking-cards', function (hooks) {
  setupCardTest(hooks);

  test('yields a Card that renders as an article, and publishes the pin offset', async function (assert) {
    await render(
      <template>
        <StackingCards as |S|>
          <S.Card><h3 data-test-one>One</h3></S.Card>
          <S.Card><h3 data-test-two>Two</h3></S.Card>
        </StackingCards>
      </template>,
    );
    assert.strictEqual(root().getAttribute('style'), '--pretui-stack-offset: 12px');
    let cards = Array.from(root().querySelectorAll('[data-test-pretui-stacking-card]')) as HTMLElement[];
    assert.strictEqual(cards.length, 2);
    assert.deepEqual(cards.map((c) => c.tagName), ['ARTICLE', 'ARTICLE'], 'each stacked card is its own article');
    assert.ok(cards[1]?.querySelector('[data-test-two]'));
  });

  test('takes a caller offset', async function (assert) {
    await render(<template><StackingCards @offset={{24}} as |S|><S.Card>x</S.Card></StackingCards></template>);
    assert.strictEqual(root().getAttribute('style'), '--pretui-stack-offset: 24px');
  });

  test('a string smuggled into @offset is rejected and the default offset paints', async function (assert) {
    const EVIL = '0px; background: red; --junk: 0' as unknown as number;
    await render(<template><StackingCards @offset={{EVIL}} as |S|><S.Card>x</S.Card></StackingCards></template>);
    assert.strictEqual(
      root().getAttribute('style'),
      '--pretui-stack-offset: 12px',
      'the whole attribute is the default offset — nothing of the payload survives',
    );
    assert.notStrictEqual(
      getComputedStyle(root()).backgroundColor,
      'rgb(255, 0, 0)',
      'and nothing was applied',
    );
  });
});
