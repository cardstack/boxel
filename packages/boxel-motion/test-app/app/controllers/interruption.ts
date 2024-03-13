import {
  SpringBehavior,
  TweenBehavior,
  type AnimationDefinition,
  type Changeset,
} from '@cardstack/boxel-motion';
import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';

class InterruptionController extends Controller {
  @tracked ballGoWhere = 'A';

  ballIds = [...new Array(1)].map((_, id) => id);

  transition(changeset: Changeset): AnimationDefinition {
    let { keptSprites } = changeset;

    return {
      timeline: {
        type: 'parallel',
        animations: [
          {
            sprites: keptSprites,
            properties: {
              translateX: {},
              translateY: {},
              width: {},
              height: {},
            },
            timing: {
              behavior: new SpringBehavior(),
            },
          },
          {
            sprites: keptSprites,
            properties: {
              border: {},
              backgroundColor: {},
            },
            timing: {
              behavior: new TweenBehavior(),
              duration: 300,
            },
          },
        ],
      },
    };
  }
}

export default InterruptionController;
