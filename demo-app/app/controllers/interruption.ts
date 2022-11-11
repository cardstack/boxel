import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import { Changeset } from '@cardstack/boxel-motion/models/animator';
import magicMove from '@cardstack/boxel-motion/transitions/magic-move';
import runAnimations from '@cardstack/boxel-motion/utils/run-animations';
import SpringBehavior from '@cardstack/boxel-motion/behaviors/spring';

class InterruptionController extends Controller {
  @tracked ballGoWhere = 'A';
  animationOriginPosition: DOMRect | null = null;

  ballIds = [...new Array(1)].map((_, id) => id);

  async transition(changeset: Changeset): Promise<void> {
    magicMove(changeset, {
      behavior: new SpringBehavior({ overshootClamping: false, damping: 11 }),
    });

    await runAnimations([...changeset.keptSprites]);
  }
}

export default InterruptionController;
