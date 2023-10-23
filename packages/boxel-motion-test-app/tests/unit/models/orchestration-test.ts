import { FPS } from '@cardstack/boxel-motion/behaviors/base';
import StaticBehavior from '@cardstack/boxel-motion/behaviors/static';
import TweenBehavior from '@cardstack/boxel-motion/behaviors/tween';
import WaitBehavior from '@cardstack/boxel-motion/behaviors/wait';
import {
  AnimationTimeline,
  OrchestrationMatrix,
} from '@cardstack/boxel-motion/models/orchestration';
import Sprite, { SpriteType } from '@cardstack/boxel-motion/models/sprite';
import { constructKeyframe } from '@cardstack/boxel-motion/models/transition-runner';
import { Snapshot } from '@cardstack/boxel-motion/utils/measurement';
import { Keyframe } from '@cardstack/boxel-motion/value';
import { module, test } from 'qunit';

function getMockSprite() {
  return new Sprite(
    document.createElement('div'),
    {
      id: 'my-sprite',
      role: null,
    },
    {
      initial: {} as Snapshot,
      final: {} as Snapshot,
    },
    SpriteType.Kept,
    {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      onAnimationStart() {},
    },
  );
}

module('Unit | Orchestration', function () {
  test('it generates keyframes', function (assert) {
    let sprite = getMockSprite();
    let timeline: AnimationTimeline = {
      type: 'sequence',
      animations: [
        {
          sprites: new Set([sprite]),
          properties: {},
          timing: {
            behavior: new WaitBehavior(),
            duration: 3 / FPS,
          },
        },
      ],
    };
    let orchestrationMatrix = OrchestrationMatrix.from(timeline);

    assert.deepEqual(
      orchestrationMatrix.getKeyframes(constructKeyframe),
      new Map([[sprite, [{}, {}, {}, {}]]]),
    );
  });

  test('it backfills keyframes in sequences', function (assert) {
    let sprite = getMockSprite();
    let sprites = new Set([sprite]);
    let timeline: AnimationTimeline = {
      type: 'sequence',
      animations: [
        {
          sprites,
          properties: {},
          timing: {
            behavior: new WaitBehavior(),
            duration: 3 / FPS,
          },
        },
        {
          sprites,
          properties: {
            width: {
              from: '10px',
              to: '20px',
            },
          },
          timing: {
            behavior: new TweenBehavior(),
            duration: 3 / FPS,
          },
        },
      ],
    };
    let orchestrationMatrix = OrchestrationMatrix.from(timeline);

    assert.deepEqual(
      orchestrationMatrix.getKeyframes(constructKeyframe),
      new Map([
        [
          sprite,
          [
            { width: '10px' },
            { width: '10px' },
            { width: '10px' },
            { width: '10px' },
            { width: '10px' },
            { width: '13.333333333333332px' },
            { width: '16.666666666666664px' },
            { width: '20px' },
          ],
        ],
      ]),
    );
  });

  test('it forward fills keyframes in sequences', function (assert) {
    let sprite = getMockSprite();
    let sprites = new Set([sprite]);
    let timeline: AnimationTimeline = {
      type: 'sequence',
      animations: [
        {
          sprites,
          properties: {
            width: {
              from: '10px',
              to: '20px',
            },
          },
          timing: {
            behavior: new TweenBehavior(),
            duration: 3 / FPS,
          },
        },
        {
          sprites,
          properties: {},
          timing: {
            behavior: new WaitBehavior(),
            duration: 3 / FPS,
          },
        },
      ],
    };
    let orchestrationMatrix = OrchestrationMatrix.from(timeline);

    assert.deepEqual(
      orchestrationMatrix.getKeyframes(constructKeyframe),
      new Map([
        [
          sprite,
          [
            { width: '10px' },
            { width: '13.333333333333332px' },
            { width: '16.666666666666664px' },
            { width: '20px' },
            { width: '20px' },
            { width: '20px' },
            { width: '20px' },
            { width: '20px' },
          ],
        ],
      ]),
    );
  });

  test('it does not back/forward-fill StaticBehavior frames', function (assert) {
    let sprite = getMockSprite();
    let sprites = new Set([sprite]);
    let timeline: AnimationTimeline = {
      type: 'sequence',
      animations: [
        {
          sprites,
          properties: {},
          timing: {
            behavior: new WaitBehavior(),
            duration: 3 / FPS,
          },
        },
        {
          sprites,
          properties: {
            zIndex: '123',
          },
          timing: {
            behavior: new StaticBehavior(),
            duration: 3 / FPS,
          },
        },
        {
          sprites,
          properties: {},
          timing: {
            behavior: new WaitBehavior(),
            duration: 3 / FPS,
          },
        },
      ],
    };
    let orchestrationMatrix = OrchestrationMatrix.from(timeline);
    assert.deepEqual(
      orchestrationMatrix.getKeyframes(constructKeyframe),
      new Map([
        [
          sprite,
          [
            {},
            {},
            {},
            {},
            { zIndex: '123' },
            { zIndex: '123' },
            { zIndex: '123' },
            { zIndex: '123' },
            {},
            {},
            {},
            {},
          ] as Keyframe[],
        ],
      ]),
    );
  });

  test('it generates keyframes based on nested timelines', function (assert) {
    let sprite = getMockSprite();
    let sprites = new Set([sprite]);
    let timeline: AnimationTimeline = {
      type: 'sequence',
      animations: [
        {
          sprites,
          properties: {},
          timing: {
            behavior: new WaitBehavior(),
            duration: 3 / FPS,
          },
        },
        {
          type: 'parallel',
          animations: [
            {
              sprites,
              properties: {
                opacity: { from: 0, to: 1 },
              },
              timing: {
                behavior: new TweenBehavior(),
                duration: 3 / FPS,
              },
            },
            {
              sprites,
              properties: {
                zIndex: 4,
              },
              timing: {
                behavior: new StaticBehavior(),
                duration: 1 / FPS,
              },
            },
          ],
        },
        {
          sprites,
          properties: {
            zIndex: 3,
          },
          timing: {
            behavior: new StaticBehavior(),
            duration: 3 / FPS,
          },
        },
      ],
    };
    let orchestrationMatrix = OrchestrationMatrix.from(timeline);

    assert.deepEqual(
      orchestrationMatrix.getKeyframes(constructKeyframe),
      new Map([
        [
          sprite,
          [
            {
              opacity: 0,
            },
            {
              opacity: 0,
            },
            {
              opacity: 0,
            },
            {
              opacity: 0,
            },
            {
              opacity: 0,
              zIndex: 4,
            },
            {
              opacity: 0.3333333333333333,
              zIndex: 4,
            },
            {
              opacity: 0.6666666666666666,
            },
            {
              opacity: 1,
            },
            {
              opacity: 1,
              zIndex: 3,
            },
            {
              opacity: 1,
              zIndex: 3,
            },
            {
              opacity: 1,
              zIndex: 3,
            },
            {
              opacity: 1,
              zIndex: 3,
            },
          ] as Keyframe[],
        ],
      ]),
    );
  });
});
