import { module, test, assert } from 'qunit';
import {
  requiredModality,
  modalityLabel,
  isImageContentType,
  isPdfContentType,
  isAudioContentType,
  isVideoContentType,
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
});
