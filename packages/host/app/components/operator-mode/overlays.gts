import Component from '@glimmer/component';
import { fn } from '@ember/helper';
import { Card } from 'https://cardstack.com/base/card-api';
import { on } from '@ember/modifier';
import { StackItem } from './container';
import { RenderedLinksToCard } from './stack-item';
import { action } from '@ember/object';
import { velcro } from 'ember-velcro';

interface Signature {
  Args: {
    renderedLinksToCards: RenderedLinksToCard[];
    addToStack: (stackItem: StackItem) => void;
  };
}

export default class OperatorModeOverlays extends Component<Signature> {
  refreshLoopStartedAt: number | null = null;
  refreshLoopTimeout: number | null = null;

  <template>
    {{#each @renderedLinksToCards as |renderedCard|}}
      <button
        {{on 'click' (fn this.addToStack renderedCard.card)}}
        class='button'
        data-test-cardstack-operator-mode-overlay-button
        {{velcro renderedCard.element middleware=(Array this.offset)}}
      >
        Open
      </button>
    {{/each}}
    <style>
      .button {
        position: absolute;
        border: none;
        width: auto;
      }
    </style>
  </template>

  @action addToStack(card: Card) {
    this.args.addToStack({
      card,
      format: 'isolated',
    });
  }

  offset = {
    name: 'offset',
    fn: (state: any) => {
      let rects = state.rects;
      return {x: rects.reference.x + rects.reference.width - rects.floating.width, y: rects.reference.y};
   }
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    OperatorModeOverlays: typeof OperatorModeOverlays;
  }
}
