// Pretui — CardEmbed unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { CardEmbed } from './card-embed';

function frame(): HTMLElement {
  return document.querySelector('[data-test-pretui-card-embed]') as HTMLElement;
}

module('Pretui | components/card-embed', function (hooks) {
  setupCardTest(hooks);

  test('sizes are set as CSS values, and one that is not a value is dropped', async function (assert) {
    await render(<template><CardEmbed @width='20rem' @maxHeight='10rem; position: fixed' @envelope='16 / 9' /></template>);
    assert.strictEqual(frame().style.getPropertyValue('--pretui-embed-w').trim(), '20rem');
    assert.strictEqual(frame().style.getPropertyValue('--pretui-embed-min').trim(), '4rem', 'the format default');
    assert.strictEqual(frame().style.aspectRatio.replace(/\s/g, ''), '16/9');
    assert.strictEqual(frame().style.getPropertyValue('--pretui-embed-max-h'), '', 'the bad value is dropped');
    assert.strictEqual(frame().style.position, '', 'nothing escapes it');
  });
});
