import {
  type AnimationDefinition,
  type Changeset,
  SpringBehavior,
  TweenBehavior,
} from '@cardstack/boxel-motion';
import Controller from '@ember/controller';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

export default class InOut extends Controller {
  @tracked show = true;

  @action
  toggle() {
    this.show = !this.show;
  }

  transition(changeset: Changeset): AnimationDefinition {
    let { keptSprites, insertedSprites, removedSprites } = changeset;

    return {
      timeline: {
        type: 'sequence',
        animations: [
          {
            type: 'parallel',
            animations: [
              {
                sprites: insertedSprites,
                properties: {
                  translateY: { from: '100px' },
                },
                timing: {
                  behavior: new SpringBehavior(),
                },
              },
              {
                sprites: insertedSprites,
                properties: {
                  opacity: { from: 0 },
                },
                timing: {
                  behavior: new TweenBehavior(),
                  duration: 300,
                },
              },
            ],
          },
          {
            sprites: keptSprites,
            properties: {
              translateY: {},
              opacity: {},
            },
            timing: {
              behavior: new TweenBehavior(),
              duration: 300,
            },
          },
          {
            type: 'parallel',
            animations: [
              {
                sprites: removedSprites,
                properties: {
                  translateY: { to: '100px' },
                },
                timing: {
                  behavior: new SpringBehavior(),
                },
              },
              {
                sprites: removedSprites,
                properties: {
                  opacity: { to: 0 },
                },
                timing: {
                  behavior: new TweenBehavior(),
                  duration: 300,
                },
              },
            ],
          },
        ],
      },
    };
  }
}

// DO NOT DELETE: this is how TypeScript knows how to look up your controllers.
declare module '@ember/controller' {
  interface Registry {
    'in-out': InOut;
  }
}
