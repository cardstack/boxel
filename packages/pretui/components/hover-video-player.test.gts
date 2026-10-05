// Pretui — HoverVideoPlayer unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, settled, triggerEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { HoverVideoPlayer } from './hover-video-player';

const SRC = 'data:video/mp4;base64,AAAA';

function fig(): HTMLElement {
  return document.querySelector('[data-test-pretui-hover-video-player]') as HTMLElement;
}
function video(): HTMLVideoElement {
  return fig().querySelector('[data-test-pretui-hover-video-player-video]') as HTMLVideoElement;
}
function toggle(): HTMLButtonElement {
  return fig().querySelector('[data-test-pretui-hover-video-player-toggle]') as HTMLButtonElement;
}

module('Pretui | components/hover-video-player', function (hooks) {
  setupCardTest(hooks);

  test('the video is decorative; a named pressed-button beside it is the one control', async function (assert) {
    await render(<template><HoverVideoPlayer @src={{SRC}} @label='the cupping room' /></template>);
    assert.strictEqual(fig().tagName, 'FIGURE');
    assert.strictEqual(video().getAttribute('aria-hidden'), 'true');
    assert.strictEqual(video().tabIndex, -1, 'not a second, unlabelled control');
    assert.true(video().muted, 'an unmuted hover preview is hostile');
    assert.true(video().loop);
    assert.strictEqual(video().getAttribute('preload'), 'metadata');
    assert.strictEqual(toggle().getAttribute('aria-label'), 'Play preview of the cupping room');
    assert.strictEqual(toggle().getAttribute('aria-pressed'), 'false');
    assert.strictEqual(fig().dataset['playing'], undefined);
    assert.strictEqual(fig().getAttribute('style'), '--pretui-hvp-ratio: 16 / 9');
    assert.strictEqual(fig().querySelector('figcaption .pretui-sr')?.textContent?.trim(), 'the cupping room', 'the label names the figure when there is no caption');
  });

  /** Stubs HTMLMediaElement.prototype.play so the test owns the outcome
      instead of depending on whether this runner can decode a data: clip. */
  function stubPlay(outcome: 'accept' | 'refuse'): () => void {
    let original = HTMLMediaElement.prototype.play;
    let refused = Promise.reject(new Error('NotAllowedError'));
    refused.catch(() => {});
    HTMLMediaElement.prototype.play = () => (outcome === 'refuse' ? refused : Promise.resolve());
    return () => {
      HTMLMediaElement.prototype.play = original;
    };
  }

  test('when the platform accepts the play, the control says so', async function (assert) {
    let restore = stubPlay('accept');
    try {
      await render(<template><HoverVideoPlayer @src={{SRC}} @label='x' /></template>);
      await triggerEvent(fig(), 'pointerenter');
      await settled();
      assert.strictEqual(fig().dataset['playing'], 'true');
      assert.strictEqual(toggle().getAttribute('aria-pressed'), 'true');
      assert.true(toggle().getAttribute('aria-label')?.startsWith('Pause'), 'the name flips to the pause wording');
    } finally {
      restore();
    }
  });

  test('when the platform refuses the play, the control stops claiming it is playing', async function (assert) {
    // pointerenter with nothing else: no click, so no toggle can produce the
    // trailing stop — only the refusal path can.
    let restore = stubPlay('refuse');
    let seen: boolean[] = [];
    const record = (p: boolean) => seen.push(p);
    try {
      await render(<template><HoverVideoPlayer @src={{SRC}} @label='x' @onPlayingChange={{record}} /></template>);
      await triggerEvent(fig(), 'pointerenter');
      await settled();
      assert.deepEqual(seen, [true, false], 'the intent reported a start, the refusal reported the stop');
      assert.strictEqual(fig().dataset['playing'], undefined);
      assert.strictEqual(toggle().getAttribute('aria-pressed'), 'false', 'never a pressed button over a still frame');
      assert.strictEqual(toggle().getAttribute('aria-label'), 'Play preview of x');
    } finally {
      restore();
    }
  });

  test('pointer intent starts and stops the preview, and can be switched off', async function (assert) {
    let restore = stubPlay('accept');
    let seen: boolean[] = [];
    const record = (p: boolean) => seen.push(p);
    try {
      await render(<template><HoverVideoPlayer @src={{SRC}} @label='x' @onPlayingChange={{record}} /></template>);
      await triggerEvent(fig(), 'pointerenter');
      await triggerEvent(fig(), 'pointerleave');
      assert.deepEqual(seen, [true, false], 'enter starts, leave stops');

      seen = [];
      await render(<template><HoverVideoPlayer @src={{SRC}} @label='x' @playOnIntent={{false}} @onPlayingChange={{record}} /></template>);
      await triggerEvent(fig(), 'pointerenter');
      assert.deepEqual(seen, [], 'hover is inert when intent play is off');
    } finally {
      restore();
    }
  });

  test('ratio, caption, muted and loop are knobs, and an unsafe ratio is dropped', async function (assert) {
    await render(<template><HoverVideoPlayer @src={{SRC}} @label='x' @ratio='4 / 3' @caption='Twelve crates arrive' @muted={{false}} @loop={{false}} /></template>);
    assert.strictEqual(fig().getAttribute('style'), '--pretui-hvp-ratio: 4 / 3');
    assert.strictEqual(fig().querySelector('figcaption')?.textContent?.trim(), 'Twelve crates arrive');
    assert.false(video().muted);
    assert.false(video().loop);

    await render(<template><HoverVideoPlayer @src={{SRC}} @label='x' @ratio='1; background: url(javascript:0)' /></template>);
    assert.notOk((fig().getAttribute('style') ?? '').includes('javascript'));
  });

  test('renders the overlay block over the frame', async function (assert) {
    await render(<template><HoverVideoPlayer @src={{SRC}} @label='x'><:overlay><span data-test-chip>0:42</span></:overlay></HoverVideoPlayer></template>);
    assert.ok(fig().querySelector('.pretui-hvp-overlay [data-test-chip]'));
  });
});
