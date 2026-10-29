import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { Button } from '@cardstack/pretui/components/button';

import {
  resolveRRIReference,
  rri,
  trimJsonExtension,
  type RenderableSearchEntryLike,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

import SearchResults from '@cardstack/host/components/search/search-results';
import {
  getSearchEntriesResource,
  type SearchEntriesResource,
} from '@cardstack/host/resources/search-entries';
import type NetworkService from '@cardstack/host/services/network';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  LISTING_FIELDS,
  STORY_COUNT,
  linkedIds,
  storiesFrom,
  type ListingEntry,
  type Story,
} from './catalog-stories';
import fitPage from './fit-page';

// A story's art is the listing's example card, laid out as a page this many
// design pixels wide and zoomed into the frame.
const ART_PAGE_WIDTH_PX = 1000;

// Listings fetched to follow the featured ones: enough to fill the shelf once
// any without a thumbnail drop out.
const OTHER_LISTINGS_FETCHED = 12;

// One stand-in per story the shelf holds a place for.
const PENDING_STORIES = Array.from({ length: STORY_COUNT }, (_, i) => i);

const LISTING_TYPE = {
  module: rri('@cardstack/catalog/catalog-app/listing/listing'),
  name: 'Listing',
};

// Each catalog's last answered stories, kept while a changed query is out and
// across shelves, so the shelf doesn't blink, and a shelf shown again (as when
// Hosted is switched off) starts from them. Untracked: it only remembers.
const lastAnswers = new Map<string, Story[]>();

interface Signature {
  Element: HTMLElement;
  Args: {
    // The catalog realm whose index card curates the shelf.
    realmURL: string;
  };
}

// The catalog told as stories: four tinted cards, each a listing with its
// example card as art. The catalog's index card names the listings that
// lead (`featured`); other listings follow. Everything comes from the index:
// sparse-fieldset searches for the listings and prerendered HTML for the
// art, so no catalog card code loads on the dashboard.
export default class CatalogShelf extends Component<Signature> {
  @service declare private network: NetworkService;
  @service declare private operatorModeStateService: OperatorModeStateService;

  // Search results and links name cards by URL, by prefix-form identifier,
  // or relative to the card that links them; comparing them needs one form.
  private resolve = (link: string, base: string) => {
    try {
      return this.network.virtualNetwork.toURL(
        resolveRRIReference(link, rri(base)),
      ).href;
    } catch {
      return link;
    }
  };

  private toListingEntry = (entry: {
    id: string;
    item?: ListingEntry['item'];
  }): ListingEntry => ({
    id: this.resolve(trimJsonExtension(entry.id), this.args.realmURL),
    item: entry.item,
  });

  private index = getSearchEntriesResource(
    this,
    (): SearchEntryWireQuery => ({
      realms: [this.args.realmURL],
      cardUrls: [`${this.args.realmURL}index.json`],
      scope: 'cards',
      fields: { entry: ['item.featured'] },
    }),
  );

  @cached
  private get featuredIds(): string[] {
    let index = this.index.entries[0];
    return index
      ? linkedIds(this.toListingEntry(index), 'featured', this.resolve)
      : [];
  }

  @cached
  private get featuredCardUrls(): string[] {
    return this.featuredIds.map((id) => `${id}.json`);
  }

  private featured = getSearchEntriesResource(
    this,
    (): SearchEntryWireQuery | undefined =>
      this.featuredCardUrls.length
        ? {
            realms: [this.args.realmURL],
            cardUrls: this.featuredCardUrls,
            scope: 'cards',
            fields: { entry: LISTING_FIELDS },
          }
        : undefined,
  );

  private others = getSearchEntriesResource(
    this,
    (): SearchEntryWireQuery => ({
      realms: [this.args.realmURL],
      filter: { 'item.on': LISTING_TYPE },
      page: { number: 0, size: OTHER_LISTINGS_FETCHED },
      scope: 'cards',
      fields: { entry: LISTING_FIELDS },
    }),
  );

