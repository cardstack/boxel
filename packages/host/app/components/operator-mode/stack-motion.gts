import { registerDestructor } from '@ember/destroyable';
import { array } from '@ember/helper';
import type Owner from '@ember/owner';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { Choreo, type Sprite } from 'glimmer-motion';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    // Tests can exercise real motion without slowing every host test down.
    duration?: number;
  };
  Blocks: { default: [] };
}

const ease = [0.25, 0.1, 0.25, 1];
const restingOpacity = (sprite: Sprite) =>
  sprite.element.hasAttribute('data-stack-covered') ? 0 : 1;

// Keep the region outside individual stacks so closing the last card in a
// stack still has a living owner for its exit animation.
export default class StackMotion extends Component<Signature> {
  @tracked private reducedMotion = false;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    let preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = preference.matches;
    let update = () => (this.reducedMotion = preference.matches);
    preference.addEventListener('change', update);
    registerDestructor(this, () =>
      preference.removeEventListener('change', update),
    );
  }

  private get duration() {
    if (this.reducedMotion) {
      return 0;
    }
    return this.args.duration ?? (isTesting() ? 0 : 0.2);
  }

  <template>
    <Choreo ...attributes as |c|>
      {{yield}}
      <c.Parallel>
        <c.Tween
          @of={{c.inserted 'opening-card'}}
          @scale={{array 0.1 1}}
          @opacity={{array 0 1}}
          @duration={{this.duration}}
          @ease={{ease}}
        />
        <c.Tween
          @of={{array (c.removed 'opening-card') (c.removed 'stack-card')}}
          @opacity={{0}}
          @y='100%'
          @duration={{this.duration}}
          @ease={{ease}}
        />
        {{! A content resize can replace an entry tween with a kept-card run.
        Move owns layout scaleX/scaleY; explicitly finish the entry's separate
        scale and opacity channels instead of leaving their interrupted values. }}
        <c.Tween
          @of={{array (c.kept 'opening-card') (c.kept 'stack-card')}}
          @scale={{1}}
          @opacity={{restingOpacity}}
          @duration={{this.duration}}
          @ease={{ease}}
        />
        <c.Move
          @of={{array (c.kept 'opening-card') (c.kept 'stack-card')}}
          @size='scale'
          @duration={{this.duration}}
          @ease={{ease}}
        />
      </c.Parallel>
    </Choreo>
  </template>
}
