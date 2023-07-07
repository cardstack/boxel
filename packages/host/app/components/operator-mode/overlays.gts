import Component from '@glimmer/component';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { RenderedLinksToCard } from './stack-item';
import { velcro } from 'ember-velcro';
import { Actions } from '@cardstack/runtime-common';
import { IconButton } from '@cardstack/boxel-ui';
import cn from '@cardstack/boxel-ui/helpers/cn';
import { type TrackedArray } from 'tracked-built-ins';
import type { MiddlewareState } from '@floating-ui/dom';
import { type Card } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    renderedLinksToCards: RenderedLinksToCard[];
    publicAPI: Actions;
    toggleSelect?: (card: Card) => void;
    selectedCards?: TrackedArray<Card>;
  };
}

export default class OperatorModeOverlays extends Component<Signature> {
  refreshLoopStartedAt: number | null = null;
  refreshLoopTimeout: number | null = null;

  <template>
    {{#each @renderedLinksToCards as |renderedCard|}}
      {{#let renderedCard.card as |card|}}
        <div
          class={{cn 'actions-overlay' selected=(this.isSelected card.id)}}
          {{velcro renderedCard.element middleware=(Array this.offset)}}
          data-test-actions-overlay-selected={{if (this.isSelected card.id) card.id}}
        >
          <button
            {{on 'click' (fn this.openOrSelectCard card)}}
            class='overlay-button'
            aria-label='open card'
            data-test-cardstack-operator-mode-overlay-button={{card.id}}
          />
          {{#if @toggleSelect}}
            <IconButton
              {{on 'click' (fn @toggleSelect card)}}
              class='hover-button select'
              @icon={{if
                (this.isSelected card.id)
                'icon-circle-selected'
                'icon-circle'
              }}
              aria-label='select card'
              data-test-actions-overlay-select={{card.id}}
            />
          {{/if}}
          <IconButton
            class='hover-button preview'
            @icon='eye'
            aria-label='preview card'
          />
          <IconButton
            class='hover-button more-actions'
            @icon='more-actions'
            aria-label='more actions'
          />
        </div>
      {{/let}}
    {{/each}}
    <style>
      .actions-overlay {
        border-radius: var(--boxel-border-radius);
      }
      .actions-overlay:hover {
        cursor: pointer;
      }
      .actions-overlay:hover {
        box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.16);
      }
      .actions-overlay.selected {
        box-shadow: 0 0 0 2px var(--boxel-highlight);
      }
      .overlay-button {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: none;
        border: none;
        border-radius: inherit;
        padding: 0;
      }
      .hover-button {
        display: none;
        position: absolute;
        width: 30px;
        height: 30px;
      }
      .actions-overlay:hover > .hover-button:not(:disabled),
      .actions-overlay.selected > .hover-button.select {
        display: block;
      }
      .hover-button:not(:disabled):hover {
        --icon-color: var(--boxel-highlight);
        --icon-border: var(--boxel-highlight);
      }
      .hover-button.select {
        top: 0;
        right: 0;
      }
      .hover-button.preview {
        top: 0;
        left: 0;
      }
      .hover-button.more-actions {
        bottom: 0;
        right: 0;
      }
      .hover-button > svg {
        height: 100%;
      }
    </style>
  </template>

  offset = {
    name: 'offset',
    fn: (state: MiddlewareState) => {
      let { elements, rects } = state;
      let { floating, reference } = elements;
      let { width, height } = reference.getBoundingClientRect();
      
      floating.style.width = width + 'px';
      floating.style.height = height + 'px';

      return {
        x: rects.reference.x,
        y: rects.reference.y,
      };
    },
  };

  @action openOrSelectCard(card: Card) {
    if (this.args.toggleSelect && this.args.selectedCards?.length) {
      this.args.toggleSelect(card);
    } else {
      this.args.publicAPI.viewCard(card);
    }
  }

  @action isSelected(id: string) {
    return this.args.selectedCards?.some((card: any) => card.id === id);
  }

  // TODO: actions for 'preview' and 'more-actions' buttons
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    OperatorModeOverlays: typeof OperatorModeOverlays;
  }
}
