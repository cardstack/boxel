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

module('Pretui | Viewport artboard', function (hooks) {
  setupCardTest(hooks);

  test('R1: presets set exact widths; R5: caption is honest', async function (assert) {
    await render(<template>
      <Viewport @label='Probe'><span>content</span></Viewport>
    </template>);

    let artboard = () =>
      document.querySelector('[data-test-pretui-artboard]') as HTMLElement;
    assert.strictEqual(
      artboard().getAttribute('data-width'),
      'fill',
      'starts at fill',
    );

    await click(segButton('tablet'));
    assert.strictEqual(
      artboard().style.width,
      '768px',
      'tablet artboard is exactly 768px',
    );
    assert.strictEqual(
      artboard().getAttribute('data-label'),
      'Probe · 768px',
      'caption carries name and true width',
    );

    await click(segButton('phone'));
    assert.strictEqual(artboard().style.width, '375px', 'phone is 375px');
  });

  test('R3: 3-up renders all three labeled breakpoints', async function (assert) {
    await render(<template>
      <Viewport @label='Probe'><span>content</span></Viewport>
    </template>);
    await click(segButton('bp'));
    let boards = document.querySelectorAll('[data-test-pretui-artboard]');
    assert.strictEqual(boards.length, 3, 'three artboards');
    assert.deepEqual(
      Array.from(boards).map((b) => b.getAttribute('data-label')),
      ['Phone · 375px', 'Tablet · 768px', 'Desktop · 1120px'],
      'each labeled with its true width',
    );
  });

  test('R2/R9: surface and gutter are explicit, reflected settings', async function (assert) {
    await render(<template>
      <Viewport @label='Probe'><span>content</span></Viewport>
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
