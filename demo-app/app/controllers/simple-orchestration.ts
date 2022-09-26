import Controller from '@ember/controller';
import { Changeset } from 'animations-experiment/models/changeset';
import LinearBehavior from 'animations-experiment/behaviors/linear';
import SpringBehavior from 'animations-experiment/behaviors/spring';
import { AnimationDefinition } from 'animations-experiment/models/transition-runner';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

export default class SimpleOrchestration extends Controller {
  @tracked leftPosition = '0px';

  @action
  toggleMove() {
    if (this.leftPosition !== '0px') {
      this.leftPosition = '0px';
    } else {
      this.leftPosition = '500px';
    }
  }

  sequence(changeset: Changeset): AnimationDefinition {
    let { keptSprites } = changeset;

    return {
      timeline: {
        sequence: [
          {
            sprites: keptSprites,
            properties: {
              opacity: { to: 0 },
            },
            timing: {
              behavior: new LinearBehavior(),
              duration: 300,
            },
          },
          {
            sprites: keptSprites,
            properties: {
              opacity: { from: 0, to: 1 },
            },
            timing: {
              behavior: new LinearBehavior(),
              duration: 300,
            },
          },
          {
            sprites: keptSprites,
            properties: {
              position: {},
            },
            timing: {
              behavior: new SpringBehavior(),
            },
          },
        ],
      },
    } as unknown as AnimationDefinition;
  }

  parallel(changeset: Changeset): AnimationDefinition {
    let { keptSprites } = changeset;

    return {
      timeline: {
        parallel: [
          {
            sprites: keptSprites,
            properties: {
              opacity: { to: 0.5 },
            },
            timing: {
              behavior: new LinearBehavior(),
              duration: 300,
            },
          },
          {
            sprites: keptSprites,
            properties: {
              position: {},
            },
            timing: {
              behavior: new SpringBehavior(),
            },
          },
        ],
      },
    } as unknown as AnimationDefinition;
  }
}

// DO NOT DELETE: this is how TypeScript knows how to look up your controllers.
declare module '@ember/controller' {
  interface Registry {
    'simple-orchestration': SimpleOrchestration;
  }
}
