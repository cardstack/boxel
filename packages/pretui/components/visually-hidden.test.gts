// Pretui — VisuallyHidden unit tests: the text stays in the tree and takes no space.
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { VisuallyHidden } from './visually-hidden';

module('Pretui | components/visually-hidden', function (hooks) {
  setupCardTest(hooks);

  test('the text is in the DOM and not hidden from assistive technology', async function (assert) {
    await render(<template><button type='button' class='t-close'>✕<VisuallyHidden data-role='name'>Close</VisuallyHidden></button></template>);
    let el = document.querySelector('[data-test-pretui-visually-hidden]') as HTMLElement;
    assert.strictEqual(el.tagName, 'SPAN');
    assert.strictEqual(el.textContent, 'Close');
    assert.strictEqual(el.getAttribute('data-role'), 'name', 'attributes land on the span');
    assert.notOk(el.hasAttribute('aria-hidden'), 'not aria-hidden');
    assert.notOk(el.hasAttribute('hidden'), 'not the hidden attribute');
    assert.strictEqual(document.querySelector('.t-close')?.textContent?.includes('Close'), true, 'it contributes to the button name');
  });

  test('@focusable marks the span for the reveal-on-focus treatment', async function (assert) {
    await render(<template><VisuallyHidden @focusable={{true}}><a href='#main'>Skip</a></VisuallyHidden></template>);
    assert.strictEqual((document.querySelector('[data-test-pretui-visually-hidden]') as HTMLElement).dataset['focusable'], 'true');
  });
});
