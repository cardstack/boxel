import Component from '@glimmer/component';

// import { type CardContext } from 'https://cardstack.com/base/card-api';
// import { type Format } from '@cardstack/runtime-common';
import cn from '../../helpers/cn.ts';
import CardContainer from '../card-container/index.gts';
import LoadingIndicator from '../loading-indicator/index.gts';

interface Signature {
  Args: {
    context: any; // CardContext
    // model?: Partial<CardDef>;
    // cardTypeDisplayName?: string;
    // fittedDisplayOption?: 'grid' | 'list';
    format: any; // Format
    isLive?: boolean;
    query: any;
    realms: URL[];
    // hideOverlay?: boolean;
    // hideContainer?: boolean;
  };
  Element: HTMLElement;
}

function removeFileExtension(cardUrl: string) {
  return cardUrl.replace(/\.[^/.]+$/, '');
}

export default class CardList extends Component<Signature> {
  <template>
    <ul class='boxel-card-list' ...attributes>
      <@context.prerenderedCardSearchComponent
        @query={{@query}}
        @format={{@format}}
        @realms={{@realms}}
        @isLive={{@isLive}}
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
              <CardContainer
                {{@context.cardComponentModifier
                  cardId=card.url
                  format='data'
                  fieldType=undefined
                  fieldName=undefined
                }}
                class='boxel-{{@format}}-card'
                @displayBoundaries={{true}}
              >
                <card.component />
              </CardContainer>
            </li>
          {{else}}
            <p>No results were found</p>
          {{/each}}
        </:response>
      </@context.prerenderedCardSearchComponent>
    </ul>

    <style scoped>
      .boxel-card-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, 170px);
        gap: var(--boxel-sp);
        list-style-type: none;
        margin-block: 0;
        padding: var(--boxel-sp);
      }
      .boxel-card-list-item {
        max-width: 100%;
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp) var(--boxel-sp-lg);
        width: 170px;
        height: 250px;
      }
      .boxel-fitted-card {
        container-name: fitted-card;
        container-type: size;
      }
      .boxel-atom-card {
        width: fit-content;
        max-width: 100%;
      }
      .boxel-embedded-card {
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
