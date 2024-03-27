import {
  type AnimationTimeline,
  type AnimationDefinition,
} from '@cardstack/boxel-motion';
import { SpringBehavior } from '@cardstack/boxel-motion';
import { Changeset } from '@cardstack/boxel-motion/models/animator';
import Controller from '@ember/controller';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

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
  @tracked list1 = ['Michael!', 'Ed', 'Luke', 'Nick'].sort();
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
        animations: [...keptSprites].map(
          (keptSprite): AnimationTimeline => ({
            type: 'sequence',
            animations: [
              {
                sprites: new Set([keptSprite]),
                properties: {
                  translateX: {},
                  translateY: {},
                },
                timing: {
                  behavior: quickSpring,
                },
              },
              {
                sprites: new Set([keptSprite]),
                properties: {
                  width: {},
                  height: {},
                },
                timing: {
                  behavior: quickSpring,
                },
              },
            ],
          }),
        ),
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
              x: {},
              y: {},
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
