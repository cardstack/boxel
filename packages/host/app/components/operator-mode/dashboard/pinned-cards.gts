import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import {
  trimJsonExtension,
  type RealmResourceIdentifier,
  type RenderableSearchEntryLike,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

import SearchResults from '@cardstack/host/components/search/search-results';
import type NetworkService from '@cardstack/host/services/network';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';

import fitPage from './fit-page';

// A desk has room for this many pins; the rest stay on the workspace's Home.
const MAX_DESK_PINS = 4;

// The collage is laid out on a page this many design pixels wide and zoomed
// to the desk, so each card lays itself out the way it really looks and the
// desk shows a miniature of it, not a few cards blown up to fill it.
const COLLAGE_PAGE_WIDTH_PX = 900;

interface Signature {
  Element: HTMLDivElement;
  Args: {
    // The pinned cards' ids, in the workspace's order.
    cardIds: RealmResourceIdentifier[];
    // The workspace's own realm, searched for pins whose realm isn't known.
    realm: string;
    workspaceName: string;
  };
}

// A workspace's pinned cards, collaged on its desk from their prerendered
// fitted HTML. Only rows that carry HTML are drawn, so no card code loads on
// the dashboard. Each card is its own control and opens that card.
export default class PinnedCards extends Component<Signature> {
  @service declare private network: NetworkService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;

  // One search for all the pins, not just the first few, so a pin with no
  // rendering yet gives its place to the next one. `html` alone would leave
  // a pin unnamed, so the title rides along as a field-limited item, which
  // never loads code.
  private get query(): SearchEntryWireQuery {
    let { virtualNetwork } = this.network;
    let realms = new Set(
      this.args.cardIds.map((id) => this.realm.realmOf(id) ?? this.args.realm),
    );
    return {
      realms: [...realms],
      cardUrls: this.args.cardIds.flatMap((id) => {
        try {
          return [`${virtualNetwork.toURL(id).href}.json`];
        } catch {
          return [];
        }
      }),
      scope: 'cards',
      filter: { eq: { htmlQuery: { eq: { format: 'fitted' } } } },
      fields: { entry: ['html', 'item.cardTitle'] },
    };
  }

  // Search answers in its own order; the desk keeps the workspace's. A pin
  // with no prerendered HTML yet is left out rather than rendered live, and
  // the desk draws the first pins that have it.
  // Entries are named by URL and pins by either form, so both are folded
  // to one before they're matched. Each pin keeps its own id, which is what
  // opens it.
  private inPinOrder = (entries: RenderableSearchEntryLike[]) => {
    let { virtualNetwork } = this.network;
    let byId = new Map(
      entries
        .filter((entry) => entry.html?.html != null)
        .map((entry) => [
          virtualNetwork.unresolveURL(trimJsonExtension(entry.id)),
          entry,
        ]),
    );
    return this.args.cardIds
      .flatMap((id) => {
        let entry = byId.get(virtualNetwork.unresolveURL(id));
        return entry ? [{ id, entry }] : [];
      })
      .slice(0, MAX_DESK_PINS);
  };

  private pinLabel = (entry: RenderableSearchEntryLike) => {
    let title = entry.item?.attributes?.cardTitle;
    return typeof title === 'string' && title
      ? `Open ${title}`
      : `Open pinned card in ${this.args.workspaceName}`;
  };

  @action private openPin(cardId: string) {
    this.operatorModeStateService.openCardInInteractMode(cardId);
    this.operatorModeStateService.closeWorkspaceChooser();
  }

  <template>
    <div class='pinned-cards' {{fitPage COLLAGE_PAGE_WIDTH_PX}} ...attributes>
      <SearchResults
        @query={{this.query}}
        @mode='none'
        @overlays={{false}}
        as |results|
      >
        {{#let (this.inPinOrder results.entries) as |pins|}}
          {{#if pins.length}}
            <ul
              class='collage pins-{{pins.length}}'
              aria-label='Pinned cards in {{@workspaceName}}'
              data-pinned-collage
              data-test-pinned-cards={{@realm}}
            >
              {{#each pins key='id' as |pin|}}
                <li class='pin'>
                  <button
                    type='button'
                    class='pin-button'
                    aria-label={{this.pinLabel pin.entry}}
                    {{on 'click' (fn this.openPin pin.id)}}
                    data-test-pinned-card={{pin.id}}
                  >
                    {{! A preview, not the card: nothing in it takes focus.
                        The dashboard is dark; a card shows in its own theme,
                        which defaults to light. }}
                    <span class='pin-render' data-theme='light' inert>
                      <pin.entry.component class='pin-card' />
                    </span>
                  </button>
                </li>
              {{/each}}
            </ul>
          {{/if}}
        {{/let}}
      </SearchResults>
    </div>

    <style scoped>
      /* Metrics in design pixels, before the zoom. */
      .pinned-cards {
        --_pinned-cards-gap: 1.125rem;
        --_pinned-cards-radius: 1.125rem;
        position: relative;
        min-height: 0;
        /* The space between cards is wallpaper, which opens the workspace;
           only the cards take clicks. */
        pointer-events: none;
      }
      /* Everything inside is in design pixels; one zoom fits it to the desk. */
      .collage {
        position: absolute;
        top: 0;
        left: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr);
        gap: var(--_pinned-cards-gap);
        width: var(--page-width);
        height: var(--page-height);
        margin: 0;
        padding: 0;
        list-style: none;
        transform: scale(var(--page-zoom));
        transform-origin: 0 0;
      }
      /* Each count gets an arrangement with a lead card, so the desk reads
         as a collage rather than a grid of equals. */
      .pins-2 {
        grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
      }
      .pins-3,
      .pins-4 {
        grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
        grid-template-rows: repeat(2, minmax(0, 1fr));
      }
      .pins-4 {
        grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr);
      }
      .pins-3 > .pin:first-child,
      .pins-4 > .pin:first-child {
        grid-row: 1 / span 2;
      }
      .pins-4 > .pin:nth-child(2) {
        grid-column: 2 / span 2;
      }
      .pin {
        min-width: 0;
        min-height: 0;
      }
      .pin-button {
        position: relative;
        display: block;
        width: 100%;
        height: 100%;
        padding: 0;
        border: 0;
        border-radius: var(--_pinned-cards-radius);
        overflow: hidden;
        /* Clear until the card paints its own face, with a faint edge
           holding its place, so a loading pin doesn't flash over the
           wallpaper. */
        background-color: transparent;
        box-shadow: inset 0 0 0 1px var(--boxel-light-25);
        pointer-events: auto;
        transition: transform var(--boxel-transition);
      }
      .pin-button:hover {
        transform: translateY(-0.25rem);
      }
      /* Drawn in design pixels: the zoom brings it to about the dashboard
         ring's width. */
      .pin-button:focus-visible {
        outline: 4px solid var(--boxel-highlight);
        outline-offset: 4px;
      }
      /* The frame owns the corner radius, so every card keeps the same one
         whatever its own template paints. Fitted cards size themselves to
         this box through their container queries. */
      .pin-render {
        position: absolute;
        inset: 0;
        container-name: fitted-card;
        container-type: size;
      }
      .pin-card {
        width: 100%;
        height: 100%;
      }
      @media (prefers-reduced-motion: reduce) {
        .pin-button {
          transition: none;
        }
        .pin-button:hover {
          transform: none;
        }
      }
    </style>
  </template>
}
