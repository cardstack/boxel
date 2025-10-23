import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import { consume } from 'ember-provide-consume-context';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';

import { cn, eq } from '@cardstack/boxel-ui/helpers';

import {
  removeFileExtension,
  CardCrudFunctionsContextName,
  type Query,
} from '@cardstack/runtime-common';

import type {
  CardContext,
  BoxComponent,
  Format,
  CardCrudFunctions,
} from '../card-api';

interface Signature {
  Args: {
    context?: CardContext;
    query?: Query;
    realms: string[];
    isLive?: boolean;
    format: Format;
    cards?: BoxComponent[];
    viewOption?: string;
  };
  Element: HTMLElement;
}

export default class CardList extends Component<Signature> {
  @consume(CardCrudFunctionsContextName)
  declare cardCrudFunctions: CardCrudFunctions | undefined;

  @action
  handleCardClick(cardUrl: string) {
    if (this.cardCrudFunctions?.viewCard) {
      this.cardCrudFunctions.viewCard(new URL(cardUrl));
    }
  }

  <template>
    <ul
      class={{cn
        'boxel-card-list'
        grid-view=(eq @viewOption 'grid')
        strip-view=(eq @viewOption 'strip')
        card-view=(eq @viewOption 'card')
      }}
      ...attributes
    >
      {{#if @query}}
        <@context.prerenderedCardSearchComponent
          @query={{@query}}
          @format={{@format}}
          @realms={{@realms}}
          @isLive={{@isLive}}
        >
          <:loading>
            <div class='loading-container'>
              <LoadingIndicator />
            </div>
          </:loading>
          <:response as |cards|>
            {{#each cards key='url' as |card|}}
              <li
                class={{cn
                  'boxel-card-list-item'
                  instance-error=card.isError
                  clickable=(if this.cardCrudFunctions.viewCard true false)
                }}
                data-test-instance-error={{card.isError}}
                data-test-cards-grid-item={{removeFileExtension card.url}}
                {{! In order to support scrolling cards into view we use a selector that is not pruned out in production builds }}
                data-cards-grid-item={{removeFileExtension card.url}}
                {{on 'click' (fn this.handleCardClick card.url)}}
              >
                <card.component />
              </li>
            {{else}}
              <p>No results were found</p>
            {{/each}}
          </:response>
        </@context.prerenderedCardSearchComponent>
      {{else if @cards}}
        {{#each @cards key='id' as |Card|}}
          <li class='boxel-card-list-item'>
            <Card @format={{@format}} class='card-item {{@format}}-card-item' />
          </li>
        {{/each}}
      {{/if}}
    </ul>

    <style scoped>
      .boxel-card-list {
        --padding: var(--boxel-card-list-padding, var(--boxel-sp));
        --gap: var(--boxel-card-list-gap, var(--boxel-sp));

        display: grid;
        align-content: start;
        gap: var(--gap);
        list-style-type: none;
        margin-block: 0;
        padding: var(--padding);
      }
      .grid-view {
        --item-width: 10.625rem; /* 170px */
        --item-height: 15.625rem; /* 250px */
        grid-template-columns: repeat(auto-fill, var(--item-width));
      }
      .strip-view {
        --item-height: 6.563rem; /* 105px; */
        grid-template-columns: repeat(
          auto-fill,
          minmax(calc(50% - var(--gap) / 2), 1fr)
        );
      }
      .card-view {
        --item-height: auto;
      }
      .boxel-card-list-item {
        max-width: 100%;
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp) var(--boxel-sp-lg);
        width: var(--item-width);
        height: var(--item-height);
      }
      .boxel-card-list-item.clickable {
        cursor: pointer;
      }

      .boxel-card-list-item > :deep(.field-component-card.embedded-format) {
        width: 100%;
        height: auto;
        max-width: var(--embedded-card-max-width);
        min-height: var(--embedded-card-min-height);
      }
      .instance-error {
        position: relative;
      }
      .instance-error::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(255, 0, 0, 0.1);
      }
      .instance-error .boundaries {
        box-shadow: 0 0 0 1px var(--boxel-error-300);
      }
      .instance-error:hover .boundaries {
        box-shadow: 0 0 0 1px var(--boxel-dark);
      }
      .loading-container {
        grid-column: 1 / -1;
        justify-content: center;
        min-height: 50vh;
      }
    </style>
  </template>
}
