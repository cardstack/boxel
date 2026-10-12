// Pretui — artboard contract proof.
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Viewport } from './components/viewport';

// SegmentedControl is a radiogroup over native <input type='radio'>. Click
// the input: a synthetic click on the label would rely on label
// activation forwarding, and the input is the thing that actually changes.
function segButton(mode: string): HTMLElement {
  let target = document.querySelector(
    `[data-test-pretui-viewport] [data-test-pretui-segmented-option='${mode}']`,
  ) as HTMLElement | null;
  if (!target) throw new Error(`no viewport segment for ${mode}`);
  return target;
}
function artboard(): HTMLElement {
  return document.querySelector('[data-test-pretui-artboard]') as HTMLElement;
}

module('Pretui | Viewport artboard', function (hooks) {
  setupCardTest(hooks);

  test('R1: presets set exact widths; R5: caption is honest', async function (assert) {
    await render(<template>
      <Viewport><span>content</span></Viewport>
    </template>);

    assert.strictEqual(
      artboard().getAttribute('data-label'),
      'Fill · 100%',
      'starts at fill, captioned as the full width',
    );
    assert.strictEqual(artboard().style.width, '100%', 'fill is 100% wide');

    await click(segButton('tablet'));
    assert.strictEqual(
      artboard().style.width,
      '600px',
      'tablet artboard is exactly 600px',
    );
    assert.strictEqual(
      artboard().getAttribute('data-label'),
      'Tablet · 600px',
      'a device preset is captioned with the device and its true width',
    );

    await click(segButton('phone'));
    assert.strictEqual(artboard().style.width, '320px', 'phone is 320px');
  });

  test('R3: 3-up renders all three labeled breakpoints', async function (assert) {
    await render(<template>
      <Viewport><span>content</span></Viewport>
    </template>);
    await click(segButton('bp'));
    let boards = Array.from(
      document.querySelectorAll('[data-test-pretui-artboard]'),
    ) as HTMLElement[];
    assert.strictEqual(boards.length, 3, 'three artboards');
    assert.deepEqual(
      boards.map((b) => b.getAttribute('data-label')),
      ['Phone · 320px', 'Tablet · 600px', 'Desktop · 1120px'],
      'each labeled with its true width',
    );
    assert.deepEqual(
      boards.map((b) => b.style.width),
      ['320px', '600px', '1120px'],
      'each is exactly the width its caption states',
    );
  });

  test('R2/R9: surface and gutter are explicit, reflected settings', async function (assert) {
    await render(<template>
      <Viewport><span>content</span></Viewport>
    </template>);
    let body = () =>
      document.querySelector('[data-test-pretui-artboard-body]') as HTMLElement;
    assert.strictEqual(body().getAttribute('data-surface'), 'background');
    assert.strictEqual(body().getAttribute('data-gutter'), 'true');

    await click('[data-test-pretui-viewport-gutter]');
    assert.strictEqual(
      body().getAttribute('data-gutter'),
      'false',
      'gutter toggles off',
    );
  });
});
