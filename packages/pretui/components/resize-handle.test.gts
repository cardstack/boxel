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
  return (
    el.getBoundingClientRect().width / parseFloat(getComputedStyle(el).width)
  );
}

// The primary button is held from pointerdown until pointerup, as in a real
// drag, unless `buttons` says otherwise.
async function pointer(
  el: HTMLElement,
  type: string,
  coord: { x?: number; y?: number },
  {
    button = 0,
    pointerId = 1,
    buttons = type === 'pointerdown' || type === 'pointermove' ? 1 : 0,
  } = {},
) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button,
      buttons,
      pointerId,
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

  test('a bare handle has a generic name, and names the viewport as its max', async function (assert) {
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
      .hasAria(
        'valuemax',
        String(Math.max(120, window.innerWidth)),
        'an unbounded handle still names a max, which assistive tech would otherwise read as 100',
      )
      .hasAria('valuenow', '120');

    pane.size = window.innerWidth + 500;
    await settled();
    assert
      .dom(HANDLE)
      .hasAria(
        'valuemax',
        String(window.innerWidth + 500),
        'a pane past the viewport reports its own size as the max',
      );
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
    await pointer(el, 'pointerdown', { x: 500 }, { button: 2 });
    await pointer(el, 'pointermove', { x: 560 });
    assert.deepEqual(pane.reports, [], 'a right-button press is not a drag');
  });

  test('the pointer that started a drag owns it', async function (assert) {
    let pane = new Pane(200);
    await render(
      <template>
        <ResizeHandle @size={{pane.size}} @onSizeChange={{pane.set}} />
      </template>,
    );
    let el = handle();
    let s = scaleOf(el);
    await pointer(el, 'pointerdown', { x: 500 });
    await pointer(el, 'pointerdown', { x: 900 }, { pointerId: 2 });
    await pointer(el, 'pointermove', { x: 950 }, { pointerId: 2 });
    assert.deepEqual(pane.reports, [], "a second finger doesn't steer it");
    await pointer(el, 'pointermove', { x: 500 + 40 * s });
    assert.strictEqual(
      pane.size,
      240,
      "and doesn't restart it: travel still counts from the first press",
    );
    await pointer(el, 'pointerup', { x: 900 }, { pointerId: 2 });
    assert
      .dom(el)
      .hasAttribute(
        'data-dragging',
        'true',
        "the second finger's release doesn't end it",
      );
  });

  test('losing pointer capture ends the drag', async function (assert) {
    let pane = new Pane(200);
    await render(
      <template>
        <ResizeHandle @size={{pane.size}} @onSizeChange={{pane.set}} />
      </template>,
    );
    let el = handle();
    await pointer(el, 'pointerdown', { x: 500 });
    await pointer(el, 'lostpointercapture', { x: 500 });
    assert.dom(el).doesNotHaveAttribute('data-dragging');
    await pointer(el, 'pointermove', { x: 600 }, { buttons: 0 });
    assert.deepEqual(
      pane.reports,
      [],
      'a later hover with no button pressed resizes nothing',
    );
  });

  test('a move with no button held ends the drag', async function (assert) {
    let pane = new Pane(200);
    await render(
      <template>
        <ResizeHandle @size={{pane.size}} @onSizeChange={{pane.set}} />
      </template>,
    );
    let el = handle();
    let s = scaleOf(el);
    await pointer(el, 'pointerdown', { x: 500 });
    await pointer(el, 'pointermove', { x: 500 + 40 * s });
    assert.strictEqual(pane.size, 240);
    await pointer(el, 'pointermove', { x: 500 + 80 * s }, { buttons: 0 });
    assert.strictEqual(
      pane.size,
      240,
      'a hover after a release the handle never saw resizes nothing',
    );
    assert.dom(el).doesNotHaveAttribute('data-dragging');
    await pointer(el, 'pointermove', { x: 500 + 80 * s });
    assert.strictEqual(pane.size, 240, 'and the gesture is over');
  });

  test('a press from the pointer that owns a gesture starts it over', async function (assert) {
    let pane = new Pane(200);
    await render(
      <template>
        <ResizeHandle @size={{pane.size}} @onSizeChange={{pane.set}} />
      </template>,
    );
    let el = handle();
    let s = scaleOf(el);
    await pointer(el, 'pointerdown', { x: 500 });
    await pointer(el, 'pointerdown', { x: 800 });
    await pointer(el, 'pointermove', { x: 800 + 40 * s });
    assert.strictEqual(
      pane.size,
      240,
      'a release that never arrived leaves nothing stuck: travel counts from the new press',
    );
    assert.dom(el).hasAttribute('data-dragging', 'true');
  });

  test('rem bounds follow the root font size at the next key press', async function (assert) {
    let pane = new Pane(250);
    await render(
      <template>
        <ResizeHandle
          @size={{pane.size}}
          @min='10rem'
          @max='20rem'
          @onSizeChange={{pane.set}}
        />
      </template>,
    );
    let root = document.documentElement;
    let before = root.style.fontSize;
    let rem = rootFontSize() * 1.25;
    root.style.fontSize = `${rem}px`;
    try {
      await triggerKeyEvent(HANDLE, 'keydown', 'Home');
      assert.strictEqual(pane.size, Math.round(10 * rem));
      await triggerKeyEvent(HANDLE, 'keydown', 'End');
      assert.strictEqual(pane.size, Math.round(20 * rem));
    } finally {
      root.style.fontSize = before;
    }
  });

  test('a strip that is not a whole number of px still tracks the pointer', async function (assert) {
    let whole = new Pane(200);
    let fractional = new Pane(200);
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <ResizeHandle
          style='width: 8px'
          @size={{whole.size}}
          @onSizeChange={{whole.set}}
          data-test-whole
        />
        <ResizeHandle
          style='width: 7.5px'
          @size={{fractional.size}}
          @onSizeChange={{fractional.set}}
          data-test-fractional
        />
      </template>,
    );
    let travel = 120 * scaleOf(handle('[data-test-whole]'));
    for (let el of [
      handle('[data-test-whole]'),
      handle('[data-test-fractional]'),
    ]) {
      await pointer(el, 'pointerdown', { x: 500 });
      await pointer(el, 'pointermove', { x: 500 + travel });
      await pointer(el, 'pointerup', { x: 500 + travel });
    }
    assert.strictEqual(whole.size, 320);
    assert.strictEqual(
      fractional.size,
      320,
      'the same screen travel gives the same size change',
    );
  });

  test('a handle on the start edge, or in a right-to-left context, grows the other way', async function (assert) {
    let start = new Pane(200);
    let rtl = new Pane(200);
    let physical = new Pane(200);
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
          <ResizeHandle
            @size={{physical.size}}
            @placement='right'
            @onSizeChange={{physical.set}}
            data-test-physical
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

    let physicalEl = handle('[data-test-physical]');
    await pointer(physicalEl, 'pointerdown', { x: 500 });
    await pointer(physicalEl, 'pointermove', { x: 500 + 40 * s });
    assert.strictEqual(
      physical.size,
      240,
      "'right' stays the right edge in right-to-left: moving right grows it",
    );
    await triggerKeyEvent(physicalEl, 'keydown', 'ArrowRight');
    assert.strictEqual(physical.size, 256);
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
    for (let chord of [
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
    ]) {
      let event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
        ...chord,
      });
      el.dispatchEvent(event);
      await settled();
      assert.false(
        event.defaultPrevented,
        `${Object.keys(chord)[0]}+ArrowLeft is left to the browser`,
      );
    }
    assert.strictEqual(pane.size, 210, 'and resizes nothing');
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

  test('a double-click or Enter restores the default size', async function (assert) {
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
    await triggerKeyEvent('[data-test-default]', 'keydown', 'ArrowRight');
    assert.strictEqual(pane.size, 196);
    await triggerKeyEvent('[data-test-default]', 'keydown', 'Enter');
    assert.strictEqual(
      pane.size,
      180,
      'Enter reaches the default the arrow steps went past',
    );
    await triggerEvent('[data-test-bare]', 'dblclick');
    let enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    handle('[data-test-bare]').dispatchEvent(enter);
    await settled();
    assert.deepEqual(
      bare.reports,
      [],
      'with no default size there is nothing to restore',
    );
    assert.false(enter.defaultPrevented, 'and Enter is left alone');
  });
});
