import {
  type AnimationDefinition,
  type Changeset,
  TweenBehavior,
} from '@cardstack/boxel-motion';
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
      behavior: new TweenBehavior(),
      duration,
    };

    return {
      timeline: {
        type: 'parallel',
        animations: [
          {
            sprites: removedSprites,
            properties: {
              x: {
                from: '0px',
                to: '0px',
              },
              y: {
                from: '0px',
                to: '-200px',
              },
            },
            timing,
          },
          {
            sprites: insertedSprites,
            properties: {
              y: {
                from: '-200px',
              },
            },
            timing,
          },
          {
            sprites: keptSprites,
            properties: {
              x: {},
              y: {},
            },
            timing,
          },
        ],
      },
    } as AnimationDefinition;
  }
}
