// Spinner unit tests: its size is set through the CSSOM, never a `style`
// attribute, so it renders under a strict Content Security Policy.
//
// Run with `boxel test`.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { htmlSafe } from '@ember/template';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Spinner } from './spinner';

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

function spinners(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-test-pretui-spinner]')];
}

const CALLER_SIZE = htmlSafe('width: 30px; height: 30px');

module('Pretui | components/spinner', function (hooks) {
  setupCardTest(hooks);

  test('the size is set through the CSSOM, with no style attribute', async function (assert) {
    let writes = await styleAttributeWrites(() =>
      render(
        <template>
          <Spinner />
          <Spinner @size='l' />
          <Spinner @size={{20}} />
        </template>,
      ),
    );
    assert.deepEqual(writes, [], 'no style attribute is written');
    assert.deepEqual(
      spinners().map((el) => [el.style.width, el.style.height]),
      [
        ['13px', '13px'],
        ['17px', '17px'],
        ['20px', '20px'],
      ],
    );
  });

  test("a caller's size wins over the default, and @size wins over a caller's", async function (assert) {
    await render(
      <template>
        <Spinner style={{CALLER_SIZE}} />
        <Spinner @size='xs' style={{CALLER_SIZE}} />
      </template>,
    );
    assert.deepEqual(
      spinners().map((el) => el.style.width),
      ['30px', '9px'],
    );
  });
});
