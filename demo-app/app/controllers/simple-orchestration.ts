import Controller from '@ember/controller';
import {
  Changeset,
  UnallocatedItems,
} from 'animations-experiment/models/changeset';
import LinearBehavior from 'animations-experiment/behaviors/linear';
import SpringBehavior from 'animations-experiment/behaviors/spring';
import { AnimationDefinition } from 'animations-experiment/models/transition-runner';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import Sprite from 'animations-experiment/models/sprite';
import { UseWithRules } from 'animations-experiment/addon/models/sprite-tree';

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

  use: UseWithRules = {
    rules: [
      {
        match: (unallocatedItems: UnallocatedItems[]) => {
          let remaining: UnallocatedItems[] = [];
          let claimed: AnimationDefinition[] = [];
          for (let item of unallocatedItems) {
            let { sprite } = item;
            if (sprite.id === 'foo11') {
              claimed.push(this.sequence(new Set([sprite])));
            } else {
              remaining.push(item);
            }
          }

          return {
            remaining,
            claimed,
          };
        },
      },
      {
        match: (unallocatedItems: UnallocatedItems[]) => {
          let remaining: UnallocatedItems[] = [];
          let claimed: AnimationDefinition[] = [];
          for (let item of unallocatedItems) {
            let { sprite } = item;
            if (sprite.id === 'foo12') {
              claimed.push(this.parallel(new Set([sprite])));
            } else {
              remaining.push(item);
            }
          }

          return {
            remaining,
            claimed,
          };
        },
      },
    ],
    handleRemainder: (changeset: Changeset) => {
      let { keptSprites } = changeset;
      return this.sequence(keptSprites);
    },
  };

  sequence(sprites: Set<Sprite>): AnimationDefinition {
    return {
      timeline: {
        sequence: [
          {
            sprites,
            properties: {
              opacity: { to: 0 },
            },
            timing: {
              behavior: new LinearBehavior(),
              duration: 300,
            },
          },
          {
            sprites,
            properties: {
              opacity: { from: 0, to: 1 },
            },
            timing: {
              behavior: new LinearBehavior(),
              duration: 500,
            },
          },
          {
            sprites,
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

  parallel(sprites: Set<Sprite>): AnimationDefinition {
    return {
      timeline: {
        parallel: [
          {
            sprites: sprites,
            properties: {
              position: {},
            },
            timing: {
              behavior: new LinearBehavior(),
              duration: 2400,
            },
          },
          {
            sequence: [
              {
                sprites: sprites,
                properties: {
                  opacity: { from: 1, to: 0.1 },
                },
                timing: {
                  behavior: new SpringBehavior(),
                },
              },
              {
                sprites: sprites,
                properties: {
                  opacity: { to: 1, from: 0.1 },
                },
                timing: {
                  behavior: new LinearBehavior(),
                  duration: 1200,
                },
              },
            ],
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
