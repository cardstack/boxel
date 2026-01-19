import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { ensureTrailingSlash } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import ENV from '@cardstack/host/config/environment';

import {
  setupBaseRealm,
  field,
  contains,
  CardDef,
  Component,
} from '../helpers/base-realm';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

type FieldFormat = 'embedded' | 'atom' | 'edit' | 'fitted';

module('Integration | audio fields', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let catalogRealmURL = ensureTrailingSlash(ENV.resolvedCatalogRealmURL);

  let AudioFieldClass: any;

  let catalogFieldsLoaded = false;

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    if (!catalogFieldsLoaded) {
      await loadCatalogFields();
      catalogFieldsLoaded = true;
    }
  });

  async function loadCatalogFields() {
    const audioModule: any = await loader.import(
      `${catalogRealmURL}fields/audio`,
    );
    AudioFieldClass = audioModule.default;
  }

  async function renderField(
    FieldClass: any,
    value: unknown,
    format: FieldFormat = 'embedded',
  ) {
    const fieldFormat = format;
    const fieldType = FieldClass;

    class TestCard extends CardDef {
      @field sample = contains(fieldType);

      static isolated = class Isolated extends Component<typeof this> {
        format: FieldFormat = fieldFormat;

        <template>
          <div data-test-field-container>
            <@fields.sample @format={{this.format}} />
          </div>
        </template>
      };
    }

    let card = new TestCard({ sample: value });
    await renderCard(loader, card, 'isolated');
  }

  async function renderConfiguredField(
    FieldClass: any,
    value: unknown,
    configuration: Record<string, unknown> = {},
  ) {
    const fieldType = FieldClass;

    class TestCard extends CardDef {
      @field sample = contains(fieldType, { configuration });

      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-field-container>
            <@fields.sample @format='embedded' />
          </div>
        </template>
      };
    }

    let card = new TestCard({ sample: value });
    await renderCard(loader, card, 'isolated');
  }

  function buildField(FieldClass: any, attrs: Record<any, unknown>) {
    return new FieldClass(attrs);
  }

  // Sample audio data for tests
  const sampleAudioData = {
    url: 'http://localhost:4201/does-not-exist/audio/sample.mp3',
    filename: 'sample.mp3',
    mimeType: 'audio/mpeg',
    duration: 180, // 3 minutes
    fileSize: 3145728, // 3MB
    cardTitle: 'Test Track',
    artist: 'Test Artist',
  };

  const minimalAudioData = {
    url: 'http://localhost:4201/does-not-exist/audio/minimal.mp3',
    filename: 'minimal.mp3',
  };

  // ============================================
  // Basic Rendering Tests
  // ============================================

  test('audio field renders embedded view with valid data', async function (assert) {
    await renderField(
      AudioFieldClass,
      buildField(AudioFieldClass, sampleAudioData),
    );

    assert.dom('[data-test-audio-embedded]').exists('embedded view renders');
    assert
      .dom('[data-test-audio-title]')
      .hasText('Test Track', 'title is displayed');
    assert
      .dom('[data-test-audio-artist]')
      .hasText('Test Artist', 'artist is displayed');
    assert.dom('[data-test-audio-play-btn]').exists('play button is rendered');
  });

  test('audio field renders atom view with valid data', async function (assert) {
    await renderField(
      AudioFieldClass,
      buildField(AudioFieldClass, sampleAudioData),
      'atom',
    );

    assert.dom('[data-test-audio-atom]').exists('atom view renders');
    assert
      .dom('[data-test-audio-atom]')
      .hasTextContaining('Test Track', 'displays title in atom view');
  });

  test('audio field renders fitted view with valid data', async function (assert) {
    await renderField(
      AudioFieldClass,
      buildField(AudioFieldClass, sampleAudioData),
      'fitted',
    );

    assert.dom('[data-test-audio-fitted]').exists('fitted view renders');
  });

  test('audio field renders edit view with valid data', async function (assert) {
    await renderField(
      AudioFieldClass,
      buildField(AudioFieldClass, sampleAudioData),
      'edit',
    );

    assert.dom('[data-test-audio-edit]').exists('edit view renders');
    assert
      .dom('[data-test-audio-uploaded-file]')
      .exists('shows uploaded file info');
  });

  // ============================================
  // Empty State Tests
  // ============================================

  test('missing audio renders placeholder in embedded view', async function (assert) {
    await renderField(AudioFieldClass, buildField(AudioFieldClass, {}));

    assert
      .dom('[data-test-audio-placeholder]')
      .exists('placeholder is displayed');
    assert
      .dom('[data-test-audio-placeholder]')
      .hasTextContaining('No audio file', 'placeholder text is shown');
  });

  test('missing audio renders placeholder in fitted view', async function (assert) {
    await renderField(
      AudioFieldClass,
      buildField(AudioFieldClass, {}),
      'fitted',
    );

    assert
      .dom('[data-test-audio-fitted-placeholder]')
      .exists('fitted placeholder is displayed');
    assert
      .dom('[data-test-audio-fitted-placeholder]')
      .hasTextContaining('No audio', 'fitted placeholder text is shown');
  });

  test('missing audio shows upload area in edit view', async function (assert) {
    await renderField(AudioFieldClass, buildField(AudioFieldClass, {}), 'edit');

    assert.dom('[data-test-audio-edit]').exists('edit view renders');
    assert
      .dom('[data-test-audio-upload-area]')
      .exists('upload area is displayed');
  });

  test('undefined audio field renders placeholder', async function (assert) {
    await renderField(AudioFieldClass, undefined);

    assert
      .dom('[data-test-audio-placeholder]')
      .exists('placeholder is displayed for undefined');
  });

  // ============================================
  // Computed Field Tests
  // ============================================

  test('displayTitle shows title when available', async function (assert) {
    await renderField(
      AudioFieldClass,
      buildField(AudioFieldClass, {
        ...sampleAudioData,
        cardTitle: 'Custom Title',
      }),
    );

    assert
      .dom('[data-test-audio-title]')
      .hasText('Custom Title', 'custom title is displayed');
  });

  test('displayTitle falls back to filename when no title', async function (assert) {
    await renderField(
      AudioFieldClass,
      buildField(AudioFieldClass, {
        url: 'http://localhost:4201/does-not-exist/audio.mp3',
        filename: 'my-song.mp3',
      }),
    );

    assert
      .dom('[data-test-audio-title]')
      .hasText('my-song.mp3', 'filename is displayed as fallback');
  });

  test('displayTitle falls back to default when no title or filename', async function (assert) {
    await renderField(
      AudioFieldClass,
      buildField(AudioFieldClass, {
        url: 'http://localhost:4201/does-not-exist/audio.mp3',
      }),
    );

    assert
      .dom('[data-test-audio-title]')
      .hasText('Untitled Audio', 'default title is displayed');
  });

  // ============================================
  // Presentation Style Tests
  // ============================================

  test('waveform-player presentation renders correctly', async function (assert) {
    await renderConfiguredField(
      AudioFieldClass,
      buildField(AudioFieldClass, sampleAudioData),
      { presentation: 'waveform-player' },
    );

    assert
      .dom('[data-test-waveform-player]')
      .exists('waveform player is rendered');
  });

  test('mini-player presentation renders correctly', async function (assert) {
    await renderConfiguredField(
      AudioFieldClass,
      buildField(AudioFieldClass, sampleAudioData),
      { presentation: 'mini-player' },
    );

    assert.dom('[data-test-mini-player]').exists('mini player is rendered');
  });

  test('album-cover presentation renders correctly', async function (assert) {
    await renderConfiguredField(
      AudioFieldClass,
      buildField(AudioFieldClass, sampleAudioData),
      { presentation: 'album-cover' },
    );

    assert
      .dom('[data-test-album-cover-player]')
      .exists('album cover player is rendered');
  });

  test('trim-editor presentation renders correctly', async function (assert) {
    await renderConfiguredField(
      AudioFieldClass,
      buildField(AudioFieldClass, sampleAudioData),
      { presentation: 'trim-editor' },
    );

    assert.dom('[data-test-trim-editor]').exists('trim editor is rendered');
  });

  test('playlist-row presentation renders correctly', async function (assert) {
    await renderConfiguredField(
      AudioFieldClass,
      buildField(AudioFieldClass, sampleAudioData),
      { presentation: 'playlist-row' },
    );

    assert.dom('[data-test-playlist-row]').exists('playlist row is rendered');
  });

  test('inline-player (default) presentation renders correctly', async function (assert) {
    await renderConfiguredField(
      AudioFieldClass,
      buildField(AudioFieldClass, sampleAudioData),
      {}, // Default presentation
    );

    assert
      .dom('[data-test-audio-embedded]')
      .exists('inline player is rendered (default)');
  });

  // ============================================
  // Configuration Options Tests
  // ============================================

  test('showVolume option renders volume control', async function (assert) {
    await renderConfiguredField(
      AudioFieldClass,
      buildField(AudioFieldClass, sampleAudioData),
      { options: { showVolume: true } },
    );

    assert
      .dom('[data-test-volume-control]')
      .exists('volume control is rendered');
  });

  test('showSpeedControl option renders speed selector', async function (assert) {
    await renderConfiguredField(
      AudioFieldClass,
      buildField(AudioFieldClass, sampleAudioData),
      { options: { showSpeedControl: true } },
    );

    assert
      .dom('[data-test-audio-advanced-controls]')
      .exists('advanced controls are rendered');
    assert
      .dom('[data-test-audio-speed-control]')
      .exists('speed control is rendered');
  });

  test('showLoopControl option renders loop checkbox', async function (assert) {
    await renderConfiguredField(
      AudioFieldClass,
      buildField(AudioFieldClass, sampleAudioData),
      { options: { showLoopControl: true } },
    );

    assert
      .dom('[data-test-audio-loop-control]')
      .exists('loop control is rendered');
    assert
      .dom('[data-test-audio-loop-checkbox]')
      .exists('loop checkbox is rendered');
  });

  // ============================================
  // Metadata Display Tests
  // ============================================

  test('audio metadata displays correctly', async function (assert) {
    await renderField(
      AudioFieldClass,
      buildField(AudioFieldClass, sampleAudioData),
    );

    assert.dom('[data-test-audio-metadata]').exists('metadata section exists');
  });

  test('minimal audio data still renders', async function (assert) {
    await renderField(
      AudioFieldClass,
      buildField(AudioFieldClass, minimalAudioData),
    );

    assert.dom('[data-test-audio-embedded]').exists('player still renders');
    assert.dom('[data-test-audio-artist]').doesNotExist('no artist shown');
  });

  // ============================================
  // Player Controls Tests
  // ============================================

  test('play button exists and is clickable', async function (assert) {
    await renderField(
      AudioFieldClass,
      buildField(AudioFieldClass, sampleAudioData),
    );

    assert.dom('[data-test-audio-play-btn]').exists('play button exists');
  });

  test('seek bar is hidden when audio has not loaded metadata', async function (assert) {
    await renderField(
      AudioFieldClass,
      buildField(AudioFieldClass, sampleAudioData),
    );

    // The seek bar/controls only appear after audio metadata is loaded
    // With fake URLs, the audio never loads, so controls won't appear
    // This is expected behavior - controls are conditional on audioDuration
    assert
      .dom('[data-test-audio-controls]')
      .doesNotExist('controls hidden until audio loads');
    assert.dom('[data-test-audio-play-btn]').exists('play button always shows');
  });

  // ============================================
  // Atom View Tests
  // ============================================

  test('atom view shows audio icon', async function (assert) {
    await renderField(
      AudioFieldClass,
      buildField(AudioFieldClass, sampleAudioData),
      'atom',
    );

    assert.dom('[data-test-audio-atom] svg').exists('audio icon is shown');
    assert
      .dom('[data-test-audio-atom]')
      .hasTextContaining('Test Track', 'title is shown');
  });

  test('atom view shows displayTitle fallback', async function (assert) {
    await renderField(
      AudioFieldClass,
      buildField(AudioFieldClass, { url: 'test.mp3' }),
      'atom',
    );

    assert
      .dom('[data-test-audio-atom]')
      .hasTextContaining('Untitled Audio', 'fallback title shown');
  });

  // ============================================
  // Edit View Tests
  // ============================================

  test('edit view shows metadata fields when audio is uploaded', async function (assert) {
    await renderField(
      AudioFieldClass,
      buildField(AudioFieldClass, sampleAudioData),
      'edit',
    );

    assert.dom('[data-test-audio-edit]').exists('edit view renders');
    assert
      .dom('[data-test-audio-uploaded-file]')
      .exists('uploaded file info shown');
  });

  test('edit view shows upload prompt when no audio', async function (assert) {
    await renderField(AudioFieldClass, buildField(AudioFieldClass, {}), 'edit');

    assert
      .dom('[data-test-audio-upload-area]')
      .exists('upload prompt is shown');
  });
});
