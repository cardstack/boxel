// Pretui — Gallery: a keyboard-navigable grid of media with an optional selection.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { Button } from './button';
import { focusWhen, listen, rovingTabindex } from '../focus';
import { MediaViewer } from './media-viewer';
import { resolveAsset } from '../internal/media-viewer';
import type { AssetKind, MediaAssetSpec, ResolvedMediaAsset } from '../internal/media-viewer';
import { formatClock } from '../internal/reading-format';
import { cssDeclaration, cssStyle, cssStyleFrom } from '../pretui-css';
import { EmptyState } from './empty-state';
import { FALLBACK_RATIO, KIND_WORD } from '../internal/media-library';

// ═══════════════════════════════════════════════════════════════════════
// Shared vocabulary
// ═══════════════════════════════════════════════════════════════════════

/** A text glyph per kind. Text, therefore greyscale-proof and legible in a
 * still frame — Law 8's screenshot test applied to iconography. */
const KIND_GLYPH: Readonly<Record<AssetKind, string>> = {
  image: '▣',
  video: '▶',
  audio: '∿',
  model: '◈',
  unknown: '?',
};

/**
 * Every index between two, inclusive, in ascending order.
 *
 * Exported and pure because range selection is the gesture most often
 * half-implemented: a Shift-click that only ever extends downward, or one
 * that forgets the anchor the moment the list re-renders. It is four lines
 * and it is checkable without a browser.
 */
export function rangeBetween(a: number, b: number): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) {
    out.push(i);
  }
  return out;
}

/**
 * Brings an element into view on the render where it BECAME the cursor.
 *
 * `block: 'nearest'` is load-bearing: the default (`'start'`) scrolls the
 * whole PAGE to put a rail cell at the top of the window, which is the
 * behaviour that makes "scroll the thumbnail into view" feel broken in most
 * implementations. There is no timer and nothing to clean up — a modifier
 * runs after the render transaction, which is exactly when the element's box
 * is real.
 */
