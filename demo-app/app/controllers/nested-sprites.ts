import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import { Changeset } from 'animations-experiment/models/changeset';
import magicMove from 'animations-experiment/transitions/magic-move';
import runAnimations from 'animations-experiment/utils/run-animations';

export default class NestedSprites extends Controller {
  @tracked moveOuter = false;
  @tracked moveInner = true;

  async transition(changeset: Changeset) {
    magicMove(changeset, { duration: 5000 });
    await runAnimations([...changeset.keptSprites]);
  }
}

// DO NOT DELETE: this is how TypeScript knows how to look up your controllers.
declare module '@ember/controller' {
  interface Registry {
    'nested-sprites': NestedSprites;
  }
}
