import {
  CardDef,
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
  getRelationshipMembershipState,
  linksTo,
  resolveInstanceURL,
  resolveRef,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { on } from '@ember/modifier';
import Modifier from 'ember-modifier';
import {
  searchEntryWireQueryFromQuery,
  type ErrorEntry,
  type RenderableSearchEntryLike,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';
import {
  BrokenLinkTemplate,
  FittedCardContainer,
} from '@cardstack/boxel-ui/components';
import { fittedFormatById } from '@cardstack/boxel-ui/helpers';
import LayoutDashboardIcon from '@cardstack/boxel-icons/layout-dashboard';
import { RigState, SurfaceRig, type PanSession } from './rig';

// Tiles use the shared cardsgrid-tile fitted size so boards show cards at a
// size their fitted views are designed for. FittedCardContainer applies the
// dimensions; these constants drive the grid placement math.
const cardsgridTile = fittedFormatById.get('cardsgrid-tile')!;
const TILE_WIDTH = cardsgridTile.width;
const TILE_HEIGHT = cardsgridTile.height;
const TILE_GAP = 32;
const GRID_COLUMNS = 4;
// Breathing room between the world origin and the default grid (~--boxel-sp-xs)
const GRID_PADDING = 10;

interface TilePlacement {
  index: number;
  x: number;
  y: number;
}

// Cards without a persisted position flow into a fixed grid, `slot` being
// their ordinal among the board's placed tiles.
function gridSlot(slot: number): Pick<TilePlacement, 'x' | 'y'> {
  return {
    x: GRID_PADDING + (slot % GRID_COLUMNS) * (TILE_WIDTH + TILE_GAP),
    y:
      GRID_PADDING + Math.floor(slot / GRID_COLUMNS) * (TILE_HEIGHT + TILE_GAP),
  };
}

// A persisted coordinate, or undefined when the tile has never been placed.
// Unset number fields serialize as null, and Number(null) is 0 — so null and
// non-numeric values from hand-edited JSON both count as "not placed".
function coordinate(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  let n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// One tile on the board: the card it shows and where it sits. Keeping the
// link and its position on the same element means a position can never drift
// from its card when tiles are added, removed, or reordered.
export class BoardTile extends FieldDef {
  static displayName = 'Board Tile';

  @field card = linksTo(() => CardDef);
  @field x = contains(NumberField);
  @field y = contains(NumberField);
}

// A tile's link state, read from the relationship membership state — a pure
// read that never triggers the lazy link load, so the board renders tiles
// without ever fetching the linked instances.
function tileLinkState(tile: BoardTile) {
  return getRelationshipMembershipState(tile as unknown as CardDef, 'card')
    .membership?.[0];
}

interface OnInsertSignature {
  Element: HTMLElement;
  Args: {
    Positional: [(el: HTMLElement) => void];
  };
}

class OnInsert extends Modifier<OnInsertSignature> {
  modify(el: HTMLElement, [callback]: [(el: HTMLElement) => void]) {
    callback(el);
  }
}

// A wheel gesture over content that can still scroll in that direction (an
// error panel, a card with its own scroller) belongs to that content, not to
// the canvas. Walks from the event target up to the board root.
function wheelTargetsScrollable(event: WheelEvent): boolean {
  const root = event.currentTarget as Element | null;
  // Synthetic wheel events may omit one delta; treat it as no movement.
  const deltaX = event.deltaX || 0;
  const deltaY = event.deltaY || 0;
  const vertical = Math.abs(deltaY) >= Math.abs(deltaX);
  let el = event.target instanceof Element ? event.target : null;
  while (el && el !== root) {
    if (vertical ? canScroll(el, 'y', deltaY) : canScroll(el, 'x', deltaX)) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

function canScroll(el: Element, axis: 'x' | 'y', delta: number): boolean {
  const style = getComputedStyle(el);
  const overflow = axis === 'y' ? style.overflowY : style.overflowX;
  if (overflow !== 'auto' && overflow !== 'scroll') {
    return false;
  }
  const size = axis === 'y' ? el.clientHeight : el.clientWidth;
  const extent = axis === 'y' ? el.scrollHeight : el.scrollWidth;
  const offset = axis === 'y' ? el.scrollTop : el.scrollLeft;
  if (extent <= size) {
    return false;
  }
  return delta > 0 ? offset + size < extent - 1 : offset > 0;
}

// Wheel events inside one trackpad gesture (inertia included) arrive every
// frame; a gap this long means a new gesture began.
const WHEEL_GESTURE_GAP_MS = 150;

class Isolated extends Component<typeof PosterBoard> {
  rig = new RigState();
  surfaceRig = new SurfaceRig(this.rig);

  @tracked isPanning = false;
  private panSession: PanSession | null = null;
  private activePointerId: number | null = null;
  private rootElement: HTMLElement | null = null;
  private lastContentWheelTime = -Infinity;

  get zoomLabel() {
    return Math.round(this.rig.magnify * 100) + '%';
  }

  get planeStyle() {
    const r = this.rig;
    return htmlSafe(
      `transform: scale(${r.magnify}) translate(${r.worldX}px, ${r.worldY}px); transform-origin: 0 0;`,
    );
  }

  get rootStyle() {
    return htmlSafe(`cursor: ${this.isPanning ? 'grabbing' : 'grab'};`);
  }

  // ── Tile placement ─────────────────────────────────────

  get tiles(): BoardTile[] {
    let owner = this.args.model as unknown as PosterBoard | undefined;
    return owner?.tiles ?? [];
  }

  // The tiles' card reference URLs, index-aligned with `tiles`; only a
  // `not-set` link lacks a reference. Relative wire references are resolved
  // against the board's URL so they address the index like absolute ones.
  get linkedRefs(): (string | undefined)[] {
    let relativeTo = this.args.model?.id;
    return this.tiles.map((tile) => {
      let ref = tileLinkState(tile)?.reference;
      return ref === undefined ? undefined : resolveRef(ref, relativeTo);
    });
  }

  // A tile whose link was cleared renders nothing, so it holds no grid slot
  // either: unpositioned tiles flow into the grid in linked order, and clearing
  // a link reflows them the same way removing the tile does.
  get tilePlacements(): TilePlacement[] {
    let refs = this.linkedRefs;
    let placements: TilePlacement[] = [];
    this.tiles.forEach((tile, index) => {
      if (refs[index] === undefined) {
        return;
      }
      let x = coordinate(tile.x);
      let y = coordinate(tile.y);
      placements.push(
        x !== undefined && y !== undefined
          ? { index, x, y }
          : { index, ...gridSlot(placements.length) },
      );
    });
    return placements;
  }

  get hasCards() {
    return this.tilePlacements.length > 0;
  }

  // Tiles render as prerendered fitted HTML addressed by the linked cards'
  // URLs. `fitted` is bound through `htmlQuery` — a bare `eq.format` would be
  // read as an `item.` field path and rejected. Instance index rows key on
  // the `.json` file URL, and `scope: 'cards'` drops each card's dual-indexed
  // file row. Undefined (no tiles with a card) leaves the search idle.
  // References reach card code in canonical RRI form (`@scope/realm/…` for a
  // prefix-mapped realm) while the index keys rows on URLs, so both the query
  // and the entry matching speak the store-resolved URL. The base realm's rows
  // key on its virtual URL, which no client-side resolution reaches; those
  // tiles need the server-side expansion in CS-12744.
  get linkedUrls(): (string | undefined)[] {
    return this.linkedRefs.map((ref) =>
      ref === undefined ? undefined : this.hrefFor(ref),
    );
  }

  hrefFor = (reference: string): string => {
    // `@model` is typed with optional fields, so it needs the same cast
    // `tileLinkState` uses to hand a card to card-api.
    let model = this.args.model as unknown as CardDef | undefined;
    return (model && resolveInstanceURL(model, reference)?.href) ?? reference;
  };

  get tilesQuery(): SearchEntryWireQuery | undefined {
    // Two tiles may show the same card; the index holds one row for it.
    let urls = [
      ...new Set(
        this.linkedUrls.filter((url): url is string => url !== undefined),
      ),
    ];
    if (urls.length === 0) {
      return undefined;
    }
    return {
      ...searchEntryWireQueryFromQuery({}, { scope: 'cards' }),
      cardUrls: urls.map((url) => `${url}.json`),
      filter: { eq: { htmlQuery: { eq: { format: 'fitted' } } } },
    };
  }

  // Results come back in engine order, not linked order, so each tile finds
  // its own entry by resolved URL (`entry.id` is the extensionless card id).
  entryFor = (
    index: number,
    entries: RenderableSearchEntryLike[],
  ): RenderableSearchEntryLike | undefined => {
    let url = this.linkedUrls[index];
    return url
      ? entries.find((entry) => this.hrefFor(entry.id) === url)
      : undefined;
  };

  // Empty string (a `not-set` slot) is falsy, so the template's `{{#if ref}}`
  // guard skips the placeholder for tiles with nothing to point at — glint
  // doesn't narrow in templates, so the fallback keeps the type `string`.
  refAt = (index: number): string => this.linkedRefs[index] ?? '';

  // Terminal failures (error / not-found) per tile, index-aligned with
  // tilePlacements. Since the board never loads its links, membership
  // normally reports `not-loaded`; broken kinds surface here when the links
  // were loaded elsewhere (e.g. the edit format), bringing the real errorDoc
  // with them. Tiles whose entry never arrives fall back to the synthesized
  // not-found placeholder below.
  brokenSlotAt = (index: number) => {
    let tile = this.tiles[index];
    let rel = tile ? tileLinkState(tile) : undefined;
    return rel && (rel.kind === 'error' || rel.kind === 'not-found')
      ? rel
      : undefined;
  };

  // A card can lack an index entry entirely (deleted target, unsaved link, a
  // reference outside the searched realms) — the wire document simply omits
  // it, leaving no errorDoc to thread through.
  missingEntryErrorDoc = {
    status: 404,
    title: 'Not Found',
    message: 'This card has no entry in the search index',
  };

  // A failed search request (network, auth, server) settles with `errors`
  // populated and no entries at all; that is a board-wide failure, not a
  // per-card 404, so every tile reports the search error instead.
  searchErrorDoc = (errors: ErrorEntry[] | undefined) => errors?.[0]?.error;

  tileStyle = (tile: TilePlacement) =>
    htmlSafe(`left: ${tile.x}px; top: ${tile.y}px;`);

  // ── Wheel ──────────────────────────────────────────────

  handleWheel = (event: Event) => {
    const wheel = event as WheelEvent;
    const now = performance.now();
    // Ctrl/Cmd+wheel is a pinch, never a scroll, so it always zooms the board.
    if (
      !(wheel.ctrlKey || wheel.metaKey) &&
      (now - this.lastContentWheelTime < WHEEL_GESTURE_GAP_MS ||
        wheelTargetsScrollable(wheel))
    ) {
      // The gesture belongs to the content for as long as it lasts, as macOS
      // latches a scroll to the scroller it started on. Any canvas momentum
      // still running from earlier wheel events would drift under it.
      this.lastContentWheelTime = now;
      this.surfaceRig.stopAll();
      return;
    }
    this.lastContentWheelTime = -Infinity;
    this.surfaceRig.handleWheel(wheel);
  };

  // ── Pointer pan ────────────────────────────────────────

  handlePointerDown = (rawEvent: Event) => {
    const event = rawEvent as PointerEvent;
    // Primary button only: right/middle-drag isn't a pan, and a context
    // menu can swallow the matching pointerup, wedging the session
    if (event.button !== 0) {
      return;
    }
    // One pan per pointer: a second touch must not hijack a live session
    if (this.panSession) {
      return;
    }
    const target = event.target as HTMLElement;
    // Pointers that start on the HUD or inside a card tile are not pans:
    // capturing them would break the tile's own focus/selection behavior
    // (and tile pointerdown becomes drag-to-move in step 3)
    if (target.closest('[data-poster-board-hud], [data-poster-board-tile]')) {
      return;
    }
    this.panSession = this.surfaceRig.startPan(event.clientX, event.clientY);
    this.activePointerId = event.pointerId;
    this.isPanning = true;
    const root = event.currentTarget as HTMLElement;
    root.setPointerCapture(event.pointerId);
    event.preventDefault();
    // preventDefault suppresses pointerdown's click-to-focus, so focus
    // explicitly — the keydown listener lives on this element
    root.focus();
  };

  handlePointerMove = (rawEvent: Event) => {
    const event = rawEvent as PointerEvent;
    if (event.pointerId !== this.activePointerId) {
      return;
    }
    this.panSession?.move(event.clientX, event.clientY);
  };

  handlePointerUp = (rawEvent: Event) => {
    const event = rawEvent as PointerEvent;
    if (!this.panSession || event.pointerId !== this.activePointerId) {
      return;
    }
    this.panSession.end();
    this.panSession = null;
    this.activePointerId = null;
    this.isPanning = false;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(
        event.pointerId,
      );
    } catch {
      // pointer capture may already be released (e.g. pointercancel)
    }
  };

  // ── Zoom controls ──────────────────────────────────────

  zoomIn = () => {
    this.surfaceRig.zoomCentered(1.2, this.rootElement);
  };

  zoomOut = () => {
    this.surfaceRig.zoomCentered(1 / 1.2, this.rootElement);
  };

  zoom100 = () => {
    this.surfaceRig.zoomCentered(1 / this.rig.magnify, this.rootElement);
  };

  resetView = () => {
    this.surfaceRig.stopAll();
    this.rig.worldX = 0;
    this.rig.worldY = 0;
    this.rig.magnify = 1;
  };

  handleKeyDown = (rawEvent: Event) => {
    const event = rawEvent as KeyboardEvent;
    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }
    // Match the physical key (event.code) — event.key reports the shifted
    // character ('_', ')'), which would make Shift+- and Shift+0 dead.
    // Bail on ctrl/meta/alt so browser zoom (ctrl/cmd+shift+=) stays intact.
    if (event.ctrlKey || event.metaKey || event.altKey || !event.shiftKey) {
      return;
    }
    if (event.code === 'Equal') {
      event.preventDefault();
      this.zoomIn();
    } else if (event.code === 'Minus') {
      event.preventDefault();
      this.zoomOut();
    } else if (event.code === 'Digit0') {
      event.preventDefault();
      this.zoom100();
    }
  };

  // ── Lifecycle ──────────────────────────────────────────

  handleInserted = (el: HTMLElement) => {
    this.rootElement = el;
  };

  willDestroy(): void {
    this.surfaceRig.destroy();
    super.willDestroy();
  }

  <template>
    {{! template-lint-disable no-inline-styles no-pointer-down-event-binding }}
    <div
      class='poster-board-root'
      style={{this.rootStyle}}
      {{OnInsert this.handleInserted}}
      {{on 'wheel' this.handleWheel}}
      {{on 'pointerdown' this.handlePointerDown}}
      {{on 'pointermove' this.handlePointerMove}}
      {{on 'pointerup' this.handlePointerUp}}
      {{on 'pointercancel' this.handlePointerUp}}
      {{on 'keydown' this.handleKeyDown}}
      role='region'
      aria-label='Poster board canvas'
      tabindex='0'
      data-test-poster-board
    >
      <div
        class='poster-board-plane'
        style={{this.planeStyle}}
        data-test-poster-board-plane
      >
        <div class='poster-board-grid' aria-hidden='true'></div>
        {{#let (component @context.searchResultsComponent) as |SearchResults|}}
          {{! Overlays default on: each tile registers with the operator-mode
              overlay layer, giving it the standard hover chrome (type chip,
              options menu, selection, click-to-open) anchored to the tile. }}
          <SearchResults @query={{this.tilesQuery}} @mode='none' as |results|>
            {{#each this.tilePlacements key='index' as |tile|}}
              <FittedCardContainer
                @size='cardsgrid-tile'
                @style={{this.tileStyle tile}}
                class='poster-board-tile'
                data-poster-board-tile
                data-test-poster-board-tile={{tile.index}}
              >
                {{#let (this.brokenSlotAt tile.index) as |broken|}}
                  {{#if broken}}
                    <BrokenLinkTemplate
                      @brokenUrl={{broken.reference}}
                      @errorDoc={{broken.errorDoc}}
                      @state={{broken.kind}}
                      @format='fitted'
                      data-test-poster-board-broken-tile={{tile.index}}
                    />
                  {{else}}
                    {{#let
                      (this.entryFor tile.index results.entries)
                      as |entry|
                    }}
                      {{#if entry}}
                        <entry.component class='poster-board-tile-card' />
                      {{else}}
                        {{#unless results.isLoading}}
                          {{#let (this.refAt tile.index) as |ref|}}
                            {{#if ref}}
                              {{#let
                                (this.searchErrorDoc results.errors)
                                as |searchError|
                              }}
                                {{#if searchError}}
                                  <BrokenLinkTemplate
                                    @brokenUrl={{ref}}
                                    @errorDoc={{searchError}}
                                    @state='error'
                                    @format='fitted'
                                    data-test-poster-board-broken-tile={{tile.index}}
                                  />
                                {{else}}
                                  <BrokenLinkTemplate
                                    @brokenUrl={{ref}}
                                    @errorDoc={{this.missingEntryErrorDoc}}
                                    @state='not-found'
                                    @format='fitted'
                                    data-test-poster-board-broken-tile={{tile.index}}
                                  />
                                {{/if}}
                              {{/let}}
                            {{/if}}
                          {{/let}}
                        {{/unless}}
                      {{/if}}
                    {{/let}}
                  {{/if}}
                {{/let}}
              </FittedCardContainer>
            {{/each}}
          </SearchResults>
        {{/let}}
        {{#unless this.hasCards}}
          <header class='poster-board-hint'>
            <h1 class='poster-board-hint-title'><@fields.cardTitle /></h1>
            <p class='poster-board-hint-line'>Scroll or drag to pan · Pinch or
              Shift + / Shift - to zoom</p>
          </header>
        {{/unless}}
      </div>

      <div
        class='poster-board-hud'
        role='toolbar'
        aria-label='Zoom controls'
        data-poster-board-hud
        data-test-poster-board-hud
      >
        <button
          type='button'
          class='poster-board-hud-btn'
          aria-label='Zoom in'
          {{on 'click' this.zoomIn}}
          data-test-zoom-in
        >+</button>
        <output
          class='poster-board-hud-zoom'
          aria-label='Zoom level'
          data-test-zoom-level
        >{{this.zoomLabel}}</output>
        <button
          type='button'
          class='poster-board-hud-btn'
          aria-label='Zoom out'
          {{on 'click' this.zoomOut}}
          data-test-zoom-out
        >−</button>
        <button
          type='button'
          class='poster-board-hud-btn poster-board-hud-btn-wide'
          {{on 'click' this.zoom100}}
          data-test-zoom-reset
        >100%</button>
        <button
          type='button'
          class='poster-board-hud-btn poster-board-hud-btn-wide'
          {{on 'click' this.resetView}}
          data-test-fit
        >Fit</button>
      </div>
    </div>

    <style scoped>
      .poster-board-root {
        --pb-grid-extent: 625rem;
        --pb-grid-cell-size: 1.5rem;
        --pb-hud-btn-size: 1.625rem;
        --pb-hud-btn-font-size: 0.8125rem;
        --pb-hud-label-font-size: 0.625rem;
        --pb-hud-zoom-min-width: 2.125rem;
        --pb-hud-border-radius: 0.5rem;
        --pb-hud-btn-border-radius: 0.3125rem;
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        /* Scroll a tile's own scroller can't absorb stops here instead of
           chaining to whatever scrolls around the board. */
        overscroll-behavior: contain;
        touch-action: none;
        min-width: 0;
      }

      .poster-board-root:focus {
        outline: none;
      }

      .poster-board-root:focus-visible {
        outline: 2px solid var(--ring, var(--primary));
        outline-offset: -2px;
      }

      .poster-board-plane {
        will-change: transform;
      }

      .poster-board-tile {
        position: absolute;
      }

      /* Tile content is display-only — the overlay layer owns hover/click.
         The overlay binds its listeners to the card's root element, so that
         element must keep receiving pointer events; only the card's own
         controls opt out, so a link or button never intercepts a click, and
         text never starts a selection. Other descendants stay hit-testable so
         a card's own scroller still receives wheel events (see handleWheel).
         `user-select` resolves through the parent, so setting it once on the
         root covers the subtree. */
      .poster-board-tile-card {
        user-select: none;
      }

      .poster-board-tile-card
        :deep(a, button, input, select, textarea, label, [role='button']) {
        pointer-events: none;
      }

      .poster-board-grid {
        position: absolute;
        inset: calc(var(--pb-grid-extent) / -2);
        width: var(--pb-grid-extent);
        height: var(--pb-grid-extent);
        pointer-events: none;
        background-image: radial-gradient(
          circle,
          color-mix(in oklch, var(--muted-foreground) 35%, transparent) 1px,
          transparent 1px
        );
        background-size: var(--pb-grid-cell-size) var(--pb-grid-cell-size);
      }

      .poster-board-hint {
        position: absolute;
        top: 2.5rem;
        left: 2.5rem;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-2xs);
        pointer-events: none;
        user-select: none;
      }

      .poster-board-hint-title {
        margin: 0;
        font-size: var(--boxel-font-size-lg);
        font-weight: 600;
      }

      .poster-board-hint-line {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground);
      }

      .poster-board-hud {
        position: absolute;
        top: var(--boxel-sp-xs);
        right: var(--boxel-sp-xs);
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        padding: var(--boxel-sp-4xs) var(--boxel-sp-2xs);
        background: color-mix(in oklch, var(--card) 88%, transparent);
        color: var(--card-foreground);
        border: 1px solid var(--border);
        border-radius: var(--pb-hud-border-radius);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        box-shadow: 0 0.125rem 0.5rem
          color-mix(in oklch, var(--foreground) 8%, transparent);
        z-index: 10;
        cursor: default;
      }

      .poster-board-hud-btn {
        width: var(--pb-hud-btn-size);
        height: var(--pb-hud-btn-size);
        border: none;
        border-radius: var(--pb-hud-btn-border-radius);
        background: var(--muted);
        color: var(--foreground);
        font-size: var(--pb-hud-btn-font-size);
        font-weight: 700;
        cursor: pointer;
        display: grid;
        place-items: center;
        transition: background 0.12s;
      }

      .poster-board-hud-btn:hover {
        background: var(--border);
      }

      .poster-board-hud-btn-wide {
        width: auto;
        padding: 0 var(--boxel-sp-2xs);
        font-size: var(--pb-hud-label-font-size);
        font-weight: 600;
      }

      .poster-board-hud-zoom {
        display: inline-block;
        min-width: var(--pb-hud-zoom-min-width);
        text-align: center;
        font-size: var(--pb-hud-label-font-size);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
    </style>
  </template>
}

export class PosterBoard extends CardDef {
  static displayName = 'Poster Board';
  static icon = LayoutDashboardIcon;
  static prefersWideFormat = true;

  @field tiles = containsMany(BoardTile);

  static isolated = Isolated;
}
