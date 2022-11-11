import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { Changeset } from '@cardstack/boxel-motion/models/animator';
import SpringBehavior from '@cardstack/boxel-motion/behaviors/spring';
import { AnimationDefinition } from '@cardstack/boxel-motion/addon/models/orchestration';

let quickSpring = new SpringBehavior({
  stiffness: 100,
  damping: 10,
  mass: 1,
  overshootClamping: false,
  allowsOverdamping: false,
  restVelocityThreshold: 0.1,
  restDisplacementThreshold: 0.1,
});

export default class List extends Controller {
  @tracked list1 = ['Michael', 'Ed', 'Luke', 'Nick'].sort();
  @tracked list2 = ['Chris', 'Alex'].sort();

  @action
  toList1(item: string) {
    this.list2 = this.list2.filter((value) => value !== item);
    this.list1 = [...this.list1, item].sort();
  }

  @action
  toList2(item: string) {
    this.list1 = this.list1.filter((value) => value !== item);
    this.list2 = [...this.list2, item].sort();
  }

  listsTransition(changeset: Changeset): AnimationDefinition {
    let { keptSprites } = changeset;

    return {
      timeline: {
        type: 'parallel',
        animations: Array.from(keptSprites).map((keptSprite) => ({
          type: 'sequence',
          animations: [
            {
              sprites: new Set([keptSprite]),
              properties: {
                position: {},
              },
              timing: {
                behavior: quickSpring,
              },
            },
            {
              sprites: new Set([keptSprite]),
              properties: {
                size: {},
              },
              timing: {
                behavior: quickSpring,
              },
            },
          ],
        })),
      },
    };
  }

  internalListTransition(changeset: Changeset): AnimationDefinition {
    let { keptSprites } = changeset;

    return {
      timeline: {
        type: 'sequence',
        animations: [
          {
            sprites: keptSprites,
            properties: {
              position: {},
            },
            timing: {
              behavior: quickSpring,
            },
          },
        ],
      },
    };
  }
}

// DO NOT DELETE: this is how TypeScript knows how to look up your controllers.
declare module '@ember/controller' {
  interface Registry {
    list: List;
  }
}