  // Whether every search has answered for what it asks now. The featured
  // listings are asked for only once the index card answers, so without this
  // the other listings would fill the shelf first and then reshuffle.
  private get isAnswered() {
    let answered = (resource: SearchEntriesResource) =>
      resource.entriesQuery !== undefined || resource.errors !== undefined;
    if (!answered(this.index) || !answered(this.others)) {
      return false;
    }
    let wanted = this.featuredCardUrls;
    if (
      wanted.length === 0 ||
      (this.featured.errors && !this.featured.isLoading)
    ) {
      return true;
    }
    let asked = this.featured.entriesQuery?.cardUrls ?? [];
    return (
      asked.length === wanted.length &&
      wanted.every((url, i) => asked[i] === url)
    );
  }

  @cached
  private get stories(): Story[] {
    if (!this.isAnswered) {
      return lastAnswers.get(this.args.realmURL) ?? [];
    }
    let stories = storiesFrom({
      featuredIds: this.featuredIds,
      featured: this.featured.entries.map(this.toListingEntry),
      others: this.others.entries.map(this.toListingEntry),
      resolve: this.resolve,
    });
    lastAnswers.set(this.args.realmURL, stories);
    return stories;
  }

  // Until the first answer, the shelf holds its place, so Workspaces below
  // it doesn't move down when the stories arrive.
  private get isPending() {
    return !this.isAnswered && this.stories.length === 0;
  }

  // One search for every story's art: the examples' prerendered isolated
  // HTML, and nothing else, so an example without HTML yet never renders
  // live.
  private get artQuery(): SearchEntryWireQuery | undefined {
    let exampleIds = this.stories
      .map((story) => story.exampleId)
      .filter((id): id is string => Boolean(id));
    if (exampleIds.length === 0) {
      return undefined;
    }
    return {
      realms: [this.args.realmURL],
      cardUrls: exampleIds.map((id) => `${id}.json`),
      scope: 'cards',
      filter: { eq: { htmlQuery: { eq: { format: 'isolated' } } } },
      fields: { entry: ['html'] },
    };
  }

  private artFor = (
    entries: RenderableSearchEntryLike[],
    exampleId: string | undefined,
  ) =>
    exampleId
      ? entries.find(
          (entry) =>
            entry.html?.html != null &&
            this.toListingEntry(entry).id === exampleId,
        )
      : undefined;

  @action private open(cardId: string) {
    this.operatorModeStateService.openCardInInteractMode(cardId);
    this.operatorModeStateService.closeWorkspaceChooser();
  }

  @action private async openCatalog() {
    await this.operatorModeStateService.openWorkspace(this.args.realmURL);
  }

