// Pretui — artboard contract proof (Appendix H).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Viewport } from './freestyle';

// SegmentedControl is a radiogroup over native <input type='radio'> as of
// 2026-08-13 (it used to be role='tablist' over <button>s, which was invalid
// ARIA). Click the input: a synthetic click on the label would rely on label
// activation forwarding, and the input is the thing that actually changes.
function segButton(label: string): HTMLElement {
  let labels = Array.from(
    document.querySelectorAll('[data-test-pretui-viewport] .pretui-seg label'),
  );
  let target = labels.find((b) => b.textContent?.trim() === label);
  if (!target) throw new Error(`no viewport segment labeled ${label}`);
  return target.querySelector('input') as HTMLElement;
}

module('Pretui | Viewport artboard', function (hooks) {
  setupCardTest(hooks);

  test('R1: presets set exact widths; R5: caption is honest', async function (assert) {
    await render(<template>
      <Viewport @label='Probe'><span>content</span></Viewport>
    </template>);

    let artboard = () =>
      document.querySelector('.pretui-artboard') as HTMLElement;
    assert.strictEqual(
      artboard().getAttribute('data-width'),
      'fill',
      'starts at fill',
    );

    await click(segButton('Tablet'));
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

    await click(segButton('Phone'));
    assert.strictEqual(artboard().style.width, '375px', 'phone is 375px');
  });

  test('R3: 3-up renders all three labeled breakpoints', async function (assert) {
    await render(<template>
      <Viewport @label='Probe'><span>content</span></Viewport>
    </template>);
    await click(segButton('3-up'));
    let boards = document.querySelectorAll('.pretui-bp-row .pretui-artboard');
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
      document.querySelector('.pretui-artboard-body') as HTMLElement;
    assert.strictEqual(body().getAttribute('data-surface'), 'background');
    assert.strictEqual(body().getAttribute('data-gutter'), 'true');

    let gutterSwitch = document.querySelector(
      '.pretui-viewport-gutter [data-test-pretui-switch]',
    ) as HTMLElement | null;
    if (gutterSwitch) {
      await click(gutterSwitch);
      assert.strictEqual(
        body().getAttribute('data-gutter'),
        'false',
        'gutter toggles off',
      );
    } else {
      let anySwitch = document.querySelector(
        '.pretui-viewport-gutter button',
      ) as HTMLElement | null;
      assert.ok(anySwitch, 'gutter switch rendered');
      if (anySwitch) {
        await click(anySwitch);
        assert.strictEqual(body().getAttribute('data-gutter'), 'false');
      }
    }
  });
});
