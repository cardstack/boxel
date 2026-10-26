// ResizeHandle unit tests. The host test harness delivers no stylesheet, so
// nothing here reads layout: a drag is driven by pointer coordinates and the
// promise checked is the size reported through @onSizeChange and the
// separator's ARIA attributes.
import { module, test } from 'qunit';
import { tracked } from '@glimmer/tracking';
import {
  render,
  settled,
  triggerEvent,
  triggerKeyEvent,
} from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ResizeHandle } from './resize-handle';

const HANDLE = '[data-test-pretui-resize-handle]';

function handle(sel = HANDLE): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

function rootFontSize(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize);
}

class Pane {
  @tracked size: number | undefined;
  reports: number[] = [];
  constructor(size?: number) {
    this.size = size;
  }
  set = (size: number) => {
    this.reports.push(size);
    this.size = size;
  };
}

// Screen px per layout px across a vertical handle. The test container may
// itself be scaled, so drags are written in layout px and converted.
function scaleOf(el: HTMLElement): number {
  return el.getBoundingClientRect().width / el.offsetWidth;
}

async function pointer(
  el: HTMLElement,
  type: string,
  coord: { x?: number; y?: number },
  button = 0,
) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button,
      pointerId: 1,
      clientX: coord.x ?? 0,
      clientY: coord.y ?? 0,
    }),
  );
  await settled();
}

