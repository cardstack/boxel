import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import { Orchestrator } from 'animations-experiment/services/animations';
import { Changeset } from 'animations-experiment/models/changeset';
import runAnimations from 'animations-experiment/utils/run-animations';
import LinearBehavior from 'animations-experiment/behaviors/linear';

export default class NestedSprites extends Controller {
  @tracked move = false;

  async transition(changeset: Changeset, orchestrator: Orchestrator) {
    orchestrator.setTimingForContext(changeset.context, {
      match: 'inner',
      delay: 1500,
      duration: 500,
    });

    for (let sprite of changeset.keptSprites) {
      orchestrator.animate(changeset.context, sprite, 'position', {
        behavior: new LinearBehavior(),
        duration: 5000,
      });
    }
    await runAnimations([...changeset.keptSprites]);
  }

  async innerTransition(changeset: Changeset, orchestrator: Orchestrator) {
    for (let sprite of changeset.keptSprites) {
      orchestrator.animate(changeset.context, sprite, 'position', {
        behavior: new LinearBehavior(),
        duration: 500,
      });
    }
    await runAnimations([...changeset.keptSprites]);
  }
}

// DO NOT DELETE: this is how TypeScript knows how to look up your controllers.
declare module '@ember/controller' {
  interface Registry {
    'nested-sprites': NestedSprites;
  }
}
