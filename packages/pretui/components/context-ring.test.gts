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
    assert.strictEqual(root().getAttribute('aria-label'), 'Context 26% used: 52k of 200k tokens');
    assert.strictEqual(root().getAttribute('title'), root().getAttribute('aria-label'), 'the tooltip says the same');
    assert.strictEqual(root().dataset['warn'], undefined);
  });

  test('past the warning share it says "nearly full" in its name, not only in its colour', async function (assert) {
    await render(<template><ContextRing @used={{170000}} @limit={{200000}} @compact={{true}} /></template>);
    assert.strictEqual(root().dataset['warn'], 'true');
    assert.strictEqual(root().getAttribute('aria-label'), 'Context 85% used, nearly full: 170k of 200k tokens');
    assert.strictEqual(root().getAttribute('title'), root().getAttribute('aria-label'), 'compact mode keeps the warning in the tooltip');

    await render(<template><ContextRing @used={{60}} @limit={{100}} @warnAt={{0.5}} /></template>);
    assert.strictEqual(root().getAttribute('aria-label'), 'Context 60% used, nearly full: 60 of 100 tokens', '@warnAt moves the threshold');
  });

  test('a conversation larger than the window says it is over, not "100% used"', async function (assert) {
    await render(<template><ContextRing @used={{600000}} @limit={{128000}} /></template>);
    assert.strictEqual(root().dataset['over'], 'true');
    assert.strictEqual(root().dataset['warn'], 'true', 'it keeps the attention colour');
    assert.strictEqual(
      root().getAttribute('aria-label'),
      'Context full: 600k tokens, 472k more than the 128k this model holds. Earlier messages may be summarized when the next one is sent',
    );
    assert.dom('[data-test-pretui-context-ring-pct]').hasText('Full');

    await render(<template><ContextRing @used={{128000}} @limit={{128000}} /></template>);
    assert.strictEqual(root().dataset['over'], undefined, 'a window exactly full is not over');
  });

  test('just over the window, the excess tells the two rounded counts apart', async function (assert) {
    await render(<template><ContextRing @used={{128040}} @limit={{128000}} /></template>);
    assert.strictEqual(
      root().getAttribute('aria-label'),
      'Context full: 128k tokens, 40 more than the 128k this model holds. Earlier messages may be summarized when the next one is sent',
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
    assert.true(root().getAttribute('title')?.startsWith('Context full: 600k tokens'));
  });

  test('an unknown limit is never over', async function (assert) {
    await render(<template><ContextRing @used={{5000}} @limit={{0}} /></template>);
    assert.strictEqual(root().dataset['over'], undefined);
    assert.strictEqual(root().dataset['warn'], undefined);
    assert.dom('[data-test-pretui-context-ring-pct]').hasText('0%');
  });
});
