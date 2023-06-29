import Component from '@glimmer/component';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { RenderedLinksToCard } from './stack-item';
import { velcro } from 'ember-velcro';
import { Actions } from '@cardstack/runtime-common';

interface Signature {
  Args: {
    renderedLinksToCards: RenderedLinksToCard[];
    publicAPI: Actions;
  };
}

export default class OperatorModeOverlays extends Component<Signature> {
  refreshLoopStartedAt: number | null = null;
  refreshLoopTimeout: number | null = null;

  <template>
    {{#each @renderedLinksToCards as |renderedCard|}}
      <button
        {{on 'click' (fn @publicAPI.viewCard renderedCard.card)}}
        class='button'
        data-test-cardstack-operator-mode-overlay-button
        {{velcro renderedCard.element middleware=(Array this.offset)}}
      >
        Open
      </button>
    {{/each}}
    <style>
      .button { position: absolute; border: none; width: auto; }
    </style>
  </template>

  offset = {
    name: 'offset',
    fn: (state: any) => {
      let rects = state.rects;
      return {
        x: rects.reference.x + rects.reference.width - rects.floating.width,
        y: rects.reference.y,
      };
    },
  };
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    OperatorModeOverlays: typeof OperatorModeOverlays;
  }
}
