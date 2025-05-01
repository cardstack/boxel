import {
  type AnimationTimeline,
  OrchestrationMatrix,
  Sprite,
  SpriteType,
  StaticBehavior,
  TweenBehavior,
  WaitBehavior,
} from '@cardstack/boxel-motion';
import { FPS } from '@cardstack/boxel-motion';
import { type Keyframe } from '@cardstack/boxel-motion/models';
import {
  constructKeyframe,
  type Snapshot,
} from '@cardstack/boxel-motion/utils';
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
