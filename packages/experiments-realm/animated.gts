import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

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
import { toLeft, toRight } from 'ember-animated/transitions/move-over';

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

  @tracked guests = 1;

  getGuestArray = () => {
    return Array.from({ length: this.guests }, (_, i) => i);
  };

  @action addGuest() {
    if (this.guests < 6) {
      this.guests++;
    }
  }
  @action removeGuest() {
    if (this.guests > 1) {
      this.guests--;
    }
  }

  <template>
    <AnimatedContainer>
      {{#animatedEach this.items use=this.transition duration=1000 as |item|}}
        <button {{on 'click' (fn this.removeItem item)}}>
          {{item}}
        </button>
      {{/animatedEach}}
    </AnimatedContainer>

    <hr />

    <div class='flex gap-xs'>
      <p>How many guests?</p>
      <IconButton
        @icon={{CircleMinus}}
        @size='small'
        @disabled={{lte this.guests 1}}
        {{on 'click' this.removeGuest}}
      />
      {{this.guests}}
      <IconButton
        @icon={{CirclePlus}}
        @size='small'
        @disabled={{gte this.guests 6}}
        {{on 'click' this.addGuest}}
      />
    </div>
    <AnimatedContainer class='flex'>
      {{#animatedEach (this.getGuestArray) use=fade}}
        <div><User /></div>
      {{/animatedEach}}
    </AnimatedContainer>

    <style scoped>
      .flex {
        display: flex;
        align-items: center;
      }
      .gap-xs {
        gap: var(--boxel-sp-xs);
      }
    </style>
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

class TransitionFadeExample extends GlimmerComponent {
  <template>
    <div class='controls'>
      <label>
        Show Message
        <input
          type='checkbox'
          checked={{this.fadeMessage}}
          {{on 'change' this.toggleFadeMessage}}
        />
      </label>
    </div>

    <div class='scenario-transitions clearfix'>
      <AnimatedContainer>
        {{#animatedIf this.fadeMessage use=this.transition}}
          <div class='message'>
            Hello
          </div>
        {{/animatedIf}}
      </AnimatedContainer>
    </div>

    <style scoped>
      .scenario-transitions {
        display: flex;
        margin-block-start: 2em;
        height: 7em;
      }
      .scenario-transitions .message {
        width: 7em;
        background-color: lightblue;
        color: white;
        font: italic bold 16px/2 cursive;
        box-sizing: border-box;
        padding: 2em;
        border-radius: 10px;
      }
      .scenario-transitions .selector {
        width: 25%;
      }
      .scenario-transitions .h1 {
        font: sans-serif;
        font-style: bold;
        background-color: blue;
      }
    </style>
  </template>

  transition = fade;

  @tracked fadeMessage = false;

  @action toggleFadeMessage() {
    this.fadeMessage = !this.fadeMessage;
  }
}

class TransitionMoveOverExample extends GlimmerComponent {
  <template>
    <div class='move-over'>
      <label>
        Show Hello
        <input
          type='checkbox'
          checked={{this.showHello}}
          {{on 'change' this.toggleShowHello}}
        />
      </label>

      <AnimatedContainer>
        {{#animatedIf this.showHello rules=this.rules}}
          <div class='hello'>
            Hello
          </div>
        {{else}}
          <div class='goodbye'>
            Goodbye
          </div>
        {{/animatedIf}}
      </AnimatedContainer>
    </div>

    <style scoped>
      .move-over {
        display: flex;
      }

      .move-over > .animated-container {
        overflow: hidden;
      }

      .move-over .hello {
        width: 7em;
        background-color: lightblue;
        color: white;
        font: italic bold 16px/2 cursive;
        box-sizing: border-box;
        padding: 2em;
      }

      .move-over .goodbye {
        width: 7em;
        background-color: darkblue;
        color: white;
        font: italic bold 16px/2 cursive;
        box-sizing: border-box;
        padding: 2em;
      }
    </style>
  </template>

  @tracked showHello = false;

  @action toggleShowHello() {
    this.showHello = !this.showHello;
  }

  rules({ newItems }: any) {
    if (newItems[0]) {
      return toRight;
    } else {
      return toLeft;
    }
  }
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
        <hr />
        <TransitionFadeExample />
        <hr />
        <TransitionMoveOverExample />
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
