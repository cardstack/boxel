import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { TrackedArray } from 'tracked-built-ins';

import {
  AnimatedContainer,
  AnimatedBeacon,
  animatedEach,
  animatedIf,
} from 'ember-animated';
import type TransitionContext from 'ember-animated/-private/transition-context';
import { easeOut, easeIn } from 'ember-animated/easings/cosine';
import move from 'ember-animated/motions/move';
import scale from 'ember-animated/motions/scale';
import { fadeOut } from 'ember-animated/motions/opacity';
import fade from 'ember-animated/transitions/fade';

import { CardDef } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';

import { BoxelContainer, IconButton } from '@cardstack/boxel-ui/components';
import { gte, lte } from '@cardstack/boxel-ui/helpers';

import User from '@cardstack/boxel-icons/user';
import CirclePlus from '@cardstack/boxel-icons/circle-plus';
import CircleMinus from '@cardstack/boxel-icons/circle-minus';

class AnimatedBeaconExample extends GlimmerComponent {
  @tracked showThing = false;

  *transition({
    insertedSprites,
    keptSprites,
    removedSprites,
    beacons,
  }: TransitionContext) {
    for (let sprite of insertedSprites) {
      sprite.startAtSprite(beacons.one);
      move(sprite);
      scale(sprite);
    }

    for (let sprite of keptSprites) {
      move(sprite);
    }

    for (let sprite of removedSprites) {
      sprite.endAtSprite(beacons.one);
      move(sprite);
      scale(sprite);
    }
  }

  launch = () => {
    this.showThing = true;
  };

  dismiss = () => {
    this.showThing = false;
  };

  <template>
    <AnimatedContainer>
      <AnimatedBeacon @name='one'>
        <button {{on 'click' this.launch}}>Launch</button>
      </AnimatedBeacon>

      {{#animatedIf this.showThing use=this.transition}}
        <div class='message' {{on 'click' this.dismiss}}>
          Hello
        </div>
      {{/animatedIf}}
    </AnimatedContainer>
  </template>
}

class AnimatedEachExample extends GlimmerComponent {
  @tracked items = ['A', 'B', 'C', 'D', 'E'];
  removeItem = (item: string) => {
    this.items = this.items.filter((i) => i !== item);
  };
  *transition({ keptSprites, removedSprites }: TransitionContext) {
    for (let sprite of keptSprites) {
      move(sprite);
    }
    for (let sprite of removedSprites) {
      fadeOut(sprite);
    }
  }

  guests = new TrackedArray([{ icon: User, id: 1 }]);
  addGuest = () => {
    if (this.guests?.length < 6) {
      this.guests.push({ icon: User, id: this.guests.length + 1 });
    }
  };
  removeGuest = () => {
    if (this.guests?.length > 1) {
      this.guests.pop();
    }
  };

  <template>
    <AnimatedContainer>
      {{#animatedEach this.items use=this.transition duration=1000 as |item|}}
        <button {{on 'click' (fn this.removeItem item)}}>
          {{item}}
        </button>
      {{/animatedEach}}
    </AnimatedContainer>

    <hr />

    <BoxelContainer @display='flex'>
      <p>How many guests?</p>
      <IconButton
        @icon={{CircleMinus}}
        @size='small'
        @disabled={{lte this.guests.length 1}}
        {{on 'click' this.removeGuest}}
      />
      {{this.guests.length}}
      <IconButton
        @icon={{CirclePlus}}
        @size='small'
        @disabled={{gte this.guests.length 6}}
        {{on 'click' this.addGuest}}
      />
    </BoxelContainer>
    <AnimatedContainer>
      {{#animatedEach this.guests key='id' use=fade as |Guest|}}
        <Guest.icon />
      {{/animatedEach}}
    </AnimatedContainer>
  </template>
}

class AnimatedIfExample extends GlimmerComponent {
  @tracked showThing = false;

  toggleThing = () => {
    this.showThing = !this.showThing;
  };

  *transition({
    insertedSprites,
    keptSprites,
    removedSprites,
  }: TransitionContext) {
    for (let sprite of insertedSprites) {
      sprite.startAtPixel({ x: window.innerWidth });
      yield move(sprite, { easing: easeOut });
    }

    for (let sprite of keptSprites) {
      yield move(sprite);
    }

    for (let sprite of removedSprites) {
      sprite.endAtPixel({ x: window.innerWidth });
      yield move(sprite, { easing: easeIn });
    }
  }

  <template>
    <div>
      <button {{on 'click' this.toggleThing}}>Toggle</button>
      <AnimatedContainer>
        {{#animatedIf this.showThing use=this.transition}}
          <div class='message' {{on 'click' this.toggleThing}} role='button'>
            myContent
          </div>
        {{/animatedIf}}
      </AnimatedContainer>
    </div>
  </template>
}

export class Animated extends CardDef {
  static displayName = 'animated';

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <BoxelContainer @display='grid'>
        <AnimatedEachExample />
        <hr />
        <AnimatedIfExample />
        <hr />
        <AnimatedBeaconExample />
      </BoxelContainer>

      <style scoped>
        :deep(hr) {
          display: block;
          width: 100%;
        }
      </style>
    </template>
  };
}
