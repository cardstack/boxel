// The shared FileDef format shells read nothing off a file directly — they read
// this projection. These tests pin the two contracts families depend on: how a
// file is classified, and the work budgets a fitted collection cell enforces
// before any markup is produced.

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { setupRenderingTest } from '../helpers/setup';

import type * as FileTypeProfileModule from '@cardstack/base/file-formats/file-type-profile';
import type * as FileViewModelModule from '@cardstack/base/file-formats/file-view-model';

module('Unit | file-formats', function (hooks) {
  setupRenderingTest(hooks);

  let loader: Loader;
  let profileForFile: typeof FileTypeProfileModule.profileForFile;
  let extensionOfFile: typeof FileTypeProfileModule.extensionOfFile;
  let contentTypeForFile: typeof FileTypeProfileModule.contentTypeForFile;
  let fileViewModel: typeof FileViewModelModule.fileViewModel;
  let FITTED_TEXT_CHARACTER_BUDGET: number;
  let FITTED_TEXT_LINE_BUDGET: number;
  let FITTED_WAVEFORM_BAR_BUDGET: number;

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    let profileModule = await loader.import<typeof FileTypeProfileModule>(
      '@cardstack/base/file-formats/file-type-profile',
    );
    let viewModelModule = await loader.import<typeof FileViewModelModule>(
      '@cardstack/base/file-formats/file-view-model',
    );
    ({ profileForFile, contentTypeForFile, extensionOfFile } = profileModule);
    ({
      fileViewModel,
      FITTED_TEXT_CHARACTER_BUDGET,
      FITTED_TEXT_LINE_BUDGET,
      FITTED_WAVEFORM_BAR_BUDGET,
    } = viewModelModule);
  });

  module('taxonomy', function () {
    test('routes on MIME type first', function (assert) {
      let profile = profileForFile({
        name: 'clip.bin',
        contentType: 'video/webm',
      });
      assert.strictEqual(profile.id, 'webm');
      assert.strictEqual(profile.family, 'video');
      assert.strictEqual(profile.previewAdapter, 'media');
    });

    // Realm responses routinely carry a charset parameter, which would defeat
    // an exact-match lookup.
    test('ignores content-type parameters', function (assert) {
      assert.strictEqual(
        contentTypeForFile({
          name: 'page.html',
          contentType: 'text/html; charset=utf-8',
        }),
        'text/html',
      );
      assert.strictEqual(
        profileForFile({
          name: 'page.html',
          contentType: 'text/html; charset=UTF-8',
        }).family,
        'web',
      );
    });

    test('falls back to the extension when the type is absent', function (assert) {
      let profile = profileForFile({ name: 'model.glb' });
      assert.strictEqual(profile.family, 'model');
      assert.true(profile.capabilities.includes('scene'));
    });

    // A generic octet-stream is what a realm serves for anything it can't
    // type, so the extension has to be able to out-rank it.
    test('prefers the extension over an uninformative octet-stream', function (assert) {
      let profile = profileForFile({
        name: 'song.flac',
        contentType: 'application/octet-stream',
      });
      assert.strictEqual(profile.family, 'audio');
    });

    test('names an unknown extension honestly rather than guessing', function (assert) {
      let profile = profileForFile({ name: 'telemetry.qqq' });
      assert.strictEqual(profile.family, 'generic');
      assert.strictEqual(profile.kind, 'QQQ file');
      assert.strictEqual(profile.previewAdapter, 'fallback');
    });

    // MIDI is a note sequence, not encoded audio: it only becomes sound
    // through a synthesizer, so it gets its own family and adapter.
    test('keeps MIDI distinct from sampled audio', function (assert) {
      let midi = profileForFile({ name: 'suite.mid' });
      assert.strictEqual(midi.family, 'music');
      assert.strictEqual(midi.previewAdapter, 'midi');
      assert.true(midi.capabilities.includes('synthesis'));
    });
  });

  module('identity', function () {
    test('splits the name into base name and uppercase extension', function (assert) {
      let vm = fileViewModel({
        url: 'http://test.com/q3-report.final.pdf',
        name: 'q3-report.final.pdf',
        contentType: 'application/pdf',
      });
      assert.strictEqual(vm.baseName, 'q3-report.final');
      assert.strictEqual(vm.extension, 'PDF');
      assert.strictEqual(vm.kind, 'PDF document');
    });

    // A name with no extension has no extension — not one equal to the whole
    // name, which would put a `.LICENSE` pill next to `LICENSE`.
    test('leaves an extensionless name intact and reports no extension', function (assert) {
      let vm = fileViewModel({
        url: 'http://test.com/LICENSE',
        name: 'LICENSE',
      });
      assert.strictEqual(vm.baseName, 'LICENSE');
      assert.strictEqual(vm.extension, '');
    });

    // A dotfile's leading dot doesn't introduce an extension either, and the
    // name must survive whole rather than being consumed as a suffix.
    test('treats a dotfile as an extensionless name', function (assert) {
      let vm = fileViewModel({
        url: 'http://test.com/.gitignore',
        name: '.gitignore',
      });
      assert.strictEqual(vm.baseName, '.gitignore');
      assert.strictEqual(vm.extension, '');
    });

    // The projection and the taxonomy registry have to agree, or the pill and
    // the routing describe the same file differently.
    test('derives the extension the same way the taxonomy registry does', function (assert) {
      for (let name of [
        'report.pdf',
        'q3.final.pdf',
        'LICENSE',
        '.gitignore',
      ]) {
        assert.strictEqual(
          fileViewModel({ name }).extension.toLowerCase(),
          extensionOfFile({ name }),
          `${name} agrees with extensionOfFile`,
        );
      }
    });

    test('derives the name from the URL when the file has none', function (assert) {
      let vm = fileViewModel({ url: 'http://test.com/a/b/notes.txt' });
      assert.strictEqual(vm.name, 'notes.txt');
      assert.strictEqual(vm.baseName, 'notes');
    });

    test('reports a file with no resource and no content as empty', function (assert) {
      assert.strictEqual(
        fileViewModel({ name: 'ghost.pdf' }).fileState,
        'empty',
      );
      assert.strictEqual(
        fileViewModel({ url: 'http://test.com/x.pdf', contentSize: 0 })
          .fileState,
        'empty',
      );
      assert.strictEqual(
        fileViewModel({ url: 'http://test.com/x.pdf', contentSize: 10 })
          .fileState,
        'normal',
      );
    });

    // A rendition produced from bytes the file no longer has must not be shown
    // as if it were current.
    test('marks a thumbnail stale when its source hash no longer matches', function (assert) {
      let base = {
        url: 'http://test.com/clip.mp4',
        name: 'clip.mp4',
        contentHash: 'aaa',
        thumbnailImage: { url: 'http://test.com/thumb.png' },
      };
      assert.false(
        fileViewModel({
          ...base,
          thumbnailMetadata: { sourceHash: 'aaa' },
        }).thumbnailStale,
      );
      assert.true(
        fileViewModel({
          ...base,
          thumbnailMetadata: { sourceHash: 'bbb' },
        }).thumbnailStale,
      );
      // No recorded provenance is not evidence of staleness.
      assert.false(fileViewModel(base).thumbnailStale);
    });
  });

  module('fitted budgets', function () {
    test('truncates text by both characters and lines before markup', function (assert) {
      let content = Array.from({ length: 200 }, (_, i) => `line ${i}`).join(
        '\n',
      );
      let fitted = fileViewModel({ name: 'a.txt', content }, 'fitted');
      let embedded = fileViewModel({ name: 'a.txt', content }, 'embedded');

      assert.strictEqual(
        fitted.previewText.split('\n').length,
        FITTED_TEXT_LINE_BUDGET,
      );
      assert.true(fitted.previewTruncated);
      assert.strictEqual(
        embedded.previewText,
        content,
        'detailed formats keep the complete source',
      );
      assert.false(embedded.previewTruncated);
    });

    test('applies the character budget to a single very long line', function (assert) {
      let content = 'x'.repeat(FITTED_TEXT_CHARACTER_BUDGET * 2);
      let fitted = fileViewModel({ name: 'a.txt', content }, 'fitted');
      assert.strictEqual(
        fitted.previewText.length,
        FITTED_TEXT_CHARACTER_BUDGET,
      );
      assert.true(fitted.previewTruncated);
    });

    test('caps archive entries and schema rows but keeps the true totals', function (assert) {
      let model = {
        name: 'bundle.zip',
        archiveContents: Array.from({ length: 40 }, (_, i) => ({
          path: `entry-${i}`,
        })),
        schemaFields: Array.from({ length: 12 }, (_, i) => ({
          fieldName: `field${i}`,
        })),
      };
      let fitted = fileViewModel(model, 'fitted');
      assert.strictEqual(fitted.archiveEntries.length, 4);
      assert.strictEqual(fitted.archiveEntryCount, 40);
      assert.strictEqual(fitted.schemaRows.length, 4);
      assert.strictEqual(fitted.schemaRowCount, 12);
      assert.true(fitted.previewTruncated);

      let isolated = fileViewModel(model, 'isolated');
      assert.strictEqual(isolated.archiveEntries.length, 40);
      assert.strictEqual(isolated.schemaRows.length, 12);
    });

    // Resampling has to sample across the whole signal: returning the first N
    // bars would show only the opening seconds of the waveform. Stored bars
    // are 0..1 amplitudes; the projection scales them to the 0–100 range the
    // renderers draw from.
    test('resamples the waveform across the whole envelope', function (assert) {
      // Quarter steps stay exact through the x100 scaling.
      let bars = Array.from({ length: 1000 }, (_, i) => (i % 5) / 4);
      let model = {
        name: 'take.wav',
        waveform: { barsJson: JSON.stringify(bars) },
      };

      let fitted = fileViewModel(model, 'fitted');
      assert.strictEqual(
        fitted.waveformBars.length,
        FITTED_WAVEFORM_BAR_BUDGET,
      );
      assert.strictEqual(fitted.waveformBars[0], bars[0]! * 100);
      assert.strictEqual(
        fitted.waveformBars.at(-1),
        bars.at(-1)! * 100,
        'the last bar comes from the end of the signal, not from bar 64',
      );

      assert.strictEqual(
        fileViewModel(model, 'isolated').waveformBars.length,
        256,
      );
    });

    test('a waveform shorter than the budget is scaled but not resampled', function (assert) {
      let bars = [0.25, 0.5, 0.75, 1];
      let vm = fileViewModel(
        { name: 'blip.wav', waveform: { barsJson: JSON.stringify(bars) } },
        'fitted',
      );
      assert.deepEqual(vm.waveformBars, [25, 50, 75, 100]);
    });

    // The producers' contract is 0..1 (RMS amplitudes; MP3's peak-normalized
    // envelope). A full-scale bar must project to full height — this is the
    // difference between a waveform and a flat line of minimum-height slivers
    // — and out-of-range values clamp rather than distort the scale.
    test('amplitude bars project to the renderer percentage scale', function (assert) {
      let vm = fileViewModel(
        {
          name: 'loud.mp3',
          waveform: { barsJson: JSON.stringify([0, 0.5, 1, 1.2, -0.5]) },
        },
        'fitted',
      );
      assert.deepEqual(vm.waveformBars, [0, 50, 100, 100, 0]);
    });

    test('survives waveform data that is not parseable', function (assert) {
      let vm = fileViewModel(
        { name: 'broken.wav', waveform: { barsJson: 'not json' } },
        'fitted',
      );
      assert.deepEqual(vm.waveformBars, []);
    });
  });

  module('facts', function () {
    test('prefers dimensions as the hero fact', function (assert) {
      let vm = fileViewModel({
        name: 'hero.png',
        url: 'http://test.com/hero.png',
        width: 1920,
        height: 1080,
      });
      assert.strictEqual(vm.heroFact, '1920×1080');
      assert.strictEqual(vm.aspectLabel, '16:9');
      assert.strictEqual(vm.aspectRatio, 1.778);
    });

    test('formats a duration as a clock for time-based families', function (assert) {
      let vm = fileViewModel({
        name: 'take.mp3',
        url: 'http://test.com/take.mp3',
        duration: 185,
      });
      assert.strictEqual(vm.heroFact, '3:05');
    });

    test('describes an oddly-shaped image with a ratio rather than a fraction', function (assert) {
      let vm = fileViewModel({ name: 'pano.jpg', width: 4001, height: 1000 });
      assert.strictEqual(vm.aspectLabel, '4.00:1');
    });
  });
});
