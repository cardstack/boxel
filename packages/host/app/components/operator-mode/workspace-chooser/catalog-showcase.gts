import type { TemplateOnlyComponent } from '@ember/component/template-only';
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

// A story's art is the listing's own example card, rendered as a page this
// wide and zoomed down into the frame.
const ART_PAGE_WIDTH = 1000;

// Stories on the shelf: one row, so the store stays a shelf beside the
// workspaces rather than the page's main event.
const STORY_COUNT = 4;
// Listings fetched for the stories: enough to fill them after the featured
// ones and any without a thumbnail drop out.
const LISTINGS_FETCHED = 12;
// Each story wears its own paper, in turn, the way a store's editorial
// cards do; the second is the dark one.
const TINT_COUNT = 5;

// Only these fields of a listing are read, so the search returns them from
// the index and no card code loads to draw the shelf.
const LISTING_FIELDS = ['item.name', 'item.summary', 'item.cardThumbnailURL'];

interface ShelfItem {
  id: string;
  kind: string;
  name: string;
  copy: string;
  action: string;
  art: string | undefined;
  artCss: string | undefined;
}

interface Story extends ShelfItem {
  eyebrow: string;
  tint: number;
  isLead: boolean;
}

// The Catalogs section's shelf: the Boxel catalog told as stories, the way
// an app store's Today tab tells its own. Each story is a tinted editorial
// card (an eyebrow, a headline, the listing's own example card as art) and
// opens its listing, which reads as the article. The catalog curates what
// leads (its index card's `featured` links); its other listings follow.
export default class CatalogShowcase extends Component {
  @service declare private network: NetworkService;
  @service declare private operatorModeStateService: OperatorModeStateService;

