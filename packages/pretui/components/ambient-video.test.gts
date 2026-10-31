// Pretui — AmbientVideo unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// IntersectionObserver and HTMLMediaElement.play are stubbed, so the tests
// own "near", "visible" and the autoplay verdict instead of depending on the
// runner's viewport or on whether it can decode a clip.
import { module, test } from 'qunit';
import { click, render, settled } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { AmbientVideo, type AmbientVideoState } from './ambient-video';

const SRC = 'data:video/mp4;base64,AAAA';
const FALLBACK = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

function fig(): HTMLElement {
  return document.querySelector('[data-test-pretui-ambient-video]') as HTMLElement;
}
function video(): HTMLVideoElement {
  return fig().querySelector('[data-test-pretui-ambient-video-element]') as HTMLVideoElement;
}
function toggle(): HTMLButtonElement {
  return fig().querySelector('[data-test-pretui-ambient-video-toggle]') as HTMLButtonElement;
}

/** A controllable IntersectionObserver: the component makes one for loading
 * (it has a rootMargin) and one for playing (it has a threshold). */
class FakeObserver {
  static all: FakeObserver[] = [];
  constructor(
    private callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
    FakeObserver.all.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
  fire(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}
function loader(): FakeObserver | undefined {
  return FakeObserver.all.find((o) => o.options.rootMargin !== undefined);
}
function player(): FakeObserver | undefined {
  return FakeObserver.all.find((o) => o.options.threshold !== undefined);
}

type Verdict = 'accept' | 'NotAllowedError' | 'AbortError';

module('Pretui | components/ambient-video', function (hooks) {
  setupCardTest(hooks);

  let originalIO: typeof IntersectionObserver;
  let originalPlay: typeof HTMLMediaElement.prototype.play;
  let originalMatchMedia: typeof window.matchMedia;
  let plays = 0;
  // The fake data: clip cannot decode, so the runner fires real media
  // `error` events; swallowing them in the capture phase keeps the verdict
  // the test's, like the play() stub does. The error path has its own test.
  let swallowMediaErrors = (event: Event) => {
    if (event.target instanceof HTMLMediaElement) {
      event.stopImmediatePropagation();
    }
  };

  function verdict(outcome: Verdict) {
    HTMLMediaElement.prototype.play = function () {
      plays++;
      if (outcome === 'accept') {
        return Promise.resolve();
      }
      let refused = Promise.reject(new DOMException('refused', outcome));
      refused.catch(() => {});
      return refused;
    };
  }

  hooks.beforeEach(function () {
    FakeObserver.all = [];
    plays = 0;
    originalIO = window.IntersectionObserver;
    originalPlay = HTMLMediaElement.prototype.play;
    originalMatchMedia = window.matchMedia;
    window.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
    window.addEventListener('error', swallowMediaErrors, true);
    verdict('accept');
  });
  hooks.afterEach(function () {
    window.IntersectionObserver = originalIO;
    HTMLMediaElement.prototype.play = originalPlay;
    window.matchMedia = originalMatchMedia;
    window.removeEventListener('error', swallowMediaErrors, true);
  });

  test('a decorative muted inline video, with one named control and nothing loaded yet', async function (assert) {
    await render(<template><AmbientVideo @src={{SRC}} /></template>);
    assert.strictEqual(fig().tagName, 'FIGURE');
    assert.strictEqual(video().getAttribute('aria-hidden'), 'true');
    assert.strictEqual(video().tabIndex, -1, 'not a second, unlabelled control');
    assert.true(video().muted, 'muted as a property, which is what autoplay checks');
    assert.true(video().playsInline, 'inline, never fullscreen on iPhone');
    assert.false(video().hasAttribute('autoplay'), 'play() is the component’s call, not the parser’s');
    assert.false(video().hasAttribute('src'), 'nothing is fetched before the frame is near');
    assert.strictEqual(fig().dataset['state'], 'idle');
    assert.strictEqual(toggle().getAttribute('aria-label'), 'Play background video');
  });

  test('@label names the figure and the control', async function (assert) {
    await render(<template><AmbientVideo @src={{SRC}} @label='the campus map' /></template>);
    assert.strictEqual(fig().getAttribute('aria-label'), 'the campus map');
    assert.strictEqual(toggle().getAttribute('aria-label'), 'Play the campus map');
  });

  test('near attaches the source; visible plays it; off screen pauses it', async function (assert) {
    await render(<template><AmbientVideo @src={{SRC}} /></template>);
    loader()?.fire(true);
    await settled();
    assert.strictEqual(video().getAttribute('src'), SRC, 'attached when near');
    player()?.fire(true);
    await settled();
    assert.strictEqual(plays, 1, 'played when visible');
    assert.strictEqual(fig().dataset['state'], 'playing');
    assert.strictEqual(toggle().getAttribute('aria-label'), 'Pause background video');
    player()?.fire(false);
    await settled();
    assert.strictEqual(fig().dataset['state'], 'paused', 'a page pause, not the reader’s');
  });

  test('a refused autoplay with no fallback centres a play button', async function (assert) {
    verdict('NotAllowedError');
    await render(<template><AmbientVideo @src={{SRC}} @load='eager' /></template>);
    player()?.fire(true);
    await settled();
    assert.strictEqual(fig().dataset['state'], 'blocked');
    assert.strictEqual(toggle().dataset['centred'], 'true');
    assert.strictEqual(toggle().getAttribute('aria-label'), 'Play background video');
  });

  test('a refused autoplay with @fallback shows the animated image, which still pauses', async function (assert) {
    verdict('NotAllowedError');
    await render(<template><AmbientVideo @src={{SRC}} @load='eager' @fallback={{FALLBACK}} /></template>);
    player()?.fire(true);
    await settled();
    assert.strictEqual(fig().dataset['state'], 'fallback');
    let img = fig().querySelector('[data-test-pretui-ambient-video-fallback]');
    assert.strictEqual(img?.getAttribute('src'), FALLBACK);
    assert.strictEqual(toggle().getAttribute('aria-label'), 'Pause background video', 'the fallback moves, so it gets a pause');
    await click(toggle());
    assert.strictEqual(fig().dataset['state'], 'user-paused');
    assert.notOk(fig().querySelector('[data-test-pretui-ambient-video-fallback]'), 'paused means the still poster');
  });

  test('an AbortError is not a refusal', async function (assert) {
    verdict('AbortError');
    await render(<template><AmbientVideo @src={{SRC}} @load='eager' /></template>);
    player()?.fire(true);
    await settled();
    assert.notStrictEqual(fig().dataset['state'], 'blocked');
    assert.notStrictEqual(fig().dataset['state'], 'fallback');
  });

  test('a pause the reader asked for survives scrolling away and back', async function (assert) {
    await render(<template><AmbientVideo @src={{SRC}} @load='eager' /></template>);
    player()?.fire(true);
    await settled();
    assert.strictEqual(plays, 1);
    await click(toggle());
    assert.strictEqual(fig().dataset['state'], 'user-paused');
    player()?.fire(false);
    player()?.fire(true);
    await settled();
    assert.strictEqual(plays, 1, 'scrolling back did not resume it');
    await click(toggle());
    await settled();
    assert.strictEqual(plays, 2, 'the button did');
    assert.strictEqual(fig().dataset['state'], 'playing');
  });

  test('reduced motion starts paused and fetches nothing until pressed', async function (assert) {
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    await render(<template><AmbientVideo @src={{SRC}} /></template>);
    assert.strictEqual(fig().dataset['state'], 'reduced-motion');
    assert.strictEqual(loader(), undefined, 'no load observer at all');
    assert.false(video().hasAttribute('src'));
    assert.strictEqual(toggle().dataset['centred'], 'true');
    await click(toggle());
    assert.strictEqual(video().getAttribute('src'), SRC, 'the press is consent');
  });

  test('@onStateChange reports the lifecycle', async function (assert) {
    let seen: AmbientVideoState[] = [];
    let record = (s: AmbientVideoState) => seen.push(s);
    await render(<template><AmbientVideo @src={{SRC}} @onStateChange={{record}} /></template>);
    loader()?.fire(true);
    player()?.fire(true);
    await settled();
    assert.deepEqual(seen, ['loading', 'playing']);
  });

  test('a clip that will not load is retried once, then offers a centred play', async function (assert) {
    await render(<template><AmbientVideo @src={{SRC}} @load='eager' /></template>);
    await settled();
    window.removeEventListener('error', swallowMediaErrors, true);
    video().dispatchEvent(new Event('error'));
    assert.notStrictEqual(fig().dataset['state'], 'error', 'the first failure is retried');
    video().dispatchEvent(new Event('error'));
    await settled();
    assert.strictEqual(fig().dataset['state'], 'error');
    assert.strictEqual(toggle().dataset['centred'], 'true');
  });

  test('@ratio reserves the box; @fit is exposed for styling', async function (assert) {
    await render(<template><AmbientVideo @src={{SRC}} @ratio='4 / 3' @fit='contain' /></template>);
    assert.strictEqual(fig().getAttribute('style'), '--pretui-ambient-ratio: 4 / 3');
    assert.strictEqual(fig().dataset['fit'], 'contain');
  });
});
