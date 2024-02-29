import {
  type AnimationDefinition,
  type Changeset,
  TweenBehavior,
} from '@cardstack/boxel-motion';
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
              behavior: new TweenBehavior(),
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
