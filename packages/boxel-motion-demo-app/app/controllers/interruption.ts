import SpringBehavior from '@cardstack/boxel-motion/behaviors/spring';
import TweenBehavior from '@cardstack/boxel-motion/behaviors/tween';
import { Changeset } from '@cardstack/boxel-motion/models/animator';
import { AnimationDefinition } from '@cardstack/boxel-motion/models/orchestration';
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
