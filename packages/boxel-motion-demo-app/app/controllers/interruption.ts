import SpringBehavior from '@cardstack/boxel-motion/behaviors/spring';
import { Changeset } from '@cardstack/boxel-motion/models/animator';
import { AnimationDefinition } from '@cardstack/boxel-motion/models/orchestration';
import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';

class InterruptionController extends Controller {
  @tracked ballGoWhere = 'A';
  animationOriginPosition: DOMRect | null = null;

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
        ],
      },
    };
  }
}

export default InterruptionController;
