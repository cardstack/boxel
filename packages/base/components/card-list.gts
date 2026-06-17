import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import { consume } from 'ember-provide-consume-context';
import { modifier } from 'ember-modifier';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';

import FileIcon from '@cardstack/boxel-icons/file';

import { cn, eq } from '@cardstack/boxel-ui/helpers';

import {
  isValidPrerenderedHtmlFormat,
  removeFileExtension,
  rri,
  searchEntryWireQueryFromQuery,
  CardCrudFunctionsContextName,
  CardContextName,
  type Query,
  type RenderableSearchEntryLike,
  type SearchEntryWireQuery,
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

type CardComponentModifier = NonNullable<CardContext['cardComponentModifier']>;

// Cast: a function-based no-op stands in for the class-based tracking
// modifier so applying it is always type-safe even when no context provides
// a real one.
const noopCardModifier = modifier(
  () => undefined,
) as unknown as CardComponentModifier;

export default class CardList extends Component<Signature> {
  @consume(CardCrudFunctionsContextName)
  declare cardCrudFunctions: CardCrudFunctions | undefined;

  @consume(CardContextName)
  declare cardContext: CardContext | undefined;

  // The v2 `search-entry`-rooted query, adapted from the incoming v1 `Query`.
  // The default fieldset (no `fields` member) resolves to "html, falling back
  // to the `item` serialization where no rendering matched" — exactly what the
  // grid wants (prerendered HTML for cards; an `item`/`icon` fallback for file
  // rows). `@format` binds the prerendered format through the query's
  // `htmlQuery` (the v2 way to select it); CardsGrid passes `fitted`, which
  // matches the default, so this is behavior-preserving there while keeping a
  // non-`fitted` caller working. Only read under `{{#if @query}}`.
  private get searchResultsQuery(): SearchEntryWireQuery {
    let query = searchEntryWireQueryFromQuery(this.args.query!);
    if (!isValidPrerenderedHtmlFormat(this.args.format)) {
      return { ...query, realms: this.args.realms };
    }
    return {
      ...query,
      realms: this.args.realms,
      filter: {
        ...query.filter,
        eq: {
          ...query.filter?.eq,
          htmlQuery: { eq: { format: this.args.format } },
        },
      },
    };
  }

  // Tracks the fallback row with the overlay system. Falls back to a no-op
  // when no context provides one (e.g. CardList used outside operator mode),
  // so applying the modifier is always safe.
  private get cardComponentModifier(): CardComponentModifier {
    return this.cardContext?.cardComponentModifier ?? noopCardModifier;
  }

  // Only fallback rows are tracked on the <li> (their visible card is the
  // <li> itself). HTML / live rows render through `<entry.component />`
  // (`HydratableCard`), which tracks its own element with the overlay, so
  // tracking the <li> too would double-register them — hence the no-op there.
  private trackerFor = (
    entry: RenderableSearchEntryLike,
  ): CardComponentModifier =>
    this.shouldRenderFallback(entry)
      ? this.cardComponentModifier
      : noopCardModifier;

  @action
  handleCardClick(cardUrl: string, event?: Event) {
    if (this.cardCrudFunctions?.viewCard) {
      event?.preventDefault();
      this.cardCrudFunctions.viewCard(rri(cardUrl));
    }
  }

  // Last URL segment, used as a visible label for a file row the prerender
  // pipeline produced no HTML for (`.gts`/`.ts` FileDef rows skip the
  // FileRender pass, so they carry no `html` rendering and fall back to a
  // `file-meta` `item`).
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

  // Render the cheap icon + filename placeholder for a file row that has no
  // prerendered HTML — it fell back to a `file-meta` `item`. Rendering
  // `<entry.component />` for such a row would eagerly load the live `FileDef`
  // instance; the placeholder shows the type icon + name (resolved from the
  // deduped `icon` resource on the entry) without that load. Error rows and
  // no-HTML *card* rows are excluded: the former render their error affordance,
  // the latter resolve live (self-healing) through `<entry.component />`.
  shouldRenderFallback(entry: RenderableSearchEntryLike): boolean {
    return (
      !entry.html && entry.item?.type === 'file-meta' && !entry.isError
    );
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
        <@context.searchResultsComponent
          @query={{this.searchResultsQuery}}
          @mode='none'
          as |results|
        >
          {{#each results.entries key='id' as |entry|}}
            <li
              class={{cn
                'boxel-card-list-item'
                instance-error=entry.isError
                clickable=(if this.cardCrudFunctions.viewCard true false)
                fallback=(this.shouldRenderFallback entry)
              }}
              data-test-instance-error={{entry.isError}}
              data-test-cards-grid-item={{removeFileExtension entry.id}}
              {{! In order to support scrolling cards into view we use a selector that is not pruned out in production builds }}
              data-cards-grid-item={{removeFileExtension entry.id}}
              data-card-type-display-name={{if
                (this.shouldRenderFallback entry)
                entry.displayName
              }}
              data-card-type-icon-html={{if
                (this.shouldRenderFallback entry)
                entry.iconHtml
              }}
              role={{if this.cardCrudFunctions.viewCard 'button'}}
              tabindex={{if this.cardCrudFunctions.viewCard '0'}}
              {{on 'click' (fn this.handleCardClick entry.id)}}
              {{(this.trackerFor entry)
                cardId=entry.id
                format='data'
                fieldType=undefined
                fieldName=undefined
              }}
            >
              {{#if (this.shouldRenderFallback entry)}}
                {{! A file row with no prerendered HTML (currently `.gts`/`.ts`
                    FileDef rows) — render the type icon + name so the row is
                    visible and the click handler on this `<li>` can still route
                    into interact-mode (and from there into Code Mode), without
                    eagerly loading the live FileDef. The icon + name come from
                    the entry's deduped `icon` resource. The <li> carries the
                    tracking modifier + type attributes (see trackerFor) so the
                    overlay labels and acts on these rows, aligned to the card.
                    Error rows and no-HTML card rows are excluded — they render
                    through `<entry.component />`. }}
                <div class='card-fallback' data-test-card-fallback>
                  {{#if entry.iconHtml}}
                    <span
                      class='card-fallback__icon card-fallback__icon--svg'
                    >{{htmlSafe entry.iconHtml}}</span>
                  {{else}}
                    <FileIcon class='card-fallback__icon' role='presentation' />
                  {{/if}}
                  <div class='card-fallback__name'>
                    {{this.fileNameFromUrl entry.id}}
                  </div>
                </div>
              {{else}}
                <entry.component />
              {{/if}}
            </li>
          {{else}}
            {{#if results.isLoading}}
              <div class='loading-container'>
                <LoadingIndicator />
              </div>
            {{else}}
              <p>No results were found</p>
            {{/if}}
          {{/each}}
        </@context.searchResultsComponent>
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
      .card-fallback__icon--svg {
        display: inline-flex;
      }
      .card-fallback__icon--svg > svg {
        width: 100%;
        height: 100%;
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
