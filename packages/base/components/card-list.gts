import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import { consume } from 'ember-provide-consume-context';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';

import FileIcon from '@cardstack/boxel-icons/file';

import { cn, eq } from '@cardstack/boxel-ui/helpers';

import {
  removeFileExtension,
  rri,
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
  handleCardClick(cardUrl: string, event?: Event) {
    if (this.cardCrudFunctions?.viewCard) {
      event?.preventDefault();
      this.cardCrudFunctions.viewCard(rri(cardUrl));
    }
  }

  // Last URL segment, used as a visible label when the prerender pipeline
  // didn't produce HTML for a file row (CS-11171 — `.gts`/`.ts` FileDef rows
  // currently skip the FileRender pass, so their `fitted_html` is null and
  // `<card.component />` renders nothing).
  fileNameFromUrl(url: string): string {
    try {
      let pathname = new URL(url).pathname;
      let segment = pathname.split('/').filter(Boolean).pop();
      return segment ?? url;
    } catch {
      let segments = url.split('/').filter(Boolean);
      return segments[segments.length - 1] ?? url;
    }
  }

  // Render the filename fallback only when the prerender pipeline produced
  // no HTML AND the row is not an error. Error rows have their own
  // dedicated error component built by PrerenderedCard's constructor, which
  // also has empty `html`; treating them like file fallbacks would swap a
  // helpful "rendering error" affordance for a bare filename.
  shouldRenderFallback(card: {
    hasHtml?: boolean;
    isError?: boolean;
  }): boolean {
    return card.hasHtml === false && !card.isError;
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
                  fallback=(this.shouldRenderFallback card)
                }}
                data-test-instance-error={{card.isError}}
                data-test-cards-grid-item={{removeFileExtension card.url}}
                {{! In order to support scrolling cards into view we use a selector that is not pruned out in production builds }}
                data-cards-grid-item={{removeFileExtension card.url}}
                role={{if this.cardCrudFunctions.viewCard 'button'}}
                tabindex={{if this.cardCrudFunctions.viewCard '0'}}
                {{on 'click' (fn this.handleCardClick card.url)}}
              >
                {{#if (this.shouldRenderFallback card)}}
                  {{! CS-11171: file rows whose prerender produced no HTML
                      (currently `.gts`/`.ts` FileDef rows) — render a name
                      so the row is at least visible and the click handler on
                      this `<li>` can still route the user into interact-mode
                      (and from there into Code Mode via the kebab menu).
                      Error rows are excluded so PrerenderedCard's dedicated
                      error component still gets rendered for them. }}
                  <div class='card-fallback' data-test-card-fallback>
                    <FileIcon class='card-fallback__icon' role='presentation' />
                    <div class='card-fallback__name'>
                      {{this.fileNameFromUrl card.url}}
                    </div>
                  </div>
                {{else}}
                  <card.component />
                {{/if}}
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
      .boxel-card-list-item.fallback {
        background-color: var(--boxel-100);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-xs);
        align-items: center;
        justify-content: flex-start;
      }
      .card-fallback {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-xs);
        width: 100%;
        height: 100%;
        overflow: hidden;
        text-align: center;
      }
      .card-fallback__icon {
        width: 2rem;
        height: 2rem;
        color: var(--boxel-500);
        flex-shrink: 0;
      }
      .card-fallback__name {
        font: 500 var(--boxel-font-sm);
        color: var(--boxel-dark);
        word-break: break-word;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
      }
      .strip-view .card-fallback {
        flex-direction: row;
        justify-content: flex-start;
        text-align: left;
      }
      .strip-view .card-fallback__icon {
        width: 1.5rem;
        height: 1.5rem;
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
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 50vh;
      }
    </style>
  </template>
}
