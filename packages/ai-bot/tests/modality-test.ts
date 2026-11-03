import QUnit from 'qunit';
const { module, test, assert } = QUnit;
import {
  requiredModality,
  modalityLabel,
  isImageContentType,
  isPdfContentType,
  isAudioContentType,
  isVideoContentType,
  isTextBasedContentType,
  isSvgTooLargeForText,
  formatKilobytes,
  MAX_SVG_TEXT_BYTES,
} from '@cardstack/runtime-common/ai/modality';

module('modality helpers', () => {
  test('requiredModality maps image MIME types to image', () => {
    assert.strictEqual(requiredModality('image/png'), 'image');
    assert.strictEqual(requiredModality('image/jpeg'), 'image');
    assert.strictEqual(requiredModality('image/webp'), 'image');
    assert.strictEqual(requiredModality('image/gif'), 'image');
  });

  test('requiredModality maps PDF to file', () => {
    assert.strictEqual(requiredModality('application/pdf'), 'file');
  });

  test('requiredModality maps audio MIME types to audio', () => {
    assert.strictEqual(requiredModality('audio/mpeg'), 'audio');
    assert.strictEqual(requiredModality('audio/wav'), 'audio');
    assert.strictEqual(requiredModality('audio/ogg'), 'audio');
    assert.strictEqual(requiredModality('audio/flac'), 'audio');
    assert.strictEqual(requiredModality('audio/mp4'), 'audio');
  });

  test('requiredModality maps video MIME types to video', () => {
    assert.strictEqual(requiredModality('video/mp4'), 'video');
    assert.strictEqual(requiredModality('video/mpeg'), 'video');
    assert.strictEqual(requiredModality('video/quicktime'), 'video');
    assert.strictEqual(requiredModality('video/webm'), 'video');
  });

  test('requiredModality returns undefined for non-multimodal types', () => {
    assert.strictEqual(requiredModality('text/plain'), undefined);
    assert.strictEqual(requiredModality('application/json'), undefined);
    assert.strictEqual(requiredModality('application/octet-stream'), undefined);
    assert.strictEqual(requiredModality('image/svg+xml'), undefined);
    assert.strictEqual(requiredModality(undefined), undefined);
  });

  test('modalityLabel returns human-readable labels', () => {
    assert.strictEqual(modalityLabel('image'), 'image files');
    assert.strictEqual(modalityLabel('file'), 'PDF files');
    assert.strictEqual(modalityLabel('audio'), 'audio files');
    assert.strictEqual(modalityLabel('video'), 'video files');
  });

  test('isImageContentType correctly identifies image types', () => {
    assert.true(isImageContentType('image/png'));
    assert.true(isImageContentType('image/jpeg'));
    assert.false(isImageContentType('audio/mpeg'));
    assert.false(isImageContentType(undefined));
  });

  test('isPdfContentType correctly identifies PDF', () => {
    assert.true(isPdfContentType('application/pdf'));
    assert.false(isPdfContentType('application/json'));
    assert.false(isPdfContentType(undefined));
  });

  test('isAudioContentType correctly identifies audio types', () => {
    assert.true(isAudioContentType('audio/mpeg'));
    assert.true(isAudioContentType('audio/wav'));
    assert.false(isAudioContentType('video/mp4'));
    assert.false(isAudioContentType(undefined));
  });

  test('isVideoContentType correctly identifies video types', () => {
    assert.true(isVideoContentType('video/mp4'));
    assert.true(isVideoContentType('video/webm'));
    assert.false(isVideoContentType('audio/mpeg'));
    assert.false(isVideoContentType(undefined));
  });

  test('isTextBasedContentType identifies text and card JSON types', () => {
    assert.true(isTextBasedContentType('text/plain'));
    assert.true(isTextBasedContentType('text/typescript'));
    assert.true(isTextBasedContentType('text/html'));
    assert.true(isTextBasedContentType('text/typescript+glimmer'));
    assert.true(isTextBasedContentType('application/vnd.card+json'));
    assert.true(isTextBasedContentType('application/vnd.card+source'));
    assert.true(isTextBasedContentType('image/svg+xml'));
    assert.false(isTextBasedContentType('application/json'));
    assert.false(
      isTextBasedContentType(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
    );
    assert.false(isTextBasedContentType('application/zip'));
    assert.false(isTextBasedContentType(undefined));
  });

  test('isSvgTooLargeForText judges an SVG by its bytes, or its declared size', () => {
    let svg = 'image/svg+xml';
    assert.false(
      isSvgTooLargeForText({
        contentType: svg,
        contentSize: MAX_SVG_TEXT_BYTES,
      }),
      'at the limit it is sent',
    );
    assert.true(
      isSvgTooLargeForText({
        contentType: svg,
        contentSize: MAX_SVG_TEXT_BYTES + 1,
      }),
      'over the declared limit it is not',
    );
    assert.false(
      isSvgTooLargeForText({ contentType: svg }),
      'with no declared size only the download can tell',
    );
    assert.true(
      isSvgTooLargeForText({ contentType: svg }, MAX_SVG_TEXT_BYTES + 1),
      'the downloaded bytes decide when given',
    );
    assert.false(
      isSvgTooLargeForText({
        contentType: 'text/plain',
        contentSize: MAX_SVG_TEXT_BYTES * 4,
      }),
      'only an SVG has the limit',
    );
  });

  test('formatKilobytes rounds up to whole KB', () => {
    assert.strictEqual(formatKilobytes(MAX_SVG_TEXT_BYTES), '256 KB');
    assert.strictEqual(formatKilobytes(MAX_SVG_TEXT_BYTES + 1), '257 KB');
  });
});
