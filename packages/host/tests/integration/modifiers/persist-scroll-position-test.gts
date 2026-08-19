import { render, triggerEvent, waitUntil } from '@ember/test-helpers';

import { tracked } from '@glimmer/tracking';

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

    // A programmatic `scrollTop` assignment fires its `scroll` event on the
    // next rendering, not synchronously, and `settled()` does not await that
    // frame. Drain it here — while there is still no gesture, so the modifier
    // ignores it — otherwise it can land during the wheel below, after the
    // gesture has flipped the modifier into recording mode, and be recorded as
    // a spurious user offset (90).
    // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- must await the browser's post-assignment scroll frame
    await new Promise((resolve) => requestAnimationFrame(resolve));

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
      `the user scroll offset (120) is recorded (recorded: ${JSON.stringify(
        recorded,
      )})`,
    );
  });

  test('tags the element as restore-pending until the offset sticks', async function (assert) {
    let onChange = () => {};

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

    // The content is still too short to accept the offset, so the restore is
    // mid-flight: the tag lets consumers hide the element rather than paint
    // the clamped-to-top intermediate state.
    assert
      .dom(scroller)
      .hasAttribute(
        'data-scroll-restore-pending',
        '',
        'tagged while the offset cannot be applied yet',
      );

    content.style.height = '1200px';
    await waitForScrollTop(scroller, 150);
    assert.strictEqual(scroller.scrollTop, 150, 'the offset is restored');

    // The reveal trails the stick by a short box-quiet window (so a stick
    // against a mid-transition, still-growing container doesn't count).
    await waitUntil(
      () => !scroller.hasAttribute('data-scroll-restore-pending'),
      { timeout: 3000 },
    );
    assert
      .dom(scroller)
      .doesNotHaveAttribute(
        'data-scroll-restore-pending',
        'untagged once the offset sticks and the box is quiet',
      );
  });

  test('holds the restore-pending tag while the container box is still changing', async function (assert) {
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

    // Simulate the sheet's open transition: the container's own height changes
    // every frame. The offset sticks trivially against the small viewport, but
    // that early stick must not reveal — the box is still moving.
    for (let height = 20; height <= 200; height += 15) {
      scroller.style.height = `${height}px`;
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- test must emulate a per-frame size transition
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    assert
      .dom(scroller)
      .hasAttribute(
        'data-scroll-restore-pending',
        '',
        'still tagged while the box keeps changing',
      );

    // The transition is over; once the box has been quiet long enough (and the
    // offset still sticks) the element reveals.
    await waitUntil(
      () => !scroller.hasAttribute('data-scroll-restore-pending'),
      { timeout: 3000 },
    );
    assert.strictEqual(
      scroller.scrollTop,
      150,
      'revealed at the restored offset',
    );
  });

  test('never tags the element when there is no offset to restore', async function (assert) {
    let onChange = () => {};

    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div
          class='scroller'
          style='height: 200px; overflow-y: auto;'
          {{persistScrollPosition scrollTop=0 onChange=onChange}}
        >
          <div class='content' style='height: 40px;'></div>
        </div>
      </template>,
    );

    assert
      .dom('.scroller')
      .doesNotHaveAttribute(
        'data-scroll-restore-pending',
        'a zero offset needs no restore, so the element is never hidden',
      );
  });

  test('unpins the restore-pending tag after the cap when the offset is unreachable', async function (assert) {
    let onChange = () => {};

    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div
          class='scroller'
          style='height: 200px; overflow-y: auto;'
          {{persistScrollPosition scrollTop=150 onChange=onChange}}
        >
          {{! tall enough to scroll a little, but max offset (100) < target }}
          <div class='content' style='height: 300px;'></div>
        </div>
      </template>,
    );

    let scroller = document.querySelector('.scroller') as HTMLElement;
    assert
      .dom(scroller)
      .hasAttribute(
        'data-scroll-restore-pending',
        '',
        'tagged while still trying to reach the offset',
      );

    // The saved offset exceeds what the (now shorter) list can scroll to; the
    // cap must reveal the element rather than hide it forever.
    await waitUntil(
      () => !scroller.hasAttribute('data-scroll-restore-pending'),
      { timeout: 3000 },
    );

    assert.strictEqual(
      scroller.scrollTop,
      100,
      'revealed at the clamped offset',
    );
  });

  test('a user gesture unpins the restore-pending tag immediately', async function (assert) {
    let onChange = () => {};

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
    assert
      .dom(scroller)
      .hasAttribute('data-scroll-restore-pending', '', 'tagged mid-restore');

    await triggerEvent(scroller, 'wheel');

    assert
      .dom(scroller)
      .doesNotHaveAttribute(
        'data-scroll-restore-pending',
        'the user took over, so the element must be visible',
      );
  });

  test('a recorded scroll does not restart the restore or re-hide the element', async function (assert) {
    // Mirror the real wiring: the recorded offset writes back into tracked
    // state that feeds the `scrollTop` arg, so every recorded scroll re-runs
    // the modifier on the same element. Only the first install may restore.
    class ScrollState {
      @tracked scrollTop = 150;
    }
    let state = new ScrollState();
    let onChange = (scrollTop: number) => (state.scrollTop = scrollTop);

    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div
          class='scroller'
          style='height: 200px; overflow-y: auto;'
          {{persistScrollPosition scrollTop=state.scrollTop onChange=onChange}}
        >
          <div class='content' style='height: 1200px;'></div>
        </div>
      </template>,
    );

    let scroller = document.querySelector('.scroller') as HTMLElement;
    await waitForScrollTop(scroller, 150);
    await waitUntil(
      () => !scroller.hasAttribute('data-scroll-restore-pending'),
      { timeout: 3000 },
    );

    // The user takes over and scrolls; recording updates the tracked state,
    // which re-runs the modifier (triggerEvent settles, flushing the re-run).
    await triggerEvent(scroller, 'wheel');
    scroller.scrollTop = 300;
    await triggerEvent(scroller, 'scroll');

    assert
      .dom(scroller)
      .doesNotHaveAttribute(
        'data-scroll-restore-pending',
        'the re-install after a recorded scroll must not hide the element again',
      );

    // Nor may the re-install re-apply the previously recorded offset over the
    // user's continued scrolling.
    scroller.scrollTop = 500;
    await triggerEvent(scroller, 'wheel');
    await triggerEvent(scroller, 'scroll');
    for (let i = 0; i < 10; i++) {
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- give any (wrongly) restarted restore burst time to fight the scroll
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    assert.strictEqual(
      scroller.scrollTop,
      500,
      'continued scrolling is not yanked back to the recorded offset',
    );
    assert.strictEqual(state.scrollTop, 500, 'the new offset is recorded');
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
    assert
      .dom(scroller)
      .doesNotHaveAttribute(
        'data-scroll-restore-pending',
        'persistence off means nothing to hide',
      );
  });
});