  @tracked private featuredIds: string[] = [];

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
  });

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

  // Featured listings lead, in the catalog's order; the rest follow. A
  // listing without a thumbnail has nothing to show while its example
  // loads, so it stays off the shelf.
  private stories = (
    featured: RenderableSearchEntryLike[],
    listings: RenderableSearchEntryLike[],
  ): Story[] => {
    let order = new Map(this.featuredIds.map((id, index) => [id, index]));
    let item = (entry: RenderableSearchEntryLike) => ({
      ...toShelfItem(entry),
      id: this.toURL(entry.id),
    });
    let featuredItems = featured
      .map(item)
      .sort(
        (a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity),
      );
    let seen = new Set(featuredItems.map((item) => item.id));
    return [
      ...featuredItems,
      ...listings.map(item).filter((listing) => !seen.has(listing.id)),
    ]
      .filter((item) => item.art)
      .slice(0, STORY_COUNT)
      .map((item, index) => ({
        ...item,
        eyebrow: eyebrowOf(item.kind, index === 0),
        tint: index % TINT_COUNT,
        isLead: index === 0,
      }));
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
        {{#let (this.stories featured.entries listings.entries) as |stories|}}
          {{#if stories.length}}
            <div class='showcase' data-test-catalog-showcase>
              <div class='stories'>
                {{#each stories key='id' as |story|}}
                  <article
                    class='story tint-{{story.tint}}'
                    data-test-catalog-story={{story.id}}
                    data-test-catalog-story-lead={{if story.isLead story.id}}
                  >
                    {{! The whole story opens its listing for a pointer; the
                        buttons below are the keyboard's way in. }}
                    <button
                      type='button'
                      class='story-hit'
                      tabindex='-1'
                      aria-hidden='true'
                      {{on 'click' (fn this.openListing story.id)}}
                    ></button>
                    <ExampleOf @listingId={{story.id}} as |exampleId|>
                      <span class='eyebrow'>{{story.eyebrow}}</span>
                      <h3 class='headline'>{{story.name}}</h3>
                      <StoryArt
                        @exampleId={{exampleId}}
                        @artCss={{story.artCss}}
                      />
                      <p class='copy'>{{story.copy}}</p>
                      <span class='foot'>
                        <span
                          class='app-icon'
                          style={{cssVar story-art=story.artCss}}
                        ></span>
                        {{#if exampleId}}
                          <button
                            type='button'
                            class='act secondary raised'
                            aria-label='Try {{story.name}}'
                            {{on 'click' (fn this.openListing exampleId)}}
                            data-test-catalog-story-try={{story.id}}
                          >Try it</button>
                        {{/if}}
                        <button
                          type='button'
                          class='act raised'
                          aria-label='{{story.action}} {{story.name}}'
                          {{on 'click' (fn this.openListing story.id)}}
                          data-test-catalog-story-action={{story.id}}
                        >{{story.action}}</button>
                      </span>
                    </ExampleOf>
                  </article>
                {{/each}}
              </div>
              <button
                type='button'
                class='browse'
                {{on 'click' this.browseCatalog}}
                data-test-catalog-browse
              >Browse the whole catalog →</button>
            </div>
          {{/if}}
        {{/let}}
      </SearchResults>
    </SearchResults>

    <style scoped>
      /* The shelf is the store, so it reads as editorial stories rather than
         as more workspaces: tinted paper cards on the dark page, the way the
         catalog's own pages are set. */
      .showcase {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      /* One row of equal stories that share the width between them. */
      .stories {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
        gap: var(--boxel-sp);
      }
      .story {
        --story-ink: var(--boxel-dark);
        --story-accent: color-mix(
          in oklch,
          var(--boxel-teal) 62%,
          var(--boxel-dark)
        );
        --story-act: var(--boxel-dark);
        --story-act-ink: var(--boxel-light);
        position: relative;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        min-width: 0;
        padding: var(--boxel-sp);
        border-radius: 1.125rem;
        background-color: var(--story-paper);
        color: var(--story-ink);
        box-shadow:
          0 0 0 1px color-mix(in oklch, var(--story-ink) 12%, transparent),
          0 0.375rem 1rem
            color-mix(in oklch, var(--boxel-dark) 25%, transparent);
        transition: transform 0.2s ease;
      }
      .story:hover {
        transform: translateY(-0.125rem);
      }
      /* The papers, in turn: warm, ink, mint, lilac, sky. */
      .tint-0 {
        --story-paper: color-mix(
          in oklch,
          color-mix(in oklch, var(--boxel-light) 90%, var(--boxel-orange)) 95%,
          var(--boxel-dark)
        );
      }
      .tint-1 {
        --story-paper: color-mix(
          in oklch,
          var(--boxel-purple) 18%,
          var(--boxel-dark)
        );
        --story-ink: var(--boxel-light);
        --story-accent: var(--boxel-highlight);
        --story-act: var(--boxel-highlight);
        --story-act-ink: var(--boxel-dark);
      }
      .tint-2 {
        --story-paper: color-mix(
          in oklch,
          var(--boxel-teal) 16%,
          var(--boxel-light)
        );
      }
      .tint-3 {
        --story-paper: color-mix(
          in oklch,
          var(--boxel-purple) 12%,
          var(--boxel-light)
        );
        --story-accent: color-mix(
          in oklch,
          var(--boxel-purple) 80%,
          var(--boxel-dark)
        );
      }
      .tint-4 {
        --story-paper: color-mix(
          in oklch,
          var(--boxel-blue) 12%,
          var(--boxel-light)
        );
        --story-accent: color-mix(
          in oklch,
          var(--boxel-blue) 80%,
          var(--boxel-dark)
        );
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
      .raised {
        position: relative;
        z-index: 2;
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
        overflow: hidden;
        font-size: 1rem;
        font-weight: 700;
        line-height: 1.2;
        text-overflow: ellipsis;
        white-space: nowrap;
        letter-spacing: -0.015em;
      }
      .copy {
        margin: 0;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        overflow: hidden;
        font-size: var(--boxel-font-size-sm);
        line-height: 1.45;
        color: color-mix(in oklch, var(--story-ink) 70%, transparent);
      }
      .foot {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin-top: auto;
        padding-top: var(--boxel-sp-xs);
        border-top: 1px solid
          color-mix(in oklch, var(--story-ink) 12%, transparent);
      }
      /* The icon holds the left; the actions gather at the right. */
      .app-icon {
        flex: none;
        margin-right: auto;
        width: 2rem;
        height: 2rem;
        border-radius: 0.5rem;
        background-color: var(--boxel-light);
        background-image: var(--story-art);
        background-size: cover;
        background-position: top left;
        box-shadow: 0 0 0 1px
          color-mix(in oklch, var(--story-ink) 12%, transparent);
      }
      .act {
        flex: none;
        height: 1.875rem;
        padding: 0 var(--boxel-sp-sm);
        border: 0;
        border-radius: 0.9375rem;
        background-color: var(--story-act);
        color: var(--story-act-ink);
        font-size: var(--boxel-font-size-sm);
        font-weight: 700;
        cursor: pointer;
      }
      /* Try it sits beside the main action as its quieter outline. */
      .act.secondary {
        background-color: transparent;
        box-shadow: inset 0 0 0 1px
          color-mix(in oklch, var(--story-ink) 30%, transparent);
        color: var(--story-ink);
      }
      .act:hover {
        background-color: color-mix(
          in oklch,
          var(--story-act) 82%,
          var(--story-act-ink)
        );
      }
      .act:focus-visible,
      .browse:focus-visible {
        outline: 2px solid var(--boxel-highlight);
        outline-offset: 2px;
      }
      .browse {
        align-self: flex-start;
        padding: var(--boxel-sp-xs) 0;
        border: 0;
        background: none;
        color: var(--workspace-chooser-label-color);
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        cursor: pointer;
      }
      .browse:hover {
        color: var(--boxel-light);
      }
    </style>
  </template>
}

interface ExampleOfSignature {
  Args: {
    listingId: string;
  };
  Blocks: {
    default: [exampleId: string | undefined];
  };
}

// Loads a listing's first example card, the one that shows it in use, and
// yields its id: the story draws it as art and its Try it opens it. A
// listing that won't load, or has no example, yields nothing.
class ExampleOf extends Component<ExampleOfSignature> {
  @service declare private network: NetworkService;

  @tracked private exampleId: string | undefined;

  constructor(owner: unknown, args: ExampleOfSignature['Args']) {
    super(owner as never, args);
    this.loadExampleTask.perform().catch((error: unknown) => {
      if (!didCancel(error)) {
        log.warn(`loading a story's example failed: ${error}`);
      }
    });
  }

  private loadExampleTask = task(async () => {
    let response = await this.network.authedFetch(this.args.listingId, {
      headers: { Accept: SupportedMimeType.CardJson },
    });
    if (!response.ok) {
      return;
    }
    let doc = await response.json();
    let id = doc?.data?.relationships?.['examples.0']?.data?.id;
    if (typeof id === 'string') {
      this.exampleId = this.network.virtualNetwork.toURL(id).href;
    }
  });

  <template>{{yield this.exampleId}}</template>
}

interface StoryArtSignature {
  Args: {
    exampleId: string | undefined;
    artCss: string | undefined;
  };
}

// A story's art: the listing's example card, laid out as a page and zoomed
// into the frame, so the story shows the thing in use rather than its
// icon. Until the example arrives, and for a listing without one, the
// listing's thumbnail stands in.
const StoryArt: TemplateOnlyComponent<StoryArtSignature> = <template>
  {{#if @exampleId}}
    <span
      class='art'
      style={{cssVar page-width=artPageWidth}}
      {{fitPage ART_PAGE_WIDTH}}
      data-test-catalog-story-example={{@exampleId}}
    >
      <span class='art-page' inert>
        <SearchResults
          @query={{exampleQuery @exampleId}}
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
    <span class='art is-thumb' style={{cssVar story-art=@artCss}}></span>
  {{/if}}
  <style scoped>
    .art {
      position: relative;
      display: block;
      flex: none;
      height: 9.5rem;
      overflow: hidden;
      border-radius: 0.875rem;
      background-color: var(--boxel-light);
      box-shadow: 0 0 0 1px
        color-mix(in oklch, var(--boxel-dark) 10%, transparent);
    }
    /* The thumbnail is an app icon, so it shows whole and centred rather
         than cropped to fill the frame. */
    .is-thumb {
      background-image: var(--story-art);
      background-size: auto 70%;
      background-position: center;
      background-repeat: no-repeat;
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
  </style>
</template>;

function exampleQuery(exampleId: string): SearchEntryWireQuery {
  let base = searchEntryWireQueryFromQuery({}, { scope: 'cards' });
  return {
    ...base,
    cardUrls: [`${exampleId}.json`],
    filter: {
      ...base.filter,
      eq: { ...base.filter?.eq, htmlQuery: { eq: { format: 'isolated' } } },
    },
  };
}

// The editorial label over a story, from what the listing offers: the lead
// is the catalog's pick of the week, the rest say what you'd get.
function eyebrowOf(kind: string, isLead: boolean) {
  if (isLead) {
    return `${kind} of the week`;
  }
  switch (kind) {
    case 'App':
      return 'New app';
    case 'Theme':
      return 'New theme';
    case 'Skill':
      return 'New skill';
    case 'Field':
      return 'Build with it';
    default:
      return 'Try it';
  }
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
  let kind = kindOf(entry);
  let attributes = (entry.item?.attributes ?? {}) as Record<string, unknown>;
  let text = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined;
  let art = text(attributes.cardThumbnailURL);
  return {
    id: entry.id,
    kind,
    name: shelfName(text(attributes.name)),
    copy: shelfCopy(kind, text(attributes.summary)),
    action: actionOf(kind),
    art,
    artCss: art ? `url("${art}")` : undefined,
  };
}

// Listing names are written for the catalog's own index ("Wine Cellar Card
// Definition"); on the shelf the kind already rides in the eyebrow.
const DEFINITION_SUFFIX = /\s+(?:(?:card|field|app)\s+)?definition$/i;

function shelfName(name: string | undefined) {
  return name ? name.replace(DEFINITION_SUFFIX, '') : 'Untitled listing';
}

// A summary that opens by describing the code ("The WineCellar component
// serves as…") is documentation, not a pitch; until the catalog carries
// editorial copy, such a listing gets a line that says what it's for.
const CODE_DESCRIPTION = /^the\s+\S+\s+(?:component|card|field)\b/i;

const KIND_COPY: Record<string, string> = {
  App: 'A whole app made of cards. Remix it into a workspace and change anything.',
  Theme: 'A look for your cards. Use it on any workspace.',
  Skill: 'Teach Boxel AI something new, then use it in any chat.',
  Field: 'A field to build your own cards with.',
};

function shelfCopy(kind: string, summary: string | undefined) {
  if (summary && !CODE_DESCRIPTION.test(summary)) {
    return summary;
  }
  return (
    KIND_COPY[kind] ??
    'Ready-made and free to remix: make it yours in a workspace of your own.'
  );
}

// The story's call to action names what the listing page offers: themes
// and skills are used as they are; cards, fields and apps are remixed
// into a workspace of your own.
function actionOf(kind: string) {
  return kind === 'Theme' || kind === 'Skill' ? 'Use' : 'Remix';
}

const artPageWidth = `${ART_PAGE_WIDTH}px`;
