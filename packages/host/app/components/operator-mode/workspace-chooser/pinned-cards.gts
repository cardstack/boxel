import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { modifier } from 'ember-modifier';

import { add, cn, cssVar, eq } from '@cardstack/boxel-ui/helpers';

import {
  searchEntryWireQueryFromQuery,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';
import {
  MAX_DASHBOARD_PINS_PER_WORKSPACE,
  type DashboardPin,
  type DashboardPinFormat,
} from '@cardstack/runtime-common/matrix-constants';

import HydratableCard from '@cardstack/host/components/search/hydratable-card';
import SearchResults from '@cardstack/host/components/search/search-results';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

// The collage is laid out on a canvas this many design pixels wide, then the
// whole canvas is zoomed to fit the tile. Cards are sized in design pixels,
// so each lays itself out the way it really looks — its text, its
// proportions — and the tile shows a miniature of them rather than a few
// cards blown up to fill it.
const CANVAS_WIDTH_PX = 900;

// Inside the canvas, fitted cards take whatever box the collage gives them:
// their templates are drawn for any size. The other formats are drawn for a
// page, so they render at the width their templates expect and are zoomed
// again to their box.
const PAGE_WIDTH_PX: Record<Exclude<DashboardPinFormat, 'fitted'>, number> = {
  embedded: 480,
  isolated: 900,
  edit: 640,
};

interface Signature {
  Element: HTMLDivElement;
  Args: {
    realmURL: string;
    workspaceName: string;
  };
}

// Zooms the canvas to the tile. Layout sizes (`offsetWidth`) ignore
// transforms, so the zoom is computed against the untransformed box.
const fitCanvas = modifier((element: HTMLElement) => {
  let apply = () => {
    let width = element.offsetWidth;
    let height = element.offsetHeight;
    if (width > 0 && height > 0) {
      let zoom = width / CANVAS_WIDTH_PX;
      element.style.setProperty('--collage-zoom', String(zoom));
      element.style.setProperty('--canvas-height', `${height / zoom}px`);
    }
  };
  let observer = new ResizeObserver(apply);
  observer.observe(element);
  apply();
  return () => observer.disconnect();
});

// Zooms a page-format card to its box (here and on the catalog shelf).
export const fitPage = modifier(
  (element: HTMLElement, [pageWidth]: [number | undefined]) => {
    if (!pageWidth) {
      return;
    }
    let apply = () => {
      let width = element.offsetWidth;
      if (width > 0) {
        element.style.setProperty('--page-zoom', String(width / pageWidth));
      }
    };
    let observer = new ResizeObserver(apply);
    observer.observe(element);
    apply();
    return () => observer.disconnect();
  },
);

// The cards a user pinned to a workspace, collaged on its dashboard tile.
// Each card is its own control and opens its card.
export default class PinnedCards extends Component<Signature> {
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;

  private get pins() {
    return this.matrixService
      .pinnedCardsFor(this.args.realmURL)
      .slice(0, MAX_DASHBOARD_PINS_PER_WORKSPACE);
  }

  private get shape() {
    return ['none', 'one', 'two', 'three', 'four'][this.pins.length];
  }

  // One query per pin keeps each rendering in the format the user chose.
  // Pins are few, and every format but `edit` is served from prerendered
  // HTML, so no card code loads to draw the tile.
  private queryFor = (pin: DashboardPin): SearchEntryWireQuery => {
    let base = searchEntryWireQueryFromQuery({}, { scope: 'cards' });
    return {
      ...base,
      realms: [this.args.realmURL],
      cardUrls: [
        pin.cardId.endsWith('.json') ? pin.cardId : `${pin.cardId}.json`,
      ],
      filter: {
        ...base.filter,
        eq: {
          ...base.filter?.eq,
          htmlQuery: { eq: { format: pin.format } },
        },
      },
    };
  };

  private pageWidth = (pin: DashboardPin) =>
    pin.format === 'fitted' ? undefined : PAGE_WIDTH_PX[pin.format];

  private pageWidthCss = (pin: DashboardPin) => {
    let width = this.pageWidth(pin);
    return width ? `${width}px` : undefined;
  };

  @action private openPin(cardId: string) {
    this.operatorModeStateService.openCardInInteractMode(cardId);
    this.operatorModeStateService.closeWorkspaceChooser();
  }

  <template>
    {{#if this.pins.length}}
      <div
        class='collage'
        style={{cssVar canvas-width=(canvasWidthCss)}}
        {{fitCanvas}}
        data-test-pinned-cards={{@realmURL}}
        ...attributes
      >
        <div class={{cn 'canvas' (shapeClass this.shape)}}>
          {{#each this.pins key='cardId' as |pin i|}}
            <button
              type='button'
              class={{cn 'pin' (formatClass pin.format)}}
              style={{cssVar page-width=(this.pageWidthCss pin)}}
              aria-label='Open pinned card {{add
                i
                1
              }} of {{this.pins.length}} in {{@workspaceName}}'
              {{fitPage (this.pageWidth pin)}}
              {{on 'click' (fn this.openPin pin.cardId)}}
              data-test-pinned-card={{pin.cardId}}
              data-test-pinned-card-format={{pin.format}}
            >
              {{! A preview, not the card: nothing in it takes focus or
                  input, so an edit-format pin can't be typed into here. }}
              <span class='pin-render' inert>
                {{#if (eq pin.format 'edit')}}
                  <HydratableCard
                    @cardId={{pin.cardId}}
                    @format='edit'
                    @overlays={{false}}
                  />
                {{else}}
                  <SearchResults
                    @query={{this.queryFor pin}}
                    @mode='none'
                    @overlays={{false}}
                    as |results|
                  >
                    {{#each results.entries key='id' as |entry|}}
                      <entry.component />
                    {{/each}}
                  </SearchResults>
                {{/if}}
              </span>
            </button>
          {{/each}}
        </div>
      </div>
    {{/if}}

    <style scoped>
      .collage {
        --collage-zoom: 0.5;
        position: relative;
        min-height: 0;
        /* The space between cards belongs to the wallpaper underneath, which
           opens the workspace; only the cards themselves take clicks. */
        pointer-events: none;
      }
      /* Everything inside is in design pixels; one zoom fits it to the tile. */
      .canvas {
        position: absolute;
        top: 0;
        left: 0;
        width: var(--canvas-width);
        height: var(--canvas-height, 100%);
        display: grid;
        gap: 18px;
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr);
        transform: scale(var(--collage-zoom));
        transform-origin: 0 0;
      }
      /* Each count gets an arrangement with a lead card, so the tile reads as
         a collage rather than a grid of equals. */
      .shape-two {
        grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
      }
      .shape-three {
        grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
        grid-template-rows: repeat(2, minmax(0, 1fr));
      }
      .shape-three > .pin:first-child {
        grid-row: 1 / span 2;
      }
      .shape-four {
        grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr);
        grid-template-rows: repeat(2, minmax(0, 1fr));
      }
      .shape-four > .pin:nth-child(1) {
        grid-row: 1 / span 2;
      }
      .shape-four > .pin:nth-child(2) {
        grid-column: 2 / span 2;
      }
      .pin {
        --page-zoom: 0.5;
        position: relative;
        min-width: 0;
        min-height: 0;
        padding: 0;
        border: 0;
        border-radius: 18px;
        overflow: hidden;
        background-color: var(--boxel-light);
        /* A soft contact shadow: the cards rest on the dimmed wallpaper
           rather than float above it. */
        box-shadow:
          0 2px 6px color-mix(in oklch, var(--boxel-dark) 14%, transparent),
          0 1px 0 color-mix(in oklch, var(--boxel-light) 6%, transparent) inset;
        text-align: left;
        cursor: pointer;
        pointer-events: auto;
        transition: transform var(--boxel-transition);
      }
      .pin:hover {
        transform: translateY(-4px);
      }
      .pin:focus-visible {
        outline: 4px solid var(--boxel-highlight);
        outline-offset: 4px;
      }
      /* The frame owns the corner radius, so every card keeps the same
         radius whatever its own template paints. */
      .pin-render {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .format-fitted .pin-render {
        container-name: fitted-card;
        container-type: size;
      }
      .format-fitted .pin-render > :deep(*) {
        width: 100%;
        height: 100%;
      }
      .format-embedded .pin-render,
      .format-isolated .pin-render,
      .format-edit .pin-render {
        inset: 0 auto auto 0;
        width: var(--page-width);
        transform: scale(var(--page-zoom));
        transform-origin: 0 0;
      }
      @media (prefers-reduced-motion: reduce) {
        .pin {
          transition: none;
        }
        .pin:hover {
          transform: none;
        }
      }
    </style>
  </template>
}

const canvasWidthCss = () => `${CANVAS_WIDTH_PX}px`;
const formatClass = (format: DashboardPinFormat) => `format-${format}`;
const shapeClass = (shape: string) => `shape-${shape}`;
