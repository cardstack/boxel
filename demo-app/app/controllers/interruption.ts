import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import { Changeset } from 'animations-experiment/models/changeset';
import magicMove from 'animations-experiment/transitions/magic-move';
import runAnimations from 'animations-experiment/utils/run-animations';
import SpringBehavior from 'animations-experiment/behaviors/spring';

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
