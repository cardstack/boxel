import {
  TweenBehavior,
  type AnimationDefinition,
  type Changeset,
  SpringBehavior,
} from '@cardstack/boxel-motion';
import Controller from '@ember/controller';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

export default class SimpleOrchestration extends Controller {
  @tracked leftPosition = '0px';

  @action
  toggleMove() {
    if (this.leftPosition !== '0px') {
      this.leftPosition = '0px';
    } else {
      this.leftPosition = '500px';
    }
  }

  sequence(changeset: Changeset): AnimationDefinition {
    let { keptSprites } = changeset;

    return {
      timeline: {
        type: 'sequence',
        animations: [
          {
            sprites: keptSprites,
            properties: {
              opacity: { to: 0 },
            },
            timing: {
              behavior: new TweenBehavior(),
              duration: 300,
            },
          },
          {
            sprites: keptSprites,
            properties: {
              opacity: { from: 0, to: 1 },
            },
            timing: {
              behavior: new TweenBehavior(),
              duration: 500,
            },
          },
          {
            sprites: keptSprites,
            properties: {
              translateX: {},
            },
            timing: {
              behavior: new SpringBehavior(),
            },
          },
        ],
      },
    };
  }

  parallel(changeset: Changeset): AnimationDefinition {
    let { keptSprites } = changeset;

    return {
      timeline: {
        type: 'parallel',
        animations: [
          {
            sprites: keptSprites,
            properties: {
              translateX: {},
            },
            timing: {
              behavior: new TweenBehavior(),
              duration: 2400,
            },
          },
          {
            type: 'sequence',
            animations: [
              {
                sprites: keptSprites,
                properties: {
                  opacity: { from: 1, to: 0.1 },
                },
                timing: {
                  behavior: new SpringBehavior(),
                },
              },
              {
                sprites: keptSprites,
                properties: {
                  opacity: { to: 1, from: 0.1 },
                },
                timing: {
                  behavior: new TweenBehavior(),
                  duration: 1200,
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
    'simple-orchestration': SimpleOrchestration;
  }
}
