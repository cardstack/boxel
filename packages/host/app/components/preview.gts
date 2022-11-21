import Component from '@glimmer/component';
import AnimationContext from '@cardstack/boxel-motion/components/animation-context';
import sprite from '@cardstack/boxel-motion/modifiers/sprite';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
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

function a(thing: any){ return [thing] }

export default class Preview extends Component<Signature> {
  <template>
    <button {{on 'click' this.toggle}}>Toggle</button>
    <AnimationContext @use={{this.transition}} >
      {{#each (a this.renderedCard) as |Rc|}}
        <div {{sprite id="first"}} >
          <Rc />
        </div>
      {{/each}}
    </AnimationContext>
  </template>

  toggle = () => this.mode = !this.mode;
  @tracked mode = true;

  transition = (changeset: Changeset): AnimationDefinition => {
    return {
      timeline: {
        type: 'parallel',
        animations: [
          {
            sprites: changeset.keptSprites,
            properties: {
              size: {}
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
