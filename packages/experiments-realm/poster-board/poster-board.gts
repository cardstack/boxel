import {
  CardDef,
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
  getRelationshipMembershipState,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { get } from '@ember/helper';
import { on } from '@ember/modifier';
import Modifier from 'ember-modifier';
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

// Cards without a persisted frame setting flow into a fixed grid.
function defaultPlacement(index: number): TilePlacement {
  return {
    index,
    x: GRID_PADDING + (index % GRID_COLUMNS) * (TILE_WIDTH + TILE_GAP),
    y:
      GRID_PADDING +
      Math.floor(index / GRID_COLUMNS) * (TILE_HEIGHT + TILE_GAP),
  };
}

export class FrameSettingsField extends FieldDef {
  static displayName = 'Frame Settings';

  @field cardIndex = contains(NumberField);
  @field x = contains(NumberField);
  @field y = contains(NumberField);
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

class Isolated extends Component<typeof PosterBoard> {
  rig = new RigState();
  surfaceRig = new SurfaceRig(this.rig);

  @tracked isPanning = false;
  private panSession: PanSession | null = null;
  private activePointerId: number | null = null;
  private rootElement: HTMLElement | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

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

  get tilePlacements(): TilePlacement[] {
    let cards = this.args.model?.cards ?? [];
    let settings = this.args.model?.frameSettings ?? [];
    return cards.map((_card, index) => {
      let setting = settings.find((s) => Number(s.cardIndex) === index);
      // Number() guards against non-numeric values in hand-edited JSON
      let x = Number(setting?.x);
      let y = Number(setting?.y);
      if (setting && Number.isFinite(x) && Number.isFinite(y)) {
        return { index, x, y };
      }
      return defaultPlacement(index);
    });
  }

  get hasCards() {
    return this.tilePlacements.length > 0;
  }

  // Terminal failures (error / not-found) per cards slot, index-aligned with
  // tilePlacements. Indexed access via (get @fields.cards i) bypasses the
  // linksToMany renderer's broken-slot branch, so the board renders the
  // placeholder itself instead of a blank tile.
  brokenSlotAt = (index: number) => {
    let owner = this.args.model as unknown as PosterBoard | undefined;
    if (!owner) {
      return undefined;
    }
    let { membership } = getRelationshipMembershipState(owner, 'cards');
    let rel = (membership ?? [])[index];
    return rel && (rel.kind === 'error' || rel.kind === 'not-found')
      ? rel
      : undefined;
  };

  tileStyle = (tile: TilePlacement) =>
    htmlSafe(`left: ${tile.x}px; top: ${tile.y}px;`);

  // ── Wheel ──────────────────────────────────────────────

  handleWheel = (event: Event) => {
    this.surfaceRig.handleWheel(event as WheelEvent);
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
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
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

  handleKeyDown = (event: KeyboardEvent) => {
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
    this.keydownHandler = this.handleKeyDown;
    window.addEventListener('keydown', this.keydownHandler);
  };

  willDestroy(): void {
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
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
      data-test-poster-board
    >
      <div class='poster-board-plane' style={{this.planeStyle}}>
        <div class='poster-board-grid' aria-hidden='true'></div>
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
                {{#let (get @fields.cards tile.index) as |LinkedCard|}}
                  <LinkedCard @format='fitted' />
                {{/let}}
              {{/if}}
            {{/let}}
          </FittedCardContainer>
        {{/each}}
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
        touch-action: none;
        min-width: 0;
      }

      .poster-board-plane {
        will-change: transform;
      }

      .poster-board-tile {
        position: absolute;
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

  @field cards = linksToMany(() => CardDef);
  @field frameSettings = containsMany(FrameSettingsField);

  static isolated = Isolated;
}