const revealWhen = modifier((el: HTMLElement, [should]: [boolean]) => {
  if (should) {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Gallery
// ═══════════════════════════════════════════════════════════════════════

export type GalleryFit = 'intrinsic' | 'cover' | 'contain';
export type GallerySelectionMode = 'none' | 'single' | 'multi';

/** One rail cell, derived once so the template stays declarative. */
interface GalleryCell {
  index: number;
  key: string;
  asset: ResolvedMediaAsset;
  glyph: string;
  kindWord: string;
  clock: string;
  active: boolean;
  selected: boolean;
  tabStop: boolean;
  takesFocus: boolean;
  name: string;
  thumb: string | undefined;
  style: ReturnType<typeof cssStyle>;
}

export interface GallerySignature {
  Args: {
    /** The set, in display order. */
    assets: readonly MediaAssetSpec[];
    /** Controlled active index — what the hero is showing. */
    activeIndex?: number;
    /** Initial active index when uncontrolled. @default 0 */
    defaultActiveIndex?: number;
    /** Fires on every change of the active asset, keyboard or pointer. */
    onActiveChange?: (index: number, asset: ResolvedMediaAsset) => void;

    /** `'none'` (default), `'single'` or `'multi'`. Ranges need `'multi'`. */
    selectionMode?: GallerySelectionMode;
    /** Controlled selection, as indices. */
    selected?: readonly number[];
    /** Initial selection when uncontrolled. */
    defaultSelected?: readonly number[];
    /** Fires with the next selection on every change. */
    onSelectionChange?: (
      indices: number[],
      assets: ResolvedMediaAsset[],
    ) => void;

    /** Fires on Enter and on double-click. This is the path into a viewer:
     * wire it to a `Lightbox`, a `Dialog`, or your own route. Gallery does
     * NOT embed PhotoSwipe — `Lightbox` owns that engine and running two of
     * them over one set is how focus restoration breaks. */
    onOpen?: (index: number, asset: ResolvedMediaAsset) => void;

    /** Accessible name for the rail. @default 'Gallery' */
    label?: string;
    /** Show the hero stage. @default true */
    showHero?: boolean;
    /** Aspect ratio reserved for the hero. Defaults to the active asset's
     * own, then 4 / 3. */
    ratio?: string;
    /** Rail cell height in px. @default 64 */
    thumbHeight?: number;
    /** `'intrinsic'` (default) keeps each cell's own aspect ratio at a
     * shared height, so a panorama still reads as a panorama; `'cover'`
     * locks every cell to `@cellRatio` and crops; `'contain'` locks and
     * letterboxes. */
    cellFit?: GalleryFit;
    /** Locked cell ratio for `'cover'` / `'contain'`. @default '4 / 3' */
    cellRatio?: string;
    /** Show the "3 of 8" counter and the step buttons above the hero.
     * @default true */
    showCounter?: boolean;
  };
  Blocks: {
    /** Replaces the hero. Receives the active asset. */
    hero: [ResolvedMediaAsset];
    /** Rendered over the hero — captions, actions, a buy button. */
    overlay: [ResolvedMediaAsset];
    /** Replaces the built-in empty state. */
    empty: [];
  };
  Element: HTMLDivElement;
}

/**
 * A hero stage plus a rail, over a known set.
 *
 * Distinct from `Carousel` (a rotating band, time-driven) and from
 * `AssetGrid` (a wrapping shelf, data-driven): a gallery is EXPLICIT
 * thumb-navigation. You can see the whole set and you choose from it. That
 * is why there is no autoplay here and never will be — the rail is the
 * control, and a set that advances itself has taken the control away.
 *
 * The rail is a real listbox and carries the full APG contract: one tab
 * stop, arrows within, Home/End, Space to toggle, Enter to open,
 * Shift+Arrow and Shift+Click for a range, Ctrl/Cmd+A for all. Every
 * pointer gesture in that list has the keyboard gesture beside it, which is
 * the acceptance test the four catalog implementations all failed.
 *
 * The face/overlay split in the markup is not decoration: realm lint's
 * `require-presentational-children` errors on ANY element inside a
 * `role='option'` that is not a span or a div — `<img>` included — so the
 * visible cell is `aria-hidden` and pointer-transparent, and a bare option
 * div covers it. The option's accessible name is therefore computed, which
 * is strictly better than scraping it out of a subtree.
 */
export class Gallery extends Component<GallerySignature> {
  @tracked private ownActive: number | undefined = undefined;
  @tracked private ownSelected: number[] | undefined = undefined;
  /** Where a Shift-range starts. Held separately from the active index so a
   * range extends from where the reader began, not from wherever the cursor
   * last landed — the bug in every half-built range implementation. */
  @tracked private anchor = 0;
  /** True only while the keyboard is driving, so `focusWhen` never steals
   * focus on a plain re-render or a pointer click. */
  @tracked private navigating = false;

  // ── data ───────────────────────────────────────────────────────────────

  get assets(): readonly ResolvedMediaAsset[] {
    return (this.args.assets ?? []).map((spec) => resolveAsset(spec));
  }
  get count(): number {
    return this.assets.length;
  }
  get hasAssets(): boolean {
    return this.count > 0;
  }
  get label(): string {
    return this.args.label ?? 'Gallery';
  }
  get showHero(): boolean {
    return (this.args.showHero ?? true) && this.hasAssets;
  }
  get showCounter(): boolean {
    return (this.args.showCounter ?? true) && this.hasAssets;
  }
  get fit(): GalleryFit {
    return this.args.cellFit ?? 'intrinsic';
  }
  get mode(): GallerySelectionMode {
    return this.args.selectionMode ?? 'none';
  }
  get multi(): boolean {
    return this.mode === 'multi';
  }
  get multiAttr(): 'true' | undefined {
    return this.multi ? 'true' : undefined;
  }

  private clamp(index: number): number {
    if (this.count === 0) {
      return 0;
    }
    return Math.max(0, Math.min(this.count - 1, index));
  }

  get activeIndex(): number {
    const raw =
      this.args.activeIndex ?? this.ownActive ?? this.args.defaultActiveIndex;
    return this.clamp(typeof raw === 'number' ? raw : 0);
  }

  get activeAsset(): ResolvedMediaAsset | undefined {
    return this.assets[this.activeIndex];
  }

  get selectedIndices(): readonly number[] {
    if (this.mode === 'none') {
      return [];
    }
    const raw =
      this.args.selected ?? this.ownSelected ?? this.args.defaultSelected ?? [];
    return raw;
  }

  private isSelected(index: number): boolean {
    return this.selectedIndices.indexOf(index) !== -1;
  }

  get counterText(): string {
    return this.activeIndex + 1 + ' of ' + this.count;
  }

  get heroStyle() {
    return cssStyle(
      '--pretui-gallery-hero-aspect',
      this.args.ratio ?? this.activeAsset?.aspectRatio ?? FALLBACK_RATIO,
    );
  }

  /** Two knobs, not one: the caller's height AND the height a narrow pane
   * falls back to. Deriving the narrow value here rather than hardcoding it
   * in the container query is what keeps `@thumbHeight` meaningful at every
   * width — a query that overwrites the caller's number is a component
   * ignoring its own argument. */
  get railStyle() {
    const height = Math.max(32, Math.round(this.args.thumbHeight ?? 64));
    const narrow = Math.max(32, Math.round(height * 0.72));
    return cssStyleFrom([
      cssDeclaration('--pretui-gallery-thumb', height + 'px'),
      cssDeclaration('--pretui-gallery-thumb-narrow', narrow + 'px'),
    ]);
  }

  get cells(): GalleryCell[] {
    const active = this.activeIndex;
    const locked = this.args.cellRatio ?? FALLBACK_RATIO;
    return this.assets.map((asset, index) => {
      const ratio =
        this.fit === 'intrinsic'
          ? (asset.aspectRatio ?? FALLBACK_RATIO)
          : locked;
      return {
        index,
        key: asset.src + '#' + index,
        asset,
        glyph: KIND_GLYPH[asset.kind],
        kindWord: KIND_WORD[asset.kind],
        clock: asset.duration ? formatClock(asset.duration) : '',
        active: index === active,
        selected: this.isSelected(index),
        tabStop: index === active,
        takesFocus: index === active && this.navigating,
        name: asset.label,
        thumb: asset.thumbnail ?? asset.poster ?? asset.src,
        style: cssStyle('--pretui-gallery-cell-aspect', ratio),
      };
    });
  }

  /** The option's accessible name, computed rather than scraped. The source
   * shipped `aria-label='Show this image'` on every thumb, which is the same
   * as no label at all once there are two of them. */
  nameFor = (cell: GalleryCell): string => {
    const bits = [cell.name, cell.kindWord];
    if (cell.clock) {
      bits.push(cell.clock);
    }
    bits.push(cell.index + 1 + ' of ' + this.count);
    return bits.join(', ');
  };

  // ── state writes ───────────────────────────────────────────────────────

  private setActive(index: number, keyboard: boolean): void {
    const next = this.clamp(index);
    this.navigating = keyboard;
    if (this.args.activeIndex === undefined) {
      this.ownActive = next;
    }
    const asset = this.assets[next];
    if (asset) {
      this.args.onActiveChange?.(next, asset);
    }
  }

  private setSelection(indices: number[]): void {
    const unique = Array.from(new Set(indices))
      .filter((i) => i >= 0 && i < this.count)
      .sort((a, b) => a - b);
    if (this.args.selected === undefined) {
      this.ownSelected = unique;
    }
    this.args.onSelectionChange?.(
      unique,
      unique.map((i) => this.assets[i]).filter(Boolean),
    );
  }

  /** Plain click / Enter: this one, alone. */
  private selectOnly(index: number): void {
    if (this.mode === 'none') {
      return;
    }
    this.anchor = index;
    this.setSelection([index]);
  }

  /** Space / Ctrl-click: add or remove, leaving the rest alone. */
  private toggleAt(index: number): void {
    if (this.mode === 'none') {
      return;
    }
    if (!this.multi) {
      this.selectOnly(index);
      return;
    }
    this.anchor = index;
    const current = this.selectedIndices.slice();
    const at = current.indexOf(index);
    if (at === -1) {
      current.push(index);
    } else {
      current.splice(at, 1);
    }
    this.setSelection(current);
  }

  /** Shift-click / Shift-arrow: everything from the anchor to here. */
  private extendTo(index: number): void {
    if (!this.multi) {
      this.selectOnly(index);
      return;
    }
    this.setSelection(rangeBetween(this.anchor, index));
  }

  private openAt(index: number): void {
    const asset = this.assets[index];
    if (asset) {
      this.args.onOpen?.(index, asset);
    }
  }

  // ── pointer ────────────────────────────────────────────────────────────

  private indexFromEvent(event: Event): number {
    // duck-typed, not instanceof: the event target may come from another realm
    const target = event.target as Element | null;
    const hit = target?.closest?.('[data-gallery-index]');
    if (!hit) {
      return -1;
    }
    const raw = hit.getAttribute('data-gallery-index');
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? -1 : parsed;
  }

  onRailClick = (event: Event): void => {
    const index = this.indexFromEvent(event);
    if (index < 0) {
      return;
    }
    const mouse = event as MouseEvent;
    this.setActive(index, false);
    if (mouse.shiftKey) {
      this.extendTo(index);
    } else if (mouse.metaKey || mouse.ctrlKey) {
      this.toggleAt(index);
    } else {
      this.selectOnly(index);
    }
  };

  onRailDblClick = (event: Event): void => {
    const index = this.indexFromEvent(event);
    if (index >= 0) {
      this.openAt(index);
    }
  };

  // ── keyboard ───────────────────────────────────────────────────────────

  // Typed `Event`, not `KeyboardEvent`: a delegated listener's handler is
  // `(event: Event) => void`, so the narrowing happens once, here.
  onRailKeydown = (raw: Event): void => {
    const event = raw as KeyboardEvent;
    const index = this.indexFromEvent(event);
    if (index < 0) {
      return;
    }
    const last = this.count - 1;
    const shift = event.shiftKey;
    let next = index;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = Math.min(last, index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = Math.max(0, index - 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      case ' ':
        event.preventDefault();
        this.toggleAt(index);
        return;
      case 'Enter':
        event.preventDefault();
        this.selectOnly(index);
        this.openAt(index);
        return;
      case 'a':
      case 'A':
        if ((event.metaKey || event.ctrlKey) && this.multi) {
          event.preventDefault();
          this.setSelection(rangeBetween(0, last));
        }
        return;
      default:
        return;
    }
    event.preventDefault();
    this.setActive(next, true);
    if (shift) {
      this.extendTo(next);
    }
  };

  // aria-disabled at the ends rather than native disabled, so the button that
  // reaches an end keeps focus; the press is ignored here instead
  stepBack = (): void => {
    if (!this.atStart) this.setActive(this.activeIndex - 1, false);
  };
  stepOn = (): void => {
    if (!this.atEnd) this.setActive(this.activeIndex + 1, false);
  };
  get atStart(): boolean {
    return this.activeIndex <= 0;
  }
  get atEnd(): boolean {
    return this.activeIndex >= this.count - 1;
  }

  <template>
    <div
      class='pretui-gallery'
      data-fit={{this.fit}}
      style={{this.railStyle}}
      data-test-pretui-gallery
      ...attributes
    >
      {{#if this.hasAssets}}
        {{#if this.showCounter}}
          <div class='pretui-gallery-bar'>
            <Button
              @tone='neutral'
              @appearance='plain'
              @size='s'
              aria-disabled={{if this.atStart 'true'}}
              aria-label='Previous asset'
              {{on 'click' this.stepBack}}
              data-test-pretui-gallery-prev
            >←</Button>
            <span class='pretui-gallery-count'>{{this.counterText}}</span>
            <Button
              @tone='neutral'
              @appearance='plain'
              @size='s'
              aria-disabled={{if this.atEnd 'true'}}
              aria-label='Next asset'
              {{on 'click' this.stepOn}}
              data-test-pretui-gallery-next
            >→</Button>
          </div>
        {{/if}}

        {{#if this.showHero}}
          {{#if this.activeAsset}}
            <div
              class='pretui-gallery-stage'
              style={{this.heroStyle}}
              data-test-pretui-gallery-hero
            >
              {{#if (has-block 'hero')}}
                {{yield this.activeAsset to='hero'}}
              {{else}}
                <MediaViewer @asset={{this.activeAsset}} />
              {{/if}}
              {{#if (has-block 'overlay')}}
                <div class='pretui-gallery-over'>
                  {{yield this.activeAsset to='overlay'}}
                </div>
              {{/if}}
            </div>
          {{/if}}
        {{/if}}

        <div
          class='pretui-gallery-rail'
          role='listbox'
          aria-label={{this.label}}
          aria-multiselectable={{this.multiAttr}}
          data-test-pretui-gallery-rail
          {{listen 'click' this.onRailClick}}
          {{listen 'dblclick' this.onRailDblClick}}
          {{listen 'keydown' this.onRailKeydown}}
        >
          {{#each this.cells key='key' as |cell|}}
            <div
              class='pretui-gallery-cell'
              role='presentation'
              style={{cell.style}}
              data-active={{if cell.active 'true'}}
              data-selected={{if cell.selected 'true'}}
              {{revealWhen cell.active}}
            >
              <span class='pretui-gallery-face' aria-hidden='true'>
                {{#if cell.thumb}}
                  <img
                    class='pretui-gallery-img'
                    src={{cell.thumb}}
                    alt=''
                    loading='lazy'
                    decoding='async'
                  />
                {{/if}}
                <span class='pretui-gallery-kind'>{{cell.glyph}}</span>
                {{#if cell.clock}}
                  <span class='pretui-gallery-clock'>{{cell.clock}}</span>
                {{/if}}
                <span class='pretui-gallery-check'>✓</span>
              </span>
              <div
                class='pretui-gallery-hit'
                role='option'
                aria-selected={{if cell.selected 'true' 'false'}}
                aria-label={{this.nameFor cell}}
                data-gallery-index={{cell.index}}
                data-test-pretui-gallery-cell
                {{rovingTabindex cell.tabStop}}
                {{focusWhen cell.takesFocus}}
              ></div>
            </div>
          {{/each}}
        </div>
      {{else if (has-block 'empty')}}
        {{yield to='empty'}}
      {{else}}
        <EmptyState
          @title='Nothing in this gallery'
          @message='No assets were passed to it. Hand it a set and the rail will fill.'
        />
      {{/if}}
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-gallery {
          --pretui-gallery-thumb: 64px;
          --pretui-gallery-thumb-narrow: 46px;
          --pretui-gallery-hero-aspect: 4 / 3;
          display: grid;
          gap: var(--space-3, 8px);
          min-width: 0;
          /* A card knows its pane, not the viewport. UNNAMED, always: a named
             container silently deletes every CSS rule after it. */
          container-type: inline-size;
        }

        .pretui-gallery-bar {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-3, 8px);
          min-width: 0;
        }
        .pretui-gallery-count {
          font-size: var(--text-ui-sm, 11.5px);
          /* Tabular so "9 of 12" does not shift the arrows when it becomes
             "10 of 12". */
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground);
        }

        .pretui-gallery-stage {
          position: relative;
          display: grid;
          place-items: center;
          /* Reserved before the asset arrives. */
          aspect-ratio: var(--pretui-gallery-hero-aspect);
          overflow: hidden;
          min-width: 0;
          border-radius: var(--radius-surface, 12px);
          background: color-mix(
            in oklch,
            var(--foreground) 6%,
            var(--card)
          );
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        }
        .pretui-gallery-stage > * {
          max-width: 100%;
          max-height: 100%;
          min-width: 0;
        }
        .pretui-gallery-over {
          position: absolute;
          inset-inline: 0;
          inset-block-end: 0;
          display: flex;
          align-items: center;
          gap: var(--space-2, 6px);
          padding: var(--space-3, 8px);
          color: var(--pretui-on-neutral, var(--boxel-light));
          background: linear-gradient(
            to top,
            color-mix(in oklch, var(--foreground) 74%, transparent),
            transparent
          );
        }

        .pretui-gallery-rail {
          display: flex;
          gap: var(--space-2, 6px);
          min-width: 0;
          padding: 3px;
          overflow-x: auto;
          overflow-y: hidden;
          scroll-padding-inline: 12px;
          /* A rail is a scroll region; give it a stop per cell so a flick
             lands on a thumbnail rather than between two. */
          scroll-snap-type: inline proximity;
        }
        .pretui-gallery-cell {
          --pretui-gallery-cell-aspect: 4 / 3;
          position: relative;
          flex: 0 0 auto;
          height: var(--pretui-gallery-thumb);
          /* THE intrinsic rail: a shared height, the picture's own width. A
             locked ratio letterboxes every panorama into a square and throws
             away the one thing a thumbnail is for. */
          aspect-ratio: var(--pretui-gallery-cell-aspect);
          scroll-snap-align: center;
        }
        .pretui-gallery-face {
          position: relative;
          z-index: 1;
          display: block;
          width: 100%;
          height: 100%;
          overflow: hidden;
          border-radius: var(--radius-sm, 6px);
          /* Transparent to the pointer so every click, hover and focus lands
             on the option beneath. */
          pointer-events: none;
          background: color-mix(
            in oklch,
            var(--foreground) 8%,
            var(--card)
          );
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        }
        .pretui-gallery-img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .pretui-gallery[data-fit='contain'] .pretui-gallery-img {
          object-fit: contain;
        }
        .pretui-gallery-kind {
          position: absolute;
          inset-block-start: 3px;
          inset-inline-start: 3px;
          display: grid;
          place-items: center;
          min-width: 15px;
          height: 15px;
          padding: 0 3px;
          border-radius: 999px;
          font-size: 9px;
          line-height: 1;
          color: var(--pretui-on-neutral, var(--boxel-light));
          background: color-mix(
            in oklch,
            var(--foreground) 70%,
            transparent
          );
        }
        .pretui-gallery-clock {
          position: absolute;
          inset-block-end: 3px;
          inset-inline-end: 3px;
          padding: 0 3px;
          border-radius: 3px;
          font-size: 9px;
          font-variant-numeric: tabular-nums;
          color: var(--pretui-on-neutral, var(--boxel-light));
          background: color-mix(
            in oklch,
            var(--foreground) 70%,
            transparent
          );
        }
        /* Selection: a glyph, a ring and aria-selected. Three channels, one of
           them shape — never colour alone. */
        .pretui-gallery-check {
          position: absolute;
          inset-block-start: 3px;
          inset-inline-end: 3px;
          display: none;
          place-items: center;
          width: 15px;
          height: 15px;
          border-radius: 999px;
          font-size: 10px;
          line-height: 1;
          color: var(--primary-foreground);
          background: var(--primary);
        }
        .pretui-gallery-cell[data-selected='true'] .pretui-gallery-check {
          display: grid;
        }
        .pretui-gallery-cell[data-selected='true'] .pretui-gallery-face {
          box-shadow:
            0 0 0 2px var(--primary),
            0 0 0 4px
              color-mix(in oklch, var(--primary) 22%, transparent);
        }
        /* Active is the CURSOR, not the selection — a different channel again:
           a solid underline bar rather than a ring. */
        .pretui-gallery-cell[data-active='true'] .pretui-gallery-face {
          outline: 2px solid
            color-mix(in oklch, var(--foreground) 62%, transparent);
          outline-offset: 1px;
        }

        .pretui-gallery-hit {
          position: absolute;
          inset: -2px;
          z-index: 0;
          border-radius: calc(var(--radius-sm, 6px) + 2px);
          cursor: pointer;
        }
        .pretui-gallery-hit:hover {
          background: var(
            --hover,
            color-mix(in oklch, var(--foreground) 8%, transparent)
          );
        }
        .pretui-gallery-hit:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }

        /* An unnamed query resolves against the nearest ANCESTOR container, so
           it can never match the container element itself — the fallback is
           declared on the rail, and the cells inherit it. */
        @container (max-width: 380px) {
          .pretui-gallery-rail {
            --pretui-gallery-thumb: var(--pretui-gallery-thumb-narrow, 46px);
          }
        }
        /* 44px is the coarse-pointer floor; the hit box grows rather than the
           picture, so a small rail stays tappable without redesigning. */
        @media (any-pointer: coarse) {
          .pretui-gallery-hit {
            inset: -6px;
          }
          .pretui-gallery-rail {
            gap: var(--space-3, 8px);
          }
        }
      }
    </style>
  </template>
}
