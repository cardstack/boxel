import LinearBehavior from '@cardstack/boxel-motion/behaviors/linear';
import { Changeset } from '@cardstack/boxel-motion/models/animator';
import { AnimationDefinition } from '@cardstack/boxel-motion/models/orchestration';
import Controller from '@ember/controller';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

export default class DoubleRenderController extends Controller {
  @tracked count = 0;
  @tracked isShowing = true;

  @action
  hide() {
    this.isShowing = false;
  }

  @action
  show() {
    this.isShowing = true;
  }

  @action
  increment() {
    this.count += 1;
  }

  transition(changeset: Changeset): AnimationDefinition {
    let { removedSprites, keptSprites, insertedSprites } = changeset;
    let duration = 3000;

    let timing = {
      behavior: new LinearBehavior(),
      duration,
    };

    return {
      timeline: {
        type: 'parallel',
        animations: [
          {
            sprites: removedSprites,
            properties: {
              position: {
                startY: 0,
                startX: 0,
                endY: -200,
                endX: 0,
              },
            },
            timing,
          },
          {
            sprites: insertedSprites,
            properties: {
              position: {
                startY: -200,
              },
            },
            timing,
          },
          {
            sprites: keptSprites,
            properties: {
              position: {},
            },
            timing,
          },
        ],
      },
    } as AnimationDefinition;
  }
}
