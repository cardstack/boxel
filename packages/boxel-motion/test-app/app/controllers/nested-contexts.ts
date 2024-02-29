import { Changeset } from '@cardstack/boxel-motion/models/animator';
import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';

export default class NestedContexts extends Controller {
  @tracked showLevel2 = false;
  @tracked showLevel3 = false;

  // eslint-disable-next-line @typescript-eslint/no-empty-function,@typescript-eslint/no-unused-vars
  async level1Transition(_changeset: Changeset) {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function,@typescript-eslint/no-unused-vars
  async level2Transition(_changeset: Changeset) {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function,@typescript-eslint/no-unused-vars
  async level3Transition(_changeset: Changeset) {}
}

// DO NOT DELETE: this is how TypeScript knows how to look up your controllers.
declare module '@ember/controller' {
  interface Registry {
    'nested-contexts': NestedContexts;
  }
}
