import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  DEFAULT_AUDIO_SIZE_LIMIT_BYTES,
  DEFAULT_FILE_SIZE_LIMIT_BYTES,
  DEFAULT_VIDEO_SIZE_LIMIT_BYTES,
  fileSizeLimitFor,
  isBinaryFilename,
} from '@cardstack/runtime-common';

const LIMITS = { default: 100, audio: 200, video: 300 };

module(basename(import.meta.filename), function () {
  test('audio extensions get the audio limit', function (assert) {
    for (let path of [
      'sounds/theme.mp3',
      'sounds/theme.m4a',
      'sounds/theme.wav',
      'sounds/theme.flac',
      'sounds/theme.oga',
      'sounds/theme.aac',
      'SOUNDS/THEME.MP3',
    ]) {
      assert.strictEqual(fileSizeLimitFor(path, LIMITS), 200, path);
    }
  });

  test('video extensions get the video limit', function (assert) {
    for (let path of [
      'clips/intro.mp4',
      'clips/intro.mov',
      'clips/intro.webm',
      'clips/intro.avi',
      'clips/intro.ogv',
      'CLIPS/INTRO.MP4',
    ]) {
      assert.strictEqual(fileSizeLimitFor(path, LIMITS), 300, path);
    }
  });

  test('everything else gets the default file limit', function (assert) {
    for (let path of [
      'card.gts',
      'card.json',
      'image.png',
      'doc.pdf',
      'font.woff2',
      'notes.txt',
      'LICENSE',
      'archive.tar.gz',
    ]) {
      assert.strictEqual(fileSizeLimitFor(path, LIMITS), 100, path);
    }
  });

  test('.ts is TypeScript, not an MPEG transport stream', function (assert) {
    // A bare mime-types lookup resolves `.ts` to video/mp2t, which would hand
    // every module in a realm the video ceiling.
    assert.strictEqual(fileSizeLimitFor('card.ts', LIMITS), 100);
  });

  test('query strings and fragments do not mask the extension', function (assert) {
    assert.strictEqual(fileSizeLimitFor('theme.mp3?v=2', LIMITS), 200);
    assert.strictEqual(fileSizeLimitFor('intro.mp4#t=10', LIMITS), 300);
  });

  test('full URLs resolve the same as bare paths', function (assert) {
    assert.strictEqual(
      fileSizeLimitFor('http://localhost:4201/test/theme.mp3', LIMITS),
      200,
    );
    assert.strictEqual(
      fileSizeLimitFor('http://localhost:4201/test/card.gts', LIMITS),
      100,
    );
  });

  test('anything granted a media ceiling is carried as bytes', function (assert) {
    // A media ceiling is only meaningful for content that reaches the realm
    // intact. Callers that read a file before uploading it pick text vs bytes
    // from `isBinaryFilename`, so a path sized as media and read as text would
    // be UTF-8 mangled on the way in — and the larger ceiling would let the
    // mangled bytes through instead of rejecting them.
    for (let path of [
      'sounds/theme.mp3',
      'sounds/theme.m4a',
      'sounds/theme.wav',
      'clips/intro.mp4',
      'clips/intro.mov',
      'clips/intro.webm',
      'clips/intro.mkv',
    ]) {
      assert.notStrictEqual(
        fileSizeLimitFor(path, LIMITS),
        LIMITS.default,
        `${path} gets a media ceiling`,
      );
      assert.true(isBinaryFilename(path), `${path} is carried as bytes`);
    }
  });

  test('media ceilings exceed the general file ceiling', function (assert) {
    assert.true(DEFAULT_AUDIO_SIZE_LIMIT_BYTES > DEFAULT_FILE_SIZE_LIMIT_BYTES);
    assert.true(
      DEFAULT_VIDEO_SIZE_LIMIT_BYTES > DEFAULT_AUDIO_SIZE_LIMIT_BYTES,
    );
  });
});
