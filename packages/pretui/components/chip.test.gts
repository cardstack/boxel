// Pretui — Chip / StatusChip unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Chip } from './chip';
import { StatusChip } from './status-chip';
import { statusHue } from '../internal/ink';
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

function chip(): HTMLElement {
  return document.querySelector('[data-test-pretui-chip]') as HTMLElement;
}

module('Pretui | components/chip', function (hooks) {
  setupCardTest(hooks);

  test('defaults to outlined', async function (assert) {
    await render(<template><Chip @label='draft' /></template>);
    assert.strictEqual(chip().dataset['appearance'], 'outlined');
  });

  test('takes soft', async function (assert) {
    await render(
      <template>
        <Chip @label='live' @tone='success' @appearance='soft' />
      </template>,
    );
    assert.strictEqual(chip().dataset['appearance'], 'soft');
    assert.strictEqual(chip().dataset['tone'], 'success');
  });

  // Scoped styles are inert in this harness (a computed backgroundColor reads
  // transparent), so this pins the inline contract the soft fill relies on:
  // @hue writes only the dot's --pretui-chip-hue, never --pretui-chip-tone,
  // which the [data-tone] rule sets and the soft fill mixes from.
  test('soft: @hue on a toned chip feeds the dot, not the fill', async function (assert) {
    await render(
      <template>
        <Chip
          @label='flagged'
          @tone='danger'
          @hue='var(--chart-2)'
          @appearance='soft'
        />
      </template>,
    );
    let style = chip().getAttribute('style') ?? '';
    assert.strictEqual(chip().dataset['tone'], 'danger');
    assert.strictEqual(chip().dataset['appearance'], 'soft');
    assert.true(
      style.includes('--pretui-chip-hue'),
      'the hue reaches the dot variable',
    );
    assert.true(style.includes('var(--chart-2)'));
    assert.false(
      style.includes('--pretui-chip-tone'),
      'the hue never sets the fill tone',
    );
    assert.dom('[data-test-pretui-chip-dot]').exists();
  });

  test('plain keeps the dot even when @dot is false', async function (assert) {
    await render(
      <template>
        <Chip @label='screening' @appearance='plain' @dot={{false}} />
      </template>,
    );
    assert.strictEqual(chip().dataset['appearance'], 'plain');
    assert.dom('[data-test-pretui-chip-dot]').exists();
  });

  test('StatusChip forwards appearance and dot', async function (assert) {
    await render(
      <template>
        <StatusChip @value='offer' @appearance='soft' @dot={{false}} />
      </template>,
    );
    assert
      .dom('[data-test-pretui-status-chip]')
      .hasAttribute('data-appearance', 'soft');
    assert.dom('[data-test-pretui-chip-dot]').doesNotExist();
  });

  test('Chip and StatusChip set the hue through the CSSOM, with no style attribute', async function (assert) {
    let writes = await styleAttributeWrites(() =>
      render(
        <template>
          <Chip @label='draft' @hue='var(--chart-2)' />
          <StatusChip @value='Active' />
        </template>,
      ),
    );
    assert.deepEqual(writes, [], 'no style attribute is written');
    let [plain, status] = [...document.querySelectorAll<HTMLElement>('[data-test-pretui-chip]')];
    assert.strictEqual(plain.style.getPropertyValue('--pretui-chip-hue'), 'var(--chart-2)');
    assert.strictEqual(status.style.getPropertyValue('--pretui-chip-hue'), statusHue('Active'));
  });
});
