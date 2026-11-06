// Spinner unit tests: its size is set through the CSSOM, never a `style`
// attribute, so it renders under a strict Content Security Policy.
//
// Run with `boxel test`.
import { module, test } from 'qunit';
import { render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Spinner } from './spinner';
import { styleAttributeWrites } from '../test-support/style-attribute-writes';

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

  test('a new @size reaches the element, and clearing it brings back the default', async function (assert) {
    class State {
      @tracked size: number | 'l' | undefined = 'l';
    }
    let state = new State();
    await render(<template><Spinner @size={{state.size}} /></template>);
    let [el] = spinners();
    assert.strictEqual(el.style.width, '17px');
    state.size = 24;
    await settled();
    assert.deepEqual([el.style.width, el.style.height], ['24px', '24px'], 'the new size');
    state.size = undefined;
    await settled();
    assert.deepEqual([el.style.width, el.style.height], ['13px', '13px'], 'the default again');
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
