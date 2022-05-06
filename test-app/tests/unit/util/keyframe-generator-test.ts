import { module, test } from 'qunit';
import KeyframeGenerator from 'animations-experiment/utils/keyframe-generator';

module('Unit | Util | KeyframeGenerator', function () {
  module('generate', function () {
    test('from single keyframe motion', function (assert) {
      let keyframeProviderStub = {
        keyframes: [{ opacity: '0' }, { opacity: '1' }],
        keyframeAnimationOptions: { duration: 500 },
      };
      let generator = new KeyframeGenerator([keyframeProviderStub]);
      assert.deepEqual(generator.keyframes, [
        { offset: 0, opacity: '0' },
        { offset: 1, opacity: '1' },
      ]);
      assert.deepEqual(generator.keyframeAnimationOptions, {
        duration: 500,
      });
    });
    test('two keyframe motions', function (assert) {
      let keyframeProviderStub1 = {
        keyframes: [{ opacity: '0' }, { opacity: '1' }],
        keyframeAnimationOptions: { duration: 500 },
      };
      let keyframeProviderStub2 = {
        keyframes: [{ width: '10px' }, { width: '20px' }],
        keyframeAnimationOptions: { duration: 500 },
      };
      let generator = new KeyframeGenerator([
        keyframeProviderStub1,
        keyframeProviderStub2,
      ]);
      assert.deepEqual(generator.keyframes, [
        { offset: 0, opacity: '0', width: '10px' },
        { offset: 1, opacity: '1', width: '20px' },
      ]);
      assert.deepEqual(generator.keyframeAnimationOptions, {
        duration: 500,
      });
    });
    test('two keyframe motions with 2 frames and 3 frames', function (assert) {
      let keyframeProviderStub1 = {
        keyframes: [{ opacity: '0' }, { opacity: '1' }],
        keyframeAnimationOptions: { duration: 500 },
      };
      let keyframeProviderStub2 = {
        keyframes: [{ width: '10px' }, { width: '35px' }, { width: '20px' }],
        keyframeAnimationOptions: { duration: 500 },
      };
      let generator = new KeyframeGenerator([
        keyframeProviderStub1,
        keyframeProviderStub2,
      ]);
      assert.deepEqual(generator.keyframes, [
        { offset: 0, opacity: '0', width: '10px' },
        { offset: 0.5, width: '35px' },
        { offset: 1, opacity: '1', width: '20px' },
      ]);
      assert.deepEqual(generator.keyframeAnimationOptions, {
        duration: 500,
      });
    });
    test('two keyframe motions with explicit offset values', function (assert) {
      let keyframeProviderStub1 = {
        keyframes: [
          { opacity: '0' },
          { opacity: '0', offset: 0.8 },
          { opacity: '1' },
        ],
        keyframeAnimationOptions: { duration: 500 },
      };
      let keyframeProviderStub2 = {
        keyframes: [
          { width: '10px' },
          { width: '35px', offset: 0.2 },
          { width: '20px' },
        ],
        keyframeAnimationOptions: { duration: 500 },
      };
      let generator = new KeyframeGenerator([
        keyframeProviderStub1,
        keyframeProviderStub2,
      ]);
      assert.deepEqual(generator.keyframes, [
        { offset: 0, opacity: '0', width: '10px' },
        { offset: 0.2, width: '35px' },
        { offset: 0.8, opacity: '0' },
        { offset: 1, opacity: '1', width: '20px' },
      ]);
      assert.deepEqual(generator.keyframeAnimationOptions, {
        duration: 500,
      });
    });
    test('three keyframe motions with different frame counts', function (assert) {
      let keyframeProviderStub1 = {
        keyframes: [{ opacity: '0' }, { opacity: '1' }],
        keyframeAnimationOptions: { duration: 500 },
      };
      let keyframeProviderStub2 = {
        keyframes: [{ width: '10px' }, { width: '35px' }, { width: '20px' }],
        keyframeAnimationOptions: { duration: 500 },
      };
      let keyframeProviderStub3 = {
        keyframes: [
          { transform: 'translate(0,0)' },
          { transform: 'translate(5,5)' },
          { transform: 'translate(20,0)' },
          { transform: 'translate(20,20)' },
        ],
        keyframeAnimationOptions: { duration: 500 },
      };
      let generator = new KeyframeGenerator([
        keyframeProviderStub1,
        keyframeProviderStub2,
        keyframeProviderStub3,
      ]);
      assert.deepEqual(generator.keyframes, [
        { offset: 0, opacity: '0', width: '10px', transform: 'translate(0,0)' },
        { offset: 0.33, transform: 'translate(5,5)' },
        { offset: 0.5, width: '35px' },
        { offset: 0.67, transform: 'translate(20,0)' },
        {
          offset: 1,
          opacity: '1',
          width: '20px',
          transform: 'translate(20,20)',
        },
      ]);
      assert.deepEqual(generator.keyframeAnimationOptions, {
        duration: 500,
      });
    });
    test('two keyframe motions with different durations', function (assert) {
      let keyframeProviderStub1 = {
        keyframes: [{ opacity: '0' }, { opacity: '1' }],
        keyframeAnimationOptions: { duration: 500 },
      };
      let keyframeProviderStub2 = {
        keyframes: [{ width: '10px' }, { width: '35px' }, { width: '20px' }],
        keyframeAnimationOptions: { duration: 1000 },
      };
      let generator = new KeyframeGenerator([
        keyframeProviderStub2,
        keyframeProviderStub1,
      ]);
      assert.deepEqual(generator.keyframes, [
        { offset: 0, opacity: '0', width: '10px' },
        { offset: 0.5, opacity: '1', width: '35px' },
        { offset: 1, opacity: '1', width: '20px' },
      ]);
      assert.deepEqual(generator.keyframeAnimationOptions, {
        duration: 1000,
      });
    });
    test('two keyframe motions with different durations, explicit offsets', function (assert) {
      let keyframeProviderStub1 = {
        keyframes: [
          { opacity: '0' },
          { opacity: '0.5', offset: 0.6 },
          { opacity: '0.7', offset: 0.8 },
          { opacity: '1' },
        ],
        keyframeAnimationOptions: { duration: 500 },
      };
      let keyframeProviderStub2 = {
        keyframes: [
          { width: '10px' },
          { width: '35px', offset: 0.4 },
          { width: '20px' },
        ],
        keyframeAnimationOptions: { duration: 1000 },
      };
      let generator = new KeyframeGenerator([
        keyframeProviderStub2,
        keyframeProviderStub1,
      ]);
      assert.deepEqual(generator.keyframes, [
        { offset: 0, opacity: '0', width: '10px' },
        { offset: 0.3, opacity: '0.5' },
        { offset: 0.4, width: '35px', opacity: '0.7' },
        { offset: 0.5, opacity: '1' },
        { offset: 1, opacity: '1', width: '20px' },
      ]);
      assert.deepEqual(generator.keyframeAnimationOptions, {
        duration: 1000,
      });
    });
    test('two keyframe motions with delays', function (assert) {
      let keyframeProviderStub1 = {
        keyframes: [{ opacity: '0' }, { opacity: '1' }],
        keyframeAnimationOptions: { delay: 200, duration: 500 },
      };
      let keyframeProviderStub2 = {
        keyframes: [{ width: '10px' }, { width: '35px' }, { width: '20px' }],
        keyframeAnimationOptions: { delay: 100, duration: 500 },
      };
      let generator = new KeyframeGenerator([
        keyframeProviderStub1,
        keyframeProviderStub2,
      ]);
      assert.deepEqual(generator.keyframes, [
        { offset: 0, opacity: '0', width: '10px' },
        { offset: 0.14, width: '10px' },
        { offset: 0.29, opacity: '0' },
        { offset: 0.5, width: '35px' },
        { offset: 0.86, width: '20px' },
        { offset: 1, opacity: '1', width: '20px' },
      ]);
      assert.deepEqual(generator.keyframeAnimationOptions, {
        duration: 700,
      });
    });
    test('two keyframe motions with delays, explicit offsets', function (assert) {
      let keyframeProviderStub1 = {
        keyframes: [
          { opacity: '0' },
          { opacity: '0.5', offset: 0.6 },
          { opacity: '0.7', offset: 0.8 },
          { opacity: '1' },
        ],
        keyframeAnimationOptions: { delay: 200, duration: 500 },
      };
      let keyframeProviderStub2 = {
        keyframes: [
          { width: '10px' },
          { width: '35px', offset: 0.4 },
          { width: '20px' },
        ],
        keyframeAnimationOptions: { delay: 100, duration: 500 },
      };
      let generator = new KeyframeGenerator([
        keyframeProviderStub1,
        keyframeProviderStub2,
      ]);
      assert.deepEqual(generator.keyframes, [
        { offset: 0, opacity: '0', width: '10px' },
        { offset: 0.14, width: '10px' },
        { offset: 0.29, opacity: '0' },
        { offset: 0.43, width: '35px' },
        { offset: 0.71, opacity: '0.5' },
        { offset: 0.86, width: '20px', opacity: '0.7' },
        { offset: 1, opacity: '1', width: '20px' },
      ]);
      assert.deepEqual(generator.keyframeAnimationOptions, {
        duration: 700,
      });
    });
    // conflicting easings
  });
});