  <template>
    {{#if this.stories.length}}
      <div class='catalog-shelf' data-test-catalog-shelf ...attributes>
        <SearchResults
          @query={{this.artQuery}}
          @mode='none'
          @overlays={{false}}
          as |art|
        >
          <ul class='stories' aria-label='From the catalog'>
            {{#each this.stories key='id' as |story|}}
              {{#let (this.artFor art.entries story.exampleId) as |artEntry|}}
                {{! Each story is a scheme island on its own paper, so its
                    text and buttons read that scheme's tokens. }}
                <li
                  class='story tint-{{story.tint}}'
                  data-theme={{story.scheme}}
                  data-test-catalog-story={{story.id}}
                >
                  <p class='eyebrow'>{{story.eyebrow}}</p>
                  {{! The headline's button stretches over the story, so a
                      click anywhere on it opens the listing; the actions sit
                      above it. }}
                  <h3 class='headline'>
                    <button
                      type='button'
                      class='story-open'
                      {{on 'click' (fn this.open story.id)}}
                      data-test-catalog-story-open
                    >{{story.name}}</button>
                  </h3>
                  <div class='art' {{fitPage ART_PAGE_WIDTH_PX}}>
                    {{#if artEntry}}
                      {{! A preview, not the card: nothing in it takes focus.
                          A card without a theme of its own shows light, not in
                          its story's scheme. }}
                      <div
                        class='art-page'
                        data-theme='light'
                        inert
                        data-test-catalog-story-example={{story.exampleId}}
                      >
                        <artEntry.component />
                      </div>
                    {{else if story.thumbnailURL}}
                      <img
                        class='thumbnail'
                        src={{story.thumbnailURL}}
                        alt=''
                        loading='lazy'
                        data-test-catalog-story-thumbnail
                      />
                    {{/if}}
                  </div>
                  <p class='copy'>{{story.copy}}</p>
                  <div class='actions'>
                    {{#if story.exampleId}}
                      <Button
                        class='action'
                        @tone='neutral'
                        @appearance='outlined'
                        @shape='pill'
                        aria-label='Try it: {{story.name}}'
                        {{on 'click' (fn this.open story.exampleId)}}
                        data-test-catalog-story-try
                      >Try it</Button>
                    {{/if}}
                    <Button
                      class='action'
                      @tone='neutral'
                      @appearance='accent'
                      @shape='pill'
                      aria-label='{{story.action}} {{story.name}}'
                      {{on 'click' (fn this.open story.id)}}
                      data-test-catalog-story-action
                    >{{story.action}}</Button>
                  </div>
                </li>
              {{/let}}
            {{/each}}
          </ul>
        </SearchResults>
        <Button
          class='see-all'
          @tone='neutral'
          @appearance='link'
          {{on 'click' this.openCatalog}}
          data-test-catalog-see-all
        >See the whole catalog <span aria-hidden='true'>→</span></Button>
      </div>
    {{else if this.isPending}}
      {{! The stories' metrics with nothing in them. }}
      <div
        class='catalog-shelf'
        aria-hidden='true'
        inert
        data-test-catalog-shelf-pending
        ...attributes
      >
        <ul class='stories'>
          {{#each PENDING_STORIES}}
            <li class='story is-pending'>
              <p class='eyebrow'>&nbsp;</p>
              <p class='headline'>&nbsp;</p>
              <div class='art'></div>
              <p class='copy'></p>
              <div class='actions'>
                <span class='pending-action'></span>
              </div>
            </li>
          {{/each}}
        </ul>
        <Button
          class='see-all is-pending'
          @tone='neutral'
          @appearance='link'
        >See the whole catalog</Button>
      </div>
    {{/if}}

    <style scoped>
      .catalog-shelf {
        --_catalog-shelf-story-min-width: 13rem;
        --_catalog-shelf-art-height: 9.5rem;
        --_catalog-shelf-action-height: 1.875rem;
        --_catalog-shelf-copy-lines: 3;
        --_catalog-shelf-copy-leading: 1.45em;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      /* One row of equal stories that share the width between them. */
      .stories {
        display: grid;
        grid-template-columns: repeat(
          auto-fit,
          minmax(min(var(--_catalog-shelf-story-min-width), 100%), 1fr)
        );
        gap: var(--boxel-sp);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .story {
        --_story-edge: color-mix(in oklch, var(--foreground) 12%, transparent);
        position: relative;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        min-width: 0;
        padding: var(--boxel-sp);
        border-radius: var(--boxel-border-radius-2xl);
        background-color: var(--_story-paper);
        color: var(--foreground);
        box-shadow:
          0 0 0 1px var(--_story-edge),
          var(--shadow-md);
        transition: transform var(--boxel-transition);
      }
      @media (hover: hover) and (prefers-reduced-motion: no-preference) {
        .story:hover {
          transform: translateY(-0.125rem);
        }
      }
      /* The story draws the keyboard ring around the whole card. */
      .story:has(.story-open:focus-visible) {
        box-shadow: var(--dashboard-ring), var(--shadow-md);
      }
      /* The papers, in turn: warm, ink, mint, lilac. */
      .tint-warm {
        --_story-paper: color-mix(
          in oklch,
          color-mix(in oklch, var(--boxel-light) 90%, var(--boxel-orange)) 95%,
          var(--boxel-dark)
        );
        --_story-accent: color-mix(
          in oklch,
          var(--boxel-orange) 70%,
          var(--boxel-dark)
        );
      }
      .tint-ink {
        --_story-paper: color-mix(
          in oklch,
          var(--boxel-purple) 18%,
          var(--boxel-dark)
        );
        --_story-accent: var(--boxel-highlight);
      }
      .tint-mint {
        --_story-paper: color-mix(
          in oklch,
          var(--boxel-teal) 16%,
          var(--boxel-light)
        );
        --_story-accent: color-mix(
          in oklch,
          var(--boxel-teal) 45%,
          var(--boxel-dark)
        );
      }
      .tint-lilac {
        --_story-paper: color-mix(
          in oklch,
          var(--boxel-lilac) 16%,
          var(--boxel-light)
        );
        --_story-accent: color-mix(
          in oklch,
          var(--boxel-purple) 80%,
          var(--boxel-dark)
        );
      }
      /* Host chrome has no CardContainer zeroing these margins. */
      .eyebrow {
        margin: 0;
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-2xs);
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--_story-accent);
      }
      .headline {
        min-width: 0;
        margin: 0;
        font-size: var(--boxel-font-size);
        font-weight: 700;
        line-height: 1.2;
        letter-spacing: -0.015em;
      }
      /* A button ignores line-clamp, so the name truncates on one line. Its
         hit area covers the story; the actions sit above it. */
      .story-open {
        display: block;
        max-width: 100%;
        padding: 0;
        overflow: hidden;
        border: 0;
        background-color: transparent;
        color: inherit;
        font-family: inherit;
        font-size: inherit;
        font-weight: inherit;
        line-height: inherit;
        letter-spacing: inherit;
        text-align: start;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .story-open::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 1;
        border-radius: inherit;
      }
      /* The story draws the ring; the transparent outline stands in for it
         in forced-colors mode, which drops box-shadows. */
      .story-open:focus-visible {
        outline: 2px solid transparent;
      }
      .art {
        position: relative;
        flex: none;
        height: var(--_catalog-shelf-art-height);
        overflow: hidden;
        border-radius: var(--boxel-border-radius-xl);
        background-color: var(--boxel-light);
        box-shadow: 0 0 0 1px var(--boxel-dark-10);
      }
      /* The example card, laid out as a page and zoomed into the frame. */
      .art-page {
        position: absolute;
        top: 0;
        left: 0;
        width: var(--page-width);
        height: var(--page-height);
        overflow: hidden;
        transform: scale(var(--page-zoom));
        transform-origin: 0 0;
        pointer-events: none;
      }
      /* The thumbnail is an icon, so it shows whole and centered rather than
         cropped to fill the frame. */
      .thumbnail {
        display: block;
        width: 100%;
        height: 70%;
        margin-top: calc(var(--_catalog-shelf-art-height) * 0.15);
        object-fit: contain;
      }
      .copy {
        display: -webkit-box;
        margin: 0;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: var(--_catalog-shelf-copy-lines);
        /* Always three lines tall, so a story's height never depends on its
           copy and the stand-ins match it. */
        min-height: calc(
          var(--_catalog-shelf-copy-lines) * var(--_catalog-shelf-copy-leading)
        );
        font-size: var(--boxel-font-size-sm);
        line-height: var(--_catalog-shelf-copy-leading);
        color: var(--muted-foreground);
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-xs);
        margin-top: auto;
        padding-top: var(--boxel-sp-xs);
        border-top: 1px solid var(--_story-edge);
      }
      /* Above the headline's hit area. */
      .action {
        --pretui-button-h: var(--_catalog-shelf-action-height);
        --pretui-button-px: var(--boxel-sp-sm);
        position: relative;
        z-index: 2;
      }
      .see-all {
        align-self: flex-start;
      }
      .story.is-pending {
        --_story-edge: transparent;
        background-color: var(--boxel-dark-50);
        box-shadow: none;
      }
      .is-pending .art {
        background-color: var(--boxel-dark-50);
        box-shadow: none;
      }
      .pending-action {
        display: block;
        height: var(--_catalog-shelf-action-height);
      }
      .see-all.is-pending {
        visibility: hidden;
      }
      @media (prefers-reduced-motion: reduce) {
        .story {
          transition: none;
        }
      }
    </style>
  </template>
}
