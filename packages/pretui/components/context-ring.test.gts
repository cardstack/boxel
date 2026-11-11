// Pretui — ContextRing unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ContextRing } from './context-ring';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-context-ring]') as HTMLElement;
}

module('Pretui | components/context-ring', function (hooks) {
  setupCardTest(hooks);

  test('names how full the context is, in words and counts', async function (assert) {
    await render(<template><ContextRing @used={{52000}} @limit={{200000}} /></template>);
    assert.strictEqual(root().getAttribute('role'), 'img');
    assert.strictEqual(root().getAttribute('aria-label'), 'Context window 26% used: 52k of 200k tokens');
    assert.dom('[role="tooltip"]').hasText('Context window 26% used: 52k of 200k tokens', 'the tooltip says the same');
    assert.strictEqual(root().dataset['warn'], undefined);
    let tipId = document.querySelector('[role="tooltip"]')?.id;
    assert.strictEqual(root().getAttribute('aria-labelledby'), tipId, 'the ring is named by its tooltip');
  });

  test('past the warning share it says "nearly full" in its name, not only in its colour', async function (assert) {
    await render(<template><ContextRing @used={{170000}} @limit={{200000}} @compact={{true}} /></template>);
    assert.strictEqual(root().dataset['warn'], 'true');
    assert.strictEqual(root().getAttribute('aria-label'), 'Context window 85% used, nearly full: 170k of 200k tokens');
    assert.dom('[role="tooltip"]').hasText('Context window 85% used, nearly full: 170k of 200k tokens', 'compact mode keeps the warning in the tooltip');

    await render(<template><ContextRing @used={{60}} @limit={{100}} @warnAt={{0.5}} /></template>);
    assert.strictEqual(root().getAttribute('aria-label'), 'Context window 60% used, nearly full: 60 of 100 tokens', '@warnAt moves the threshold');
  });

  test('a conversation larger than the window says it is over, not "100% used"', async function (assert) {
    await render(<template><ContextRing @used={{600000}} @limit={{128000}} /></template>);
    assert.strictEqual(root().dataset['over'], 'true');
    assert.strictEqual(root().dataset['warn'], 'true', 'it keeps the attention colour');
    assert.strictEqual(
      root().getAttribute('aria-label'),
      'Context window full: 600k tokens, 472k more than the 128k this model holds. Earlier messages may be summarized when the next one is sent',
    );
    assert.dom('[data-test-pretui-context-ring-pct]').hasText('Full');

    await render(<template><ContextRing @used={{128000}} @limit={{128000}} /></template>);
    assert.strictEqual(root().dataset['over'], undefined, 'a window exactly full is not over');
  });

  test('just over the window, the excess tells the two rounded counts apart', async function (assert) {
    await render(<template><ContextRing @used={{128040}} @limit={{128000}} /></template>);
    assert.strictEqual(
      root().getAttribute('aria-label'),
      'Context window full: 128k tokens, 40 more than the 128k this model holds. Earlier messages may be summarized when the next one is sent',
    );
  });

  test('over the window keeps the attention colour with warnings turned off', async function (assert) {
    await render(<template><ContextRing @used={{600000}} @limit={{128000}} @warnAt={{2}} /></template>);
    assert.strictEqual(root().dataset['over'], 'true');
    assert.strictEqual(root().dataset['warn'], 'true');
  });

  test('in compact mode the tooltip alone says it is over', async function (assert) {
    await render(<template><ContextRing @used={{600000}} @limit={{128000}} @compact={{true}} /></template>);
    assert.dom('[data-test-pretui-context-ring-pct]').doesNotExist();
    assert.true(document.querySelector('[role="tooltip"]')?.textContent?.startsWith('Context window full: 600k tokens'));
  });

  test('a window of a million tokens or more is counted in millions', async function (assert) {
    await render(<template><ContextRing @used={{232600}} @limit={{1000000}} /></template>);
    assert.strictEqual(root().getAttribute('aria-label'), 'Context window 23% used: 232.6k of 1M tokens');

    await render(<template><ContextRing @used={{1200000}} @limit={{1000000}} /></template>);
    assert.strictEqual(
      root().getAttribute('aria-label'),
      'Context window full: 1.2M tokens, 200k more than the 1M this model holds. Earlier messages may be summarized when the next one is sent',
    );

    await render(<template><ContextRing @used={{999950}} @limit={{2000000}} /></template>);
    assert.strictEqual(root().getAttribute('aria-label'), 'Context window 50% used: 1M of 2M tokens', 'a count that would round to 1000k reads as 1M');
  });

  test('an unknown limit is never over', async function (assert) {
    await render(<template><ContextRing @used={{5000}} @limit={{0}} /></template>);
    assert.strictEqual(root().dataset['over'], undefined);
    assert.strictEqual(root().dataset['warn'], undefined);
    assert.dom('[data-test-pretui-context-ring-pct]').hasText('0%');
  });
});
