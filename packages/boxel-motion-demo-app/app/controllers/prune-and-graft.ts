import SpringBehavior from '@cardstack/boxel-motion/behaviors/spring';
import StaticBehavior from '@cardstack/boxel-motion/behaviors/static';
import TweenBehavior from '@cardstack/boxel-motion/behaviors/tween';
import { Changeset } from '@cardstack/boxel-motion/models/animator';
import { AnimationDefinition } from '@cardstack/boxel-motion/models/orchestration';
import { SpriteType } from '@cardstack/boxel-motion/models/sprite';
import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';

export default class PruneAndGraft extends Controller {
  @tracked show = true;
  @tracked ping = false;
  @tracked extra = false;

  get showExtra() {
    return this.show === false && this.extra === true;
  }

  transition(changeset: Changeset): AnimationDefinition {
    let innerNoContextRemoved = changeset.spritesFor({
      id: 'inner-no-context',
      type: SpriteType.Removed,
    });
    let extra = changeset.spritesFor({
      id: 'extra',
      type: SpriteType.Kept,
    });

    return {
      timeline: {
        type: 'parallel',
        animations: [
          ...(innerNoContextRemoved.size
            ? [
                {
                  sprites: innerNoContextRemoved,
                  properties: {
                    translateY: {
                      to: `120px`,
                    },
                  },
                  timing: {
                    behavior: new TweenBehavior(),
                    duration: 9000,
                  },
                },
              ]
            : []),
          ...(extra.size
            ? [
                {
                  sprites: extra,
                  properties: {
                    translateY: {},
                    translateX: {},
                  },
                  timing: {
                    behavior: new SpringBehavior(),
                  },
                },
                {
                  sprites: new Set(
                    [extra.values().next().value.counterpart].filter((v) => v),
                  ),
                  properties: {
                    opacity: 0,
                  },
                  timing: {
                    behavior: new StaticBehavior(),
                    duration: 9000,
                  },
                },
              ]
            : []),
        ],
      },
    };
  }
}

// DO NOT DELETE: this is how TypeScript knows how to look up your controllers.
declare module '@ember/controller' {
  interface Registry {
    'prune-and-graft': PruneAndGraft;
  }
}
