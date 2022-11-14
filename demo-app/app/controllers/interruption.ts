import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import { Changeset } from '@cardstack/boxel-motion/models/animator';
import { AnimationDefinition } from '@cardstack/boxel-motion/models/orchestration';
import SpringBehavior from '@cardstack/boxel-motion/behaviors/spring';

class InterruptionController extends Controller {
  @tracked ballGoWhere = 'A';
  animationOriginPosition: DOMRect | null = null;

  ballIds = [...new Array(1)].map((_, id) => id);

  transition(changeset: Changeset): AnimationDefinition {
    let { keptSprites } = changeset;

    return {
      timeline: {
        type: 'sequence',
        animations: [
          {
            sprites: keptSprites,
            properties: {
              position: {},
              size: {},
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
