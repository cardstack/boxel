import LinearBehavior from '@cardstack/boxel-motion/behaviors/linear';
import { Changeset } from '@cardstack/boxel-motion/models/animator';
import { AnimationDefinition } from '@cardstack/boxel-motion/models/orchestration';
import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';

export default class NestedSprites extends Controller {
  @tracked moveOuter = false;
  @tracked moveInner = true;

  transition(changeset: Changeset): AnimationDefinition {
    let { keptSprites } = changeset;

    return {
      timeline: {
        type: 'sequence',
        animations: [
          {
            sprites: keptSprites,
            properties: {
              x: {},
              y: {},
            },
            timing: {
              behavior: new LinearBehavior(),
              duration: 5000,
            },
          },
        ],
      },
    };
  }
}

// DO NOT DELETE: this is how TypeScript knows how to look up your controllers.
declare module '@ember/controller' {
  interface Registry {
    'nested-sprites': NestedSprites;
  }
}
