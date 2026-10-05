// Pretui — render proof for the media territory.
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
//
// A clean `boxel realm indexing-errors` proves only that the module graph
// evaluates; it says nothing about what a template did. For a vendored
// engine that lives behind custom elements this gap is the whole risk, so
// these assertions go past "it mounted" and check that the custom elements
// upgraded, that the transport is really in the DOM, and that teardown
// leaves nothing behind.
import { module, test } from 'qunit';
import { render, clearRender, click, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { AudioPlayer } from './components/audio-player';
import { MediaPlayer } from './components/media-player';
import { VideoPlayer } from './components/video-player';
import { MediaViewer } from './components/media-viewer';
import { kindForAsset } from './internal/media-viewer';
import { AssetGrid } from './components/asset-grid';
import {
  SOURCING_TRANSCRIPT as SAMPLE_TRANSCRIPT,
  TONE_WAV as SILENT_TONE,
  SAMPLE_ASSETS,
} from './media-examples';

module('Pretui | media', function (hooks) {
  setupCardTest(hooks);

  test('media-chrome custom elements are defined by the import', async function (assert) {
    assert.ok(
      customElements.get('media-controller'),
      'media-controller is defined',
    );
    assert.ok(
      customElements.get('media-time-range'),
      'media-time-range is defined',
    );
    assert.ok(
      customElements.get('media-play-button'),
      'media-play-button is defined',
    );
  });

  test('MediaPlayer renders a real transport over a real media element', async function (assert) {
    await render(
      <template>
        <MediaPlayer @src={{SILENT_TONE}} @kind='audio' @label='Tone' />
      </template>,
    );
    let root = document.querySelector('[data-test-pretui-media-player]');
    assert.ok(root, 'player root rendered');
    let controller = document.querySelector('media-controller');
    assert.ok(controller, 'media-controller rendered');
    assert.ok(
      controller instanceof (customElements.get('media-controller') as never),
      'media-controller upgraded to its class',
    );
    assert.ok(controller?.shadowRoot, 'media-controller built a shadow root');
    let audio = document.querySelector('audio[slot="media"]');
    assert.ok(audio, 'audio element is slotted as the media');
    assert.ok(
      document.querySelector('media-play-button'),
      'play button rendered',
    );
    assert.ok(
      document.querySelector('media-time-range'),
      'scrubber rendered',
    );
    assert.strictEqual(
      root?.getAttribute('data-kind'),
      'audio',
      'kind is reflected for styling',
    );
  });

  test('no captions button without tracks; one with them', async function (assert) {
    await render(
      <template>
        <MediaPlayer @src={{SILENT_TONE}} @kind='audio' @label='Tone' />
      </template>,
    );
    assert.notOk(
      document.querySelector('media-captions-button'),
      'no dead captions button when there are no text tracks',
    );
    await clearRender();

    const TRACKS = [
      {
        src: 'about:blank',
        label: 'English',
        srclang: 'en',
        isDefault: true,
      },
    ];
    await render(
      <template>
        <MediaPlayer
          @src={{SILENT_TONE}}
          @kind='audio'
          @label='Tone'
          @tracks={{TRACKS}}
        />
      </template>,
    );
    assert.ok(
      document.querySelector('media-captions-button'),
      'captions button appears once a text track exists',
    );
    let track = document.querySelector('audio > track');
    assert.strictEqual(track?.getAttribute('kind'), 'captions', 'track kind');
    assert.ok(track?.hasAttribute('default'), 'default track flagged');
  });

  test('the transcript is seekable and marks the current cue', async function (assert) {
    await render(
      <template>
        <MediaPlayer
          @src={{SILENT_TONE}}
          @kind='audio'
          @label='Tone'
          @transcript={{SAMPLE_TRANSCRIPT}}
          @transcriptOpen={{true}}
        />
      </template>,
    );
    let cues = document.querySelectorAll('[data-test-pretui-media-cue]');
    assert.strictEqual(
      cues.length,
      SAMPLE_TRANSCRIPT.length,
      'every cue rendered',
    );
    let toggle = document.querySelector(
      '[data-test-pretui-media-transcript-toggle]',
    ) as HTMLElement;
    assert.strictEqual(
      toggle?.getAttribute('aria-expanded'),
      'true',
      'transcript opens when asked',
    );
    let region = document.querySelector('.pretui-media-cues') as HTMLElement;
    assert.strictEqual(
      toggle?.getAttribute('aria-controls'),
      region?.id,
      'aria-controls resolves to the region that is actually there',
    );
    assert.notOk(region?.hidden, 'the region is visible while expanded');
    await click(toggle);
    assert.strictEqual(
      toggle?.getAttribute('aria-expanded'),
      'false',
      'the disclosure toggles',
    );
    assert.ok(
      region?.hidden,
      'and hides the region rather than removing the aria-controls target',
    );
    await click(toggle);
    let media = document.querySelector(
      '[data-test-pretui-media-element]',
    ) as HTMLMediaElement;
    await click(cues[2] as HTMLElement);
    assert.strictEqual(
      Math.round(media.currentTime),
      Math.round(SAMPLE_TRANSCRIPT[2].start),
      'clicking a cue seeks the media element',
    );
  });

  test('AudioPlayer and VideoPlayer are skins, not rewrites', async function (assert) {
    await render(
      <template>
        <AudioPlayer
          @src={{SILENT_TONE}}
          @title='Chest 118'
          @artist='Sourcing desk'
        />
      </template>,
    );
    assert.ok(
      document.querySelector('[data-test-pretui-audio-player]'),
      'audio skin rendered',
    );
    assert.strictEqual(
      document
        .querySelector('[data-test-pretui-media-player]')
        ?.getAttribute('data-kind'),
      'audio',
      'the skin curried kind=audio',
    );
    await clearRender();

    await render(
      <template>
        <VideoPlayer @src='about:blank' @label='Clip' @caption='A caption' />
      </template>,
    );
    assert.ok(
      document.querySelector('[data-test-pretui-video-player]'),
      'video skin rendered',
    );
    assert.ok(document.querySelector('figcaption'), 'caption is a figcaption');
    assert.ok(
      document.querySelector('video[slot="media"]'),
      'video element slotted',
    );
  });

  test('teardown removes the whole engine', async function (assert) {
    await render(
      <template><MediaPlayer @src={{SILENT_TONE}} @kind='audio' /></template>,
    );
    assert.ok(document.querySelector('media-controller'), 'mounted');
    await clearRender();
    assert.notOk(
      document.querySelector('media-controller'),
      'no media-controller survives teardown',
    );
    assert.notOk(
      document.querySelector('[data-test-pretui-media-element]'),
      'no media element survives teardown',
    );
  });

  test('kindForAsset routes by mime type, then by extension', function (assert) {
    assert.strictEqual(
      kindForAsset({ src: 'x', mimeType: 'video/mp4' }),
      'video',
    );
    assert.strictEqual(
      kindForAsset({ src: 'x', mimeType: 'audio/wav' }),
      'audio',
    );
    assert.strictEqual(kindForAsset({ src: 'a/b/c.WAV' }), 'audio');
    assert.strictEqual(kindForAsset({ src: 'a/b/c.mp4?x=1#y' }), 'video');
    assert.strictEqual(kindForAsset({ src: 'a/b/c.jpg' }), 'image');
    assert.strictEqual(kindForAsset({ src: 'a/b/c.glb' }), 'model');
    assert.strictEqual(kindForAsset({ src: 'a/b/c.xyz' }), 'unknown');
    assert.strictEqual(
      kindForAsset({ src: 'a/b/c.jpg', kind: 'video' }),
      'video',
      'an explicit kind always wins',
    );
  });

  test('MediaViewer picks an adapter per asset kind', async function (assert) {
    const AUDIO = { src: SILENT_TONE, name: 'Tone', mimeType: 'audio/wav' };
    await render(<template><MediaViewer @asset={{AUDIO}} /></template>);
    assert.strictEqual(
      document
        .querySelector('[data-test-pretui-media-viewer]')
        ?.getAttribute('data-adapter'),
      'audio',
      'audio asset routed to the audio adapter',
    );
    assert.ok(
      document.querySelector('[data-test-pretui-audio-player]'),
      'and the audio adapter really is AudioPlayer',
    );
    await clearRender();

    const IMAGE = { src: 'about:blank', name: 'Plate', mimeType: 'image/jpeg' };
    await render(<template><MediaViewer @asset={{IMAGE}} /></template>);
    assert.strictEqual(
      document
        .querySelector('[data-test-pretui-media-viewer]')
        ?.getAttribute('data-adapter'),
      'image',
      'image asset routed to the image adapter',
    );
    await clearRender();

    const ODD = { src: 'about:blank', name: 'Mystery', mimeType: 'x/y' };
    await render(<template><MediaViewer @asset={{ODD}} /></template>);
    assert.strictEqual(
      document
        .querySelector('[data-test-pretui-media-viewer]')
        ?.getAttribute('data-adapter'),
      'unsupported',
      'an unknown kind lands on the honest fallback, not a blank box',
    );
  });

  test('AssetGrid moves focus with the arrows through a production-safe hook', async function (assert) {
    await render(<template><AssetGrid @rows={{SAMPLE_ASSETS}} /></template>);
    let tiles = () => Array.from(document.querySelectorAll('.pretui-assets-hit')) as HTMLElement[];
    tiles()[0]?.focus();
    await triggerKeyEvent(document.activeElement as HTMLElement, 'keydown', 'ArrowRight');
    assert.strictEqual(document.activeElement, tiles()[1], 'ArrowRight moved focus to the next tile');
    await triggerKeyEvent(document.activeElement as HTMLElement, 'keydown', 'Home');
    assert.strictEqual(document.activeElement, tiles()[0], 'Home moved it back');
  });

  test('AssetGrid rides DataComponent rather than reimplementing it', async function (assert) {
    await render(
      <template>
        <AssetGrid @rows={{SAMPLE_ASSETS}} @selectionMode='multi' />
      </template>,
    );
    let tiles = document.querySelectorAll('[data-test-pretui-asset]');
    assert.strictEqual(tiles.length, SAMPLE_ASSETS.length, 'every asset tiled');
    let grid = document.querySelector('[data-test-pretui-asset-grid]');
    assert.strictEqual(grid?.getAttribute('role'), 'listbox', 'listbox role');
    assert.strictEqual(
      grid?.getAttribute('aria-multiselectable'),
      'true',
      'multi-select is announced',
    );
    assert.strictEqual(
      document.querySelectorAll('[data-test-pretui-asset][tabindex="0"]')
        .length,
      1,
      'exactly one tab stop — roving tabindex',
    );
    await click(tiles[1] as HTMLElement);
    assert.strictEqual(
      tiles[1].getAttribute('aria-selected'),
      'true',
      'clicking selects',
    );

    const NONE: never[] = [];
    await clearRender();
    await render(<template><AssetGrid @rows={{NONE}} /></template>);
    assert.ok(
      document.querySelector('[data-test-pretui-empty]'),
      'the DataShell empty state is inherited, not rewritten',
    );
  });
});
