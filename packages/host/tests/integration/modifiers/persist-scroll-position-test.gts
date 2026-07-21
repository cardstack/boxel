import { render, triggerEvent } from '@ember/test-helpers';

import { module, test } from 'qunit';

import persistScrollPosition from '@cardstack/host/modifiers/persist-scroll-position';

import { setupRenderingTest } from '../../helpers/setup';

// Let the modifier's observer-driven, rAF-scheduled re-apply land. `settled()`
// doesn't await ResizeObserver / MutationObserver callbacks or requestAnimation-
// Frame, so pump real frames until the offset sticks (or we give up).
async function waitForScrollTop(el: HTMLElement, expected: number) {
  for (let i = 0; i < 30 && Math.abs(el.scrollTop - expected) > 1; i++) {
    // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- test must await the modifier's real post-layout frame
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

module('Integration | modifier | persist-scroll-position', function (hooks) {
  setupRenderingTest(hooks);

  test('restores the saved offset even when the rows lay out after mount', async function (assert) {
    let recorded: number[] = [];
    let onChange = (scrollTop: number) => recorded.push(scrollTop);

    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div
          class='scroller'
          style='height: 200px; overflow-y: auto;'
          {{persistScrollPosition scrollTop=150 onChange=onChange}}
        >
          <div class='content' style='height: 40px;'></div>
        </div>
      </template>,
    );

    let scroller = document.querySelector('.scroller') as HTMLElement;
    let content = scroller.firstElementChild as HTMLElement;

    // At mount the content is shorter than the viewport, so there's nothing to
    // scroll: a naive "set scrollTop once" restore would clamp to 0 and be lost.
    assert.strictEqual(
      scroller.scrollTop,
      0,
      'cannot scroll while content < viewport',
    );

    // The rows arrive late — the content grows past the viewport (this is what
    // the ResizeObserver on the content wrapper catches; in the app it's the
    // prerendered rows hydrating / the sheet's height transition).
    content.style.height = '1200px';
    await waitForScrollTop(scroller, 150);

    assert.strictEqual(
      scroller.scrollTop,
      150,
      'the offset is restored once the content is tall enough, without a frame budget giving up',
    );
    assert.deepEqual(
      recorded,
      [],
      'the programmatic restore is never reported as a user scroll',
    );
  });

  test('re-applies again if the content shrinks and re-grows before the user scrolls', async function (assert) {
    let onChange = () => {};

    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div
          class='scroller'
          style='height: 200px; overflow-y: auto;'
          {{persistScrollPosition scrollTop=150 onChange=onChange}}
        >
          <div class='content' style='height: 1200px;'></div>
        </div>
      </template>,
    );

    let scroller = document.querySelector('.scroller') as HTMLElement;
    let content = scroller.firstElementChild as HTMLElement;
    await waitForScrollTop(scroller, 150);
    assert.strictEqual(scroller.scrollTop, 150, 'restored initially');

    // A background re-render momentarily collapses the list (the browser snaps
    // scrollTop to 0), then it grows back. The offset must return.
    content.style.height = '40px';
    // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- test must await the modifier's real post-layout frame
    await new Promise((resolve) => requestAnimationFrame(resolve));
    content.style.height = '1200px';
    await waitForScrollTop(scroller, 150);

    assert.strictEqual(
      scroller.scrollTop,
      150,
      'a layout collapse-and-regrow does not strand the list at the top',
    );
  });

  test('records the offset only after a genuine user scroll gesture', async function (assert) {
    let recorded: number[] = [];
    let onChange = (scrollTop: number) => recorded.push(scrollTop);

    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div
          class='scroller'
          style='height: 200px; overflow-y: auto;'
          {{persistScrollPosition scrollTop=0 onChange=onChange}}
        >
          <div class='content' style='height: 1200px;'></div>
        </div>
      </template>,
    );

    let scroller = document.querySelector('.scroller') as HTMLElement;

    // A scroll with no preceding gesture (a programmatic move or a layout
    // reset) must not be recorded.
    scroller.scrollTop = 90;
    await triggerEvent(scroller, 'scroll');
    assert.deepEqual(recorded, [], 'a gesture-less scroll is ignored');

    // After a real gesture, the user's scrolling is recorded. (A single move
    // can emit more than one `scroll` — the native one plus the synthetic test
    // event — so assert the value rather than the call count.)
    await triggerEvent(scroller, 'wheel');
    scroller.scrollTop = 120;
    await triggerEvent(scroller, 'scroll');
    let recordedOnlyTheUserOffset =
      recorded.length >= 1 && recorded.every((v) => v === 120);
    assert.ok(
      recordedOnlyTheUserOffset,
      'the user scroll offset (120) is recorded',
    );
  });

  test('does nothing when onChange is omitted (the opt-out path)', async function (assert) {
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div
          class='scroller'
          style='height: 200px; overflow-y: auto;'
          {{persistScrollPosition scrollTop=150}}
        >
          <div class='content' style='height: 1200px;'></div>
        </div>
      </template>,
    );

    let scroller = document.querySelector('.scroller') as HTMLElement;
    // Give any (absent) restore a few frames — it must stay at the top.
    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- test must await the modifier's real post-layout frame
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    assert.strictEqual(
      scroller.scrollTop,
      0,
      'without onChange the modifier neither restores nor records',
    );
  });
});
