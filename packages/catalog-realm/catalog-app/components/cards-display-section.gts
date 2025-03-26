import GlimmerComponent from '@glimmer/component';
import { CardDef } from 'https://cardstack.com/base/card-api';
import type { Format, CardContext } from 'https://cardstack.com/base/card-api';
import { CardContainer } from '@cardstack/boxel-ui/components';

interface CardListArgs {
  Args: {
    cards?: CardDef[];
    format: Format;
    context?: CardContext;
  };
  Blocks: {};
  Element: HTMLElement;
}

class CardList extends GlimmerComponent<CardListArgs> {
  <template>
    <ul class='card-list' ...attributes>
      {{#each @cards as |card|}}
        <li class='card'>
          {{#let (this.getComponent card) as |Component|}}
            <CardContainer
              {{@context.cardComponentModifier
                cardId=card.id
                format='data'
                fieldType=undefined
                fieldName=undefined
              }}
            >
              <Component @format={{@format}} />
            </CardContainer>
          {{/let}}
        </li>
      {{/each}}
    </ul>
    <style scoped>
      .cards {
        display: grid;
        grid-template-columns: repeat(
          auto-fill,
          minmax(var(--grid-card-min-width), var(--grid-card-max-width))
        );
        grid-auto-rows: var(--grid-card-height);
        gap: var(--boxel-sp);
        list-style-type: none;
        padding: 0;
        margin-top: var(--boxel-sp-lg);
      }
      .card {
        height: auto;
        max-width: 100%;
        background-color: var(--boxel-300);
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--boxel-border-radius);
      }
    </style>
  </template>

  getComponent = (card: CardDef) => card.constructor.getComponent(card);
}

interface CardSectionArgs {
  Args: {
    title?: string;
    description?: string;
    cards?: CardDef[];
    context?: CardContext;
  };
  Blocks: {
    intro?: []; // we can choose to use this to pass instead of using args.title if the title block HTML is complex
    content?: []; // we can choose use this to pass instead of using args.content if the content block HTML is complex
  };
  Element: HTMLElement;
}

// Priotize using block intro instead of using args.title / description if both are provided
export default class CardsDisplaySection extends GlimmerComponent<CardSectionArgs> {
  <template>
    <section class='cards-display-section' ...attributes>
      {{#if (has-block 'intro')}}
        {{yield to='intro'}}
      {{else}}
        {{#if @title}}
          <h2>{{@title}}</h2>
        {{/if}}
        {{#if @description}}
          <p>{{@description}}</p>
        {{/if}}
      {{/if}}

      {{#if (has-block 'content')}}
        {{yield to='content'}}
      {{else}}
        <CardList @cards={{@cards}} @format='fitted' @context={{@context}} />
      {{/if}}
    </section>
    <style scoped>
      @layer {
        .cards-display-section {
          --grid-card-min-width: 10.625rem; /* 170px */
          --grid-card-max-width: 10.625rem; /* 170px */
          --grid-card-height: 10.625rem; /* 170px */
        }
        h2,
        p {
          margin-block: 0;
          margin-bottom: var(--boxel-sp);
        }
      }
    </style>
  </template>
}