module('Pretui | components/resize-handle', function (hooks) {
  setupCardTest(hooks);

  test('it is a focusable separator that reports the size it controls', async function (assert) {
    let pane = new Pane();
    await render(
      <template>
        <ResizeHandle
          @size={{pane.size}}
          @min='10rem'
          @max='20rem'
          @defaultSize='12rem'
          @onSizeChange={{pane.set}}
          @label='Resize sidebar'
          @controls='the-pane'
        />
      </template>,
    );
    let rem = rootFontSize();
    assert
      .dom(HANDLE)
      .hasAttribute('role', 'separator')
      .hasAttribute('tabindex', '0')
      .hasAria('orientation', 'vertical')
      .hasAria('label', 'Resize sidebar')
      .hasAria('controls', 'the-pane')
      .hasAria(
        'valuemin',
        String(Math.round(10 * rem)),
        'rem bounds resolve to px',
      )
      .hasAria('valuemax', String(Math.round(20 * rem)))
      .hasAria(
        'valuenow',
        String(Math.round(12 * rem)),
        'an unset size reads as the default size',
      );

    pane.size = 250;
    await settled();
    assert.dom(HANDLE).hasAria('valuenow', '250', 'a set size wins');
  });

  test('a bare handle has a generic name and no upper bound', async function (assert) {
    let pane = new Pane(120);
    await render(
      <template>
        <ResizeHandle @size={{pane.size}} @onSizeChange={{pane.set}} />
      </template>,
    );
    assert
      .dom(HANDLE)
      .hasAria('label', 'Resize')
      .hasAria('valuemin', '0')
      .doesNotHaveAria('valuemax')
      .hasAria('valuenow', '120');
  });

  test('a drag reports the size from the total travel, clamped to the bounds', async function (assert) {
    let pane = new Pane(200);
    await render(
      <template>
        <ResizeHandle
          @size={{pane.size}}
          @min={{100}}
          @max={{300}}
          @onSizeChange={{pane.set}}
        />
      </template>,
    );
    let el = handle();
    let s = scaleOf(el);
    await pointer(el, 'pointerdown', { x: 500 });
    assert.dom(el).hasAttribute('data-dragging', 'true');
    assert.dom(el).isFocused('pressing the handle focuses it');
    await pointer(el, 'pointermove', { x: 500 + 40 * s });
    assert.strictEqual(pane.size, 240, 'growing toward the end edge');
    await pointer(el, 'pointermove', { x: 500 + 20 * s });
    assert.strictEqual(
      pane.size,
      220,
      'each move measures from where the drag began, not from the last move',
    );
    await pointer(el, 'pointermove', { x: 900 });
    assert.strictEqual(pane.size, 300, 'clamped at the max');
    await pointer(el, 'pointermove', { x: 0 });
    assert.strictEqual(pane.size, 100, 'clamped at the min');
    await pointer(el, 'pointerup', { x: 0 });
    assert.dom(el).doesNotHaveAttribute('data-dragging');

    let reports = pane.reports.length;
    await pointer(el, 'pointermove', { x: 600 });
    assert.strictEqual(
      pane.reports.length,
      reports,
      'a move after release does nothing',
    );
  });

  test('under a scaled ancestor the edge keeps up with the pointer', async function (assert) {
    let plain = new Pane(200);
    let scaled = new Pane(200);
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style='width: 100px'>
          <ResizeHandle
            @size={{plain.size}}
            @onSizeChange={{plain.set}}
            data-test-plain
          />
        </div>
        <div style='width: 100px; transform: scale(0.5); transform-origin: 0 0'>
          <ResizeHandle
            @size={{scaled.size}}
            @onSizeChange={{scaled.set}}
            data-test-scaled
          />
        </div>
      </template>,
    );
    let travel = 40 * scaleOf(handle('[data-test-plain]'));
    for (let el of [
      handle('[data-test-plain]'),
      handle('[data-test-scaled]'),
    ]) {
      await pointer(el, 'pointerdown', { x: 500 });
      await pointer(el, 'pointermove', { x: 500 + travel });
      await pointer(el, 'pointerup', { x: 500 + travel });
    }
    assert.strictEqual(plain.size, 240);
    assert.strictEqual(
      scaled.size,
      280,
      'the same screen travel at half scale is twice the size change',
    );
  });

  test('only the primary button starts a drag', async function (assert) {
    let pane = new Pane(200);
    await render(
      <template>
        <ResizeHandle @size={{pane.size}} @onSizeChange={{pane.set}} />
      </template>,
    );
    let el = handle();
    await pointer(el, 'pointerdown', { x: 500 }, 2);
    await pointer(el, 'pointermove', { x: 560 });
    assert.deepEqual(pane.reports, [], 'a right-button press is not a drag');
  });

  test('a handle on the start edge, or in a right-to-left context, grows the other way', async function (assert) {
    let start = new Pane(200);
    let rtl = new Pane(200);
    await render(
      <template>
        <ResizeHandle
          @size={{start.size}}
          @placement='left'
          @onSizeChange={{start.set}}
          data-test-start
        />
        <div dir='rtl'>
          <ResizeHandle
            @size={{rtl.size}}
            @onSizeChange={{rtl.set}}
            data-test-rtl
          />
        </div>
      </template>,
    );
    let startEl = handle('[data-test-start]');
    let s = scaleOf(startEl);
    await pointer(startEl, 'pointerdown', { x: 500 });
    await pointer(startEl, 'pointermove', { x: 500 - 40 * s });
    assert.strictEqual(
      start.size,
      240,
      'moving left grows a pane whose handle is on its left',
    );
    assert
      .dom(startEl)
      .hasAttribute(
        'data-placement',
        'start',
        "'left' maps to the logical start",
      );

    let rtlEl = handle('[data-test-rtl]');
    await pointer(rtlEl, 'pointerdown', { x: 500 });
    await pointer(rtlEl, 'pointermove', { x: 500 - 40 * s });
    assert.strictEqual(
      rtl.size,
      240,
      'in right-to-left, the end edge is on the left',
    );
    await triggerKeyEvent(rtlEl, 'keydown', 'ArrowLeft');
    assert.strictEqual(rtl.size, 256, 'and the arrow toward it grows the pane');
  });

  test('arrow keys step the size, Shift steps further, Home and End go to the bounds', async function (assert) {
    let pane = new Pane(200);
    await render(
      <template>
        <ResizeHandle
          @size={{pane.size}}
          @min={{100}}
          @max={{300}}
          @step={{10}}
          @onSizeChange={{pane.set}}
        />
      </template>,
    );
    let el = handle();
    await triggerKeyEvent(el, 'keydown', 'ArrowRight');
    assert.strictEqual(pane.size, 210);
    await triggerKeyEvent(el, 'keydown', 'ArrowRight', { shiftKey: true });
    assert.strictEqual(pane.size, 250, 'Shift moves four steps');
    await triggerKeyEvent(el, 'keydown', 'ArrowLeft');
    assert.strictEqual(pane.size, 240);
    await triggerKeyEvent(el, 'keydown', 'ArrowUp');
    assert.strictEqual(
      pane.size,
      240,
      'Up and Down belong to a horizontal handle',
    );
    await triggerKeyEvent(el, 'keydown', 'End');
    assert.strictEqual(pane.size, 300);
    let reports = pane.reports.length;
    await triggerKeyEvent(el, 'keydown', 'ArrowRight');
    assert.strictEqual(
      pane.reports.length,
      reports,
      'a step past the max reports nothing',
    );
    await triggerKeyEvent(el, 'keydown', 'Home');
    assert.strictEqual(pane.size, 100);
  });

  test('a horizontal handle resizes along the block axis', async function (assert) {
    let pane = new Pane(100);
    await render(
      <template>
        <ResizeHandle
          @orientation='horizontal'
          @placement='top'
          @size={{pane.size}}
          @onSizeChange={{pane.set}}
        />
      </template>,
    );
    let el = handle();
    assert.dom(el).hasAria('orientation', 'horizontal');
    await pointer(el, 'pointerdown', { x: 50, y: 400 });
    await pointer(el, 'pointermove', { x: 900, y: 370 });
    assert.strictEqual(
      pane.size,
      130,
      'dragging up grows a pane whose handle is on its top edge; x is ignored',
    );
    await pointer(el, 'pointerup', { y: 370 });
    await triggerKeyEvent(el, 'keydown', 'ArrowUp');
    assert.strictEqual(pane.size, 146);
    await triggerKeyEvent(el, 'keydown', 'ArrowRight');
    assert.strictEqual(
      pane.size,
      146,
      'Left and Right belong to a vertical handle',
    );
  });

  test('a double-click restores the default size', async function (assert) {
    let pane = new Pane(260);
    let bare = new Pane(260);
    await render(
      <template>
        <ResizeHandle
          @size={{pane.size}}
          @defaultSize={{180}}
          @onSizeChange={{pane.set}}
          data-test-default
        />
        <ResizeHandle
          @size={{bare.size}}
          @onSizeChange={{bare.set}}
          data-test-bare
        />
      </template>,
    );
    await triggerEvent('[data-test-default]', 'dblclick');
    assert.strictEqual(pane.size, 180);
    await triggerEvent('[data-test-bare]', 'dblclick');
    assert.deepEqual(
      bare.reports,
      [],
      'with no default size there is nothing to restore',
    );
  });
});
