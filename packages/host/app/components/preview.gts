import Component from '@glimmer/component';
import AnimationContext from '@cardstack/boxel-motion/components/animation-context';
import sprite from '@cardstack/boxel-motion/modifiers/sprite';
import SpringBehavior from '@cardstack/boxel-motion/behaviors/spring';
import type { Changeset } from '@cardstack/boxel-motion/models/animator';
import type { AnimationDefinition } from '@cardstack/boxel-motion/models/orchestration';
import type { Card, Format } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    card: Card;
    format?: Format;
  }
}

export default class Preview extends Component<Signature> {
  <template>
    <AnimationContext @use={{this.transition}} >
      <div {{sprite id="first"}} >
        <this.renderedCard/>
      </div>
    </AnimationContext>
  </template>

  transition = (changeset: Changeset): AnimationDefinition => {
    return {
      timeline: {
        type: 'parallel',
        animations: [
          {
            sprites: changeset.keptSprites,
            properties: {
              height: {},
              width: {},
            },
            timing: {
              behavior: new SpringBehavior()
            }
          }
        ]
      }
    }
  }

  get renderedCard() {
    return this.args.card.constructor.getComponent(this.args.card, this.args.format ?? 'isolated');
  }
}
