import Component from '@glimmer/component';

import {
  CardContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';

import { cn, eq, not } from '@cardstack/boxel-ui/helpers';

import {
  removeFileExtension,
  type PrerenderedCardComponentSignature,
} from '@cardstack/runtime-common';

import type { CardContext, BoxComponent, Format } from '../card-api';

interface Signature {
  Args: {
    context?: CardContext;
    cards?: BoxComponent & BoxComponent[];
    format?: Format;
    prerenderedCardSearchQuery?: PrerenderedCardComponentSignature['Args'];
    viewOption?: string;
    hideOverlay?: boolean;
    hideCardContainer?: boolean;
  };
  Blocks: { cards: [] };
  Element: HTMLElement;
}

export default class CardList extends Component<Signature> {
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
      {{#if @prerenderedCardSearchQuery}}
        <@context.prerenderedCardSearchComponent
          @query={{@prerenderedCardSearchQuery.query}}
          @format={{@prerenderedCardSearchQuery.format}}
          @realms={{@prerenderedCardSearchQuery.realms}}
          @isLive={{@prerenderedCardSearchQuery.isLive}}
        >
          <:loading>
            <LoadingIndicator />
          </:loading>
          <:response as |cards|>
            {{#each cards key='url' as |card|}}
              <li
                class={{cn 'boxel-card-list-item' instance-error=card.isError}}
                data-test-instance-error={{card.isError}}
                data-test-cards-grid-item={{removeFileExtension card.url}}
                {{! In order to support scrolling cards into view we use a selector that is not pruned out in production builds }}
                data-cards-grid-item={{removeFileExtension card.url}}
              >
                {{#if @hideOverlay}}
                  <CardContainer
                    class='boxel-{{@prerenderedCardSearchQuery.format}}-card'
                    @displayBoundaries={{not @hideCardContainer}}
                  >
                    <card.component />
                  </CardContainer>
                {{else}}
                  <CardContainer
                    {{@context.cardComponentModifier
                      cardId=card.url
                      format='data'
                      fieldType=undefined
                      fieldName=undefined
                    }}
                    class='boxel-{{@prerenderedCardSearchQuery.format}}-card'
                    @displayBoundaries={{not @hideCardContainer}}
                  >
                    <card.component />
                  </CardContainer>
                {{/if}}
              </li>
            {{else}}
              <p>No results were found</p>
            {{/each}}
          </:response>
        </@context.prerenderedCardSearchComponent>
      {{else if (has-block 'cards')}}
        {{yield to='cards'}}
      {{/if}}
    </ul>

    <style scoped>
      .boxel-card-list {
        --padding: var(--boxel-card-list-padding, var(--boxel-sp));

        display: grid;
        align-content: start;
        gap: var(--boxel-sp);
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
        grid-template-columns: repeat(auto-fill, minmax(49%, 1fr));
      }
      .card-view {
        --item-height: auto;
      }
      :deep(.boxel-card-list-item) {
        max-width: 100%;
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp) var(--boxel-sp-lg);
        width: var(--item-width);
        height: var(--item-height);
      }
      :deep(.boxel-card-list-item > .boxel-fitted-card),
      :deep(.boxel-card-list-item > .field-component-card.boxel-fitted-card) {
        container-name: fitted-card;
        container-type: size;
        height: 100%;
        width: 100%;
      }
      :deep(.boxel-card-list-item > .boxel-atom-card),
      :deep(.boxel-card-list-item > .field-component-card.boxel-atom-card) {
        width: fit-content;
        max-width: 100%;
      }
      :deep(.boxel-card-list-item > .boxel-embedded-card),
      :deep(.boxel-card-list-item > .field-component-card.boxel-embedded-card) {
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
    </style>
  </template>
}
