import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { didCancel, task } from 'ember-concurrency';

import { cssVar } from '@cardstack/boxel-ui/helpers';

import {
  logger,
  rri,
  searchEntryWireQueryFromQuery,
  SupportedMimeType,
  type RenderableSearchEntryLike,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

import SearchResults from '@cardstack/host/components/search/search-results';
import { catalogRealmURL } from '@cardstack/host/lib/utils';
import type NetworkService from '@cardstack/host/services/network';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { fitPage } from './pinned-cards';

const log = logger('component:workspace-chooser/catalog-showcase');

// The lead post's art is the listing's own example card, rendered as a page
// this wide and zoomed down into the frame.
const ART_PAGE_WIDTH = 1000;

// The lead story plus this many rows under it.
const SHELF_ROWS = 4;
// Listings fetched for the rows: enough to fill them after the featured ones
// and any without a thumbnail drop out.
const LISTINGS_FETCHED = 12;

// Only these fields of a listing are read, so the search returns them from
// the index and no card code loads to draw the shelf.
const LISTING_FIELDS = ['item.name', 'item.summary', 'item.cardThumbnailURL'];

interface ShelfItem {
  id: string;
  kind: string;
  name: string;
  summary: string | undefined;
  art: string | undefined;
  artCss: string | undefined;
  exampleId: string | undefined;
}

interface Shelf {
  lead: ShelfItem | undefined;
  rows: ShelfItem[];
}

// The Catalogs section's shelf: the Boxel catalog shown the way an app store
// shows its own, a featured listing with its art and a short list of more to
// try. The catalog curates what it features (its index card's `featured`
// links); the rows are its other listings.
export default class CatalogShowcase extends Component {
  @service declare private network: NetworkService;
  @service declare private operatorModeStateService: OperatorModeStateService;

  @tracked private featuredIds: string[] = [];
  // Featured listing → its first example card, the lead post's art.
  @tracked private examples: Record<string, string> = {};

  constructor(owner: unknown, args: object) {
    super(owner as never, args as never);
    this.loadFeaturedTask.perform().catch((error: unknown) => {
      if (didCancel(error)) {
        return;
      }
      log.warn(`loading the catalog's featured listings failed: ${error}`);
    });
  }

  private get listingType() {
    return catalogRealmURL
      ? {
          module: rri(`${catalogRealmURL}catalog-app/listing/listing`),
          name: 'Listing',
        }
      : undefined;
  }

  // The catalog's index card names the listings it features.
  private loadFeaturedTask = task(async () => {
    if (!catalogRealmURL) {
      return;
    }
    let indexURL = `${catalogRealmURL}index`;
    let response = await this.network.authedFetch(indexURL, {
      headers: { Accept: SupportedMimeType.CardJson },
    });
    if (!response.ok) {
      throw new Error(`${indexURL} answered ${response.status}`);
    }
    let doc = await response.json();
    let relationships: Record<string, { data?: { id?: string } }> =
      doc?.data?.relationships ?? {};
    this.featuredIds = Object.keys(relationships)
      .filter((key) => key.startsWith('featured.'))
      .sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1]))
      .map((key) => relationships[key]?.data?.id)
      .filter((id): id is string => Boolean(id))
      .map(this.toURL);

    let examples: Record<string, string> = {};
    await Promise.all(
      this.featuredIds.map(async (listingId) => {
        let example = await this.firstExampleOf(listingId);
        if (example) {
          examples[listingId] = example;
        }
      }),
    );
    this.examples = examples;
  });

  // A listing links the cards that show it in use; the first one becomes
  // the post's art. A listing that won't load just goes without.
  private async firstExampleOf(listingId: string) {
    try {
      let response = await this.network.authedFetch(listingId, {
        headers: { Accept: SupportedMimeType.CardJson },
      });
      if (!response.ok) {
        return undefined;
      }
      let doc = await response.json();
      let id = doc?.data?.relationships?.['examples.0']?.data?.id;
      return typeof id === 'string' ? this.toURL(id) : undefined;
    } catch {
      return undefined;
    }
  }

  private exampleQuery = (exampleId: string): SearchEntryWireQuery => {
    let base = searchEntryWireQueryFromQuery({}, { scope: 'cards' });
    return {
      ...base,
      cardUrls: [`${exampleId}.json`],
      filter: {
        ...base.filter,
        eq: { ...base.filter?.eq, htmlQuery: { eq: { format: 'isolated' } } },
      },
    };
  };

  // Links and search results name cards by realm-scoped identifier or by
  // URL; comparing them needs one form.
  private toURL = (id: string) => this.network.virtualNetwork.toURL(id).href;

  private get featuredQuery(): SearchEntryWireQuery | undefined {
    if (!catalogRealmURL || this.featuredIds.length === 0) {
      return undefined;
    }
    return {
      ...searchEntryWireQueryFromQuery(
        {},
        { scope: 'cards', fields: LISTING_FIELDS },
      ),
      realms: [catalogRealmURL],
      cardUrls: this.featuredIds.map((id) => `${id}.json`),
    };
  }

  private get listingsQuery(): SearchEntryWireQuery | undefined {
    let type = this.listingType;
    if (!catalogRealmURL || !type) {
      return undefined;
    }
    return {
      ...searchEntryWireQueryFromQuery(
        { filter: { type }, page: { number: 0, size: LISTINGS_FETCHED } },
        { scope: 'cards', fields: LISTING_FIELDS },
      ),
      realms: [catalogRealmURL],
    };
  }

  // Featured listings lead, in the catalog's order; the rest fill the rows.
  // A listing without art can't carry the lead, so it only appears as a row.
  private shelf = (
    featured: RenderableSearchEntryLike[],
    listings: RenderableSearchEntryLike[],
  ): Shelf => {
    let order = new Map(this.featuredIds.map((id, index) => [id, index]));
    let item = (entry: RenderableSearchEntryLike) => {
      let id = this.toURL(entry.id);
      return { ...toShelfItem(entry), id, exampleId: this.examples[id] };
    };
    let featuredItems = featured
      .map(item)
      .sort(
        (a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity),
      );
    let seen = new Set(featuredItems.map((item) => item.id));
    let all = [
      ...featuredItems,
      ...listings.map(item).filter((listing) => !seen.has(listing.id)),
    ];
    // A listing with an example to show leads; failing that, one with art.
    let lead =
      all.find((item) => item.exampleId) ?? all.find((item) => item.art);
    let rows = all
      .filter((item) => item !== lead && item.art)
      .slice(0, SHELF_ROWS);
    return { lead, rows };
  };

  @action private openListing(id: string) {
    this.operatorModeStateService.openCardInInteractMode(id);
    this.operatorModeStateService.closeWorkspaceChooser();
  }

  @action private async browseCatalog() {
    if (catalogRealmURL) {
      await this.operatorModeStateService.openWorkspace(catalogRealmURL);
    }
  }

  <template>
    <SearchResults
      @query={{this.featuredQuery}}
      @mode='none'
      @overlays={{false}}
      as |featured|
    >
      <SearchResults
        @query={{this.listingsQuery}}
        @mode='none'
        @overlays={{false}}
        as |listings|
      >
        {{#let (this.shelf featured.entries listings.entries) as |shelf|}}
          {{#if shelf.lead}}
            <div class='showcase' data-test-catalog-showcase>
              <article
                class='story lead'
                data-test-catalog-story-lead={{shelf.lead.id}}
              >
                {{! The whole post opens the listing for a pointer; the Open
                    button below is the keyboard's way in. }}
                <button
                  type='button'
                  class='story-hit'
                  tabindex='-1'
                  aria-hidden='true'
                  {{on 'click' (fn this.openListing shelf.lead.id)}}
                ></button>
                <span class='eyebrow'>Featured · {{shelf.lead.kind}}</span>
                <h3 class='headline'>{{shelf.lead.name}}</h3>
                {{#if shelf.lead.exampleId}}
                  <span
                    class='art is-live'
                    style={{cssVar page-width=artPageWidth}}
                    {{fitPage ART_PAGE_WIDTH}}
                    data-test-catalog-story-example={{shelf.lead.exampleId}}
                  >
                    <span class='art-page' inert>
                      <SearchResults
                        @query={{this.exampleQuery shelf.lead.exampleId}}
                        @mode='none'
                        @overlays={{false}}
                        as |example|
                      >
                        {{#each example.entries key='id' as |entry|}}
                          <entry.component />
                        {{/each}}
                      </SearchResults>
                    </span>
                  </span>
                {{else}}
                  <span
                    class='art'
                    style={{cssVar story-art=shelf.lead.artCss}}
                  ></span>
                {{/if}}
                {{#if shelf.lead.summary}}
                  <p class='dek'>{{shelf.lead.summary}}</p>
                {{/if}}
                <span class='foot'>
                  <span
                    class='app-icon'
                    style={{cssVar story-art=shelf.lead.artCss}}
                  ></span>
                  <span class='app-words'>
                    <b>{{shelf.lead.name}}</b>
                    <span>From the Boxel catalog</span>
                  </span>
                  <button
                    type='button'
                    class='act raised'
                    aria-label='Open {{shelf.lead.name}}'
                    {{on 'click' (fn this.openListing shelf.lead.id)}}
                  >Open</button>
                </span>
              </article>

              <div class='story-list'>
                {{#each shelf.rows key='id' as |item|}}
                  <article
                    class='story row'
                    data-test-catalog-story-row={{item.id}}
                  >
                    <button
                      type='button'
                      class='story-hit'
                      tabindex='-1'
                      aria-hidden='true'
                      {{on 'click' (fn this.openListing item.id)}}
                    ></button>
                    <span
                      class='thumb'
                      style={{cssVar story-art=item.artCss}}
                    ></span>
                    <span class='row-words'>
                      <span class='eyebrow'>{{item.kind}}</span>
                      <b class='row-title'>{{item.name}}</b>
                    </span>
                    <button
                      type='button'
                      class='act raised'
                      aria-label='Open {{item.name}}'
                      {{on 'click' (fn this.openListing item.id)}}
                    >Open</button>
                  </article>
                {{/each}}
                <button
                  type='button'
                  class='browse'
                  {{on 'click' this.browseCatalog}}
                  data-test-catalog-browse
                >Browse the whole catalog →</button>
              </div>
            </div>
          {{/if}}
        {{/let}}
      </SearchResults>
    </SearchResults>

    <style scoped>
      /* The shelf is the store, so it reads as posts rather than as more
         workspaces: a warm paper lead and a white list, set on the dark page
         the way the catalog's own pages are. */
      .showcase {
        --story-ink: var(--boxel-dark);
        --story-muted: color-mix(in oklch, var(--boxel-dark) 66%, transparent);
        --story-line: color-mix(in oklch, var(--boxel-dark) 10%, transparent);
        --story-accent: color-mix(
          in oklch,
          var(--boxel-teal) 62%,
          var(--boxel-dark)
        );
        --story-paper: color-mix(
          in oklch,
          color-mix(in oklch, var(--boxel-light) 90%, var(--boxel-orange)) 95%,
          var(--boxel-dark)
        );
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--boxel-sp-lg);
        color: var(--story-ink);
      }
      .story {
        position: relative;
        box-sizing: border-box;
      }
      .story-hit {
        position: absolute;
        inset: 0;
        z-index: 1;
        border: 0;
        border-radius: inherit;
        background: transparent;
        cursor: pointer;
      }
      .story-hit:focus-visible {
        outline: 3px solid var(--boxel-highlight);
        outline-offset: 2px;
      }
      .raised {
        position: relative;
        z-index: 2;
      }
      .lead,
      .story-list {
        border-radius: 1.375rem;
        box-shadow:
          0 0 0 1px var(--story-line),
          0 0.875rem 1.875rem
            color-mix(in oklch, var(--boxel-dark) 35%, transparent);
      }
      .lead {
        flex: 1.15 1 24rem;
        max-width: 34rem;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-lg);
        background-color: var(--story-paper);
      }
      .eyebrow {
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-2xs);
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--story-accent);
      }
      .headline {
        margin: 0;
        font-size: 1.5rem;
        font-weight: 700;
        line-height: 1.12;
        letter-spacing: -0.015em;
      }
      .art {
        position: relative;
        display: block;
        height: 12.5rem;
        overflow: hidden;
        border-radius: 0.875rem;
        background-color: var(--boxel-light);
        background-image: var(--story-art);
        background-size: cover;
        background-position: top center;
        box-shadow: 0 0 0 1px var(--story-line);
      }
      /* The example card, laid out as a page and zoomed into the frame. */
      .art-page {
        position: absolute;
        top: 0;
        left: 0;
        width: var(--page-width);
        transform: scale(var(--page-zoom, 0.4));
        transform-origin: 0 0;
        pointer-events: none;
      }
      .dek {
        margin: 0;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        overflow: hidden;
        font-size: var(--boxel-font-size);
        line-height: 1.45;
        color: var(--story-muted);
      }
      .foot {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        padding-top: var(--boxel-sp-sm);
        border-top: 1px solid var(--story-line);
      }
      .app-icon {
        flex: none;
        width: 3rem;
        height: 3rem;
        border-radius: 0.75rem;
        background-color: var(--boxel-light);
        background-image: var(--story-art);
        background-size: cover;
        background-position: top left;
        box-shadow: 0 0 0 1px var(--story-line);
      }
      .app-words {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        font-size: var(--boxel-font-size-sm);
      }
      .app-words > * {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .app-words span {
        color: var(--story-muted);
      }
      .act {
        flex: none;
        height: 2.75rem;
        padding: 0 var(--boxel-sp-lg);
        border: 0;
        border-radius: 1.375rem;
        background-color: var(--story-ink);
        color: var(--boxel-light);
        font-size: var(--boxel-font-size-sm);
        font-weight: 700;
        cursor: pointer;
      }
      .act:hover {
        background-color: color-mix(
          in oklch,
          var(--story-ink) 82%,
          var(--boxel-light)
        );
      }
      .act:focus-visible {
        outline: 2px solid var(--boxel-highlight);
        outline-offset: 2px;
      }

      .story-list {
        flex: 1 1 22rem;
        max-width: 30rem;
        display: flex;
        flex-direction: column;
        padding: var(--boxel-sp-xs);
        background-color: var(--boxel-light);
      }
      .row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-xs);
        border-radius: 0.875rem;
      }
      .row:hover {
        background-color: color-mix(in oklch, var(--story-ink) 4%, transparent);
      }
      .thumb {
        flex: none;
        width: 3.5rem;
        height: 3.5rem;
        border-radius: 0.875rem;
        background-color: var(--boxel-100);
        background-image: var(--story-art);
        background-size: cover;
        background-position: top left;
        box-shadow: 0 0 0 1px var(--story-line);
      }
      .row-words {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-6xs);
      }
      .row-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--boxel-font-size);
      }
      .browse {
        margin-top: var(--boxel-sp-4xs);
        padding: var(--boxel-sp-xs);
        border: 0;
        border-top: 1px solid var(--story-line);
        border-radius: 0 0 0.875rem 0.875rem;
        background: none;
        color: var(--story-muted);
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        text-align: left;
        cursor: pointer;
      }
      .browse:hover {
        color: var(--story-ink);
      }
      .browse:focus-visible {
        outline: 2px solid var(--boxel-highlight);
        outline-offset: 2px;
      }
      @media (max-width: 30rem) {
        .lead,
        .story-list {
          width: 100%;
        }
      }
    </style>
  </template>
}

// The search reports a listing's base type, but an instance lives in a
// folder named for its own class ("…/CardListing/<id>"), which says what
// the listing offers ("Card").
const LISTING_FOLDER = /^([A-Za-z]+)Listing$/;

function kindOf(entry: RenderableSearchEntryLike) {
  let folder = entry.id.split('/').slice(-2, -1)[0] ?? '';
  return LISTING_FOLDER.exec(folder)?.[1] ?? 'Listing';
}

function toShelfItem(entry: RenderableSearchEntryLike): ShelfItem {
  let attributes = (entry.item?.attributes ?? {}) as Record<string, unknown>;
  let text = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined;
  let art = text(attributes.cardThumbnailURL);
  return {
    id: entry.id,
    kind: kindOf(entry),
    name: shelfName(text(attributes.name)),
    summary: shelfSummary(text(attributes.summary)),
    art,
    artCss: art ? `url("${art}")` : undefined,
    exampleId: undefined,
  };
}

// Listing names are written for the catalog's own index ("Wine Cellar Card
// Definition"); on the shelf the kind already rides in the eyebrow.
const DEFINITION_SUFFIX = /\s+(?:(?:card|field|app)\s+)?definition$/i;

function shelfName(name: string | undefined) {
  return name ? name.replace(DEFINITION_SUFFIX, '') : 'Untitled listing';
}

// A summary that opens by describing the code ("The WineCellar component
// serves as…") is documentation, not a pitch, so the shelf leaves it out
// until the catalog carries editorial copy for what it features.
const CODE_DESCRIPTION = /^the\s+\S+\s+(?:component|card|field)\b/i;

function shelfSummary(summary: string | undefined) {
  return summary && !CODE_DESCRIPTION.test(summary) ? summary : undefined;
}

const artPageWidth = `${ART_PAGE_WIDTH}px`;
