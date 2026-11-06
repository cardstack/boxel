// LoadingState unit tests: each pixel's delay is set through the CSSOM, never
// a `style` attribute, so it renders under a strict Content Security Policy.
//
// Run with `boxel test`.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { LoadingState } from './loading-state';

// Every `style` attribute written while `work` runs. Glimmer binds `style`
// with `setAttribute`, which a strict Content Security Policy (the secure
// origin's) refuses; a CSSOM write (`element.style.setProperty`) doesn't go
// through it and is allowed.
async function styleAttributeWrites(work: () => Promise<void>): Promise<string[]> {
  let writes: string[] = [];
  let setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
    if (name.toLowerCase() === 'style') {
      writes.push(value);
    }
    return setAttribute.call(this, name, value);
  };
  try {
    await work();
  } finally {
    Element.prototype.setAttribute = setAttribute;
  }
  return writes;
}

function pixels(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.pretui-pixel')];
}

module('Pretui | components/loading-state', function (hooks) {
  setupCardTest(hooks);

  test('the pixel delays are set through the CSSOM, with no style attribute', async function (assert) {
    let writes = await styleAttributeWrites(() =>
      render(<template><LoadingState @label='Loading' /></template>),
    );
    assert.deepEqual(writes, [], 'no style attribute is written');
    assert.deepEqual(
      pixels().map((el) => el.style.getPropertyValue('--pretui-pixel-delay')),
      ['90ms', '180ms', '270ms', '0ms', '90ms', '180ms', '90ms', '180ms', '270ms'],
      'drive lights the grid as a chevron',
    );
    assert.dom('[data-test-pretui-loading-state]').hasText('Loading');
  });

  test('orbit leaves the centre pixel unlit', async function (assert) {
    let writes = await styleAttributeWrites(() =>
      render(<template><LoadingState @variant='orbit' /></template>),
    );
    assert.deepEqual(writes, [], 'no style attribute is written');
    let lit = pixels().filter((el) => !el.hasAttribute('data-idle'));
    assert.strictEqual(lit.length, 8);
    assert.true(pixels()[4].hasAttribute('data-idle'), 'the centre is unlit');
    assert.strictEqual(pixels()[4].style.getPropertyValue('--pretui-pixel-delay'), '');
    assert.strictEqual(getComputedStyle(pixels()[4]).animationName, 'none');
  });
});
