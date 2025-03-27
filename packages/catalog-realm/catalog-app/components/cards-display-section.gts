import GlimmerComponent from '@glimmer/component';
import { CardDef } from 'https://cardstack.com/base/card-api';
import type { CardContext } from 'https://cardstack.com/base/card-api';

type SelectedView = 'grid' | 'strip' | undefined;

interface CardsIntancesGridArgs {
  Args: {
    cards?: CardDef[];
    context?: CardContext;
    selectedView?: SelectedView;
  };
  Blocks: {};
  Element: HTMLElement;
}

// This is only make for common grid/strip view, means we not need to pass extra format args, it strictly use fitted-format
// This is different from the CardsGrid component, which is just display links to Many Components without using prerendersearch
export class CardsIntancesGrid extends GlimmerComponent<CardsIntancesGridArgs> {
  get view() {
    return this.args.selectedView || 'grid';
  }

  <template>
    <ul class='cards {{this.view}}-view' ...attributes>
      {{#each @cards key='url' as |card|}}
        {{#let (this.getComponent card) as |CardComponent|}}
          <li
            class='{{this.view}}-view-container'
            {{@context.cardComponentModifier
              cardId=card.id
              format='data'
              fieldType=undefined
              fieldName=undefined
            }}
          >
            <CardComponent />
          </li>
        {{/let}}
      {{/each}}
    </ul>
    <style scoped>
      .cards {
        --default-grid-view-min-width: 224px;
        --default-grid-view-max-width: 1fr;
        --default-grid-view-height: 360px;
        --default-strip-view-min-width: 49%;
        --default-strip-view-max-width: 1fr;
        --default-strip-view-height: 180px;

        display: grid;
        gap: var(--boxel-sp);
        list-style-type: none;
        margin: 0;
        padding: var(--boxel-sp-6xs);
      }

      .cards.strip-view {
        grid-template-columns: repeat(
          auto-fill,
          minmax(
            var(--strip-view-min-width, var(--default-strip-view-min-width)),
            var(--strip-view-max-width, var(--default-strip-view-max-width))
          )
        );
        grid-auto-rows: var(
          --strip-view-height,
          var(--default-strip-view-height)
        );
      }

      .cards.grid-view {
        grid-template-columns: repeat(
          auto-fill,
          minmax(
            var(--grid-view-min-width, var(--default-grid-view-min-width)),
            var(--grid-view-max-width, var(--default-grid-view-max-width))
          )
        );
        grid-auto-rows: var(
          --grid-view-height,
          var(--default-grid-view-height)
        );
      }

      .cards :deep(.field-component-card.fitted-format) {
        height: 100%;
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
    selectedView?: SelectedView; // strip or grid
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
        <CardsIntancesGrid
          @cards={{@cards}}
          @selectedView={{@selectedView}}
          @context={{@context}}
        />
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
