import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import Changeset from '../models/changeset';
import magicMove from '../transitions/magic-move';
import runAnimations from 'animations/utils/run-animations';
import SpringBehavior from 'animations/behaviors/spring';

class InterruptionController extends Controller {
  @tracked ballGoWhere = 'A';
  animationOriginPosition: DOMRect | null = null;

  async transition(changeset: Changeset): Promise<void> {
    magicMove(changeset, {
      behavior: new SpringBehavior({ overshootClamping: true, damping: 100 }),
    });

    await runAnimations([...changeset.keptSprites]);
  }
}

export default InterruptionController;
