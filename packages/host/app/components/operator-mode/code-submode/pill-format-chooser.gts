import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { htmlSafe, type SafeString } from '@ember/template';
import { modifier } from 'ember-modifier';

import { formats, type Format } from '@cardstack/runtime-common';

interface Signature {
  Args: {
    format: Format;
    setFormat: (format: Format) => void;
    formats?: Format[];
  };
  Element: HTMLElement;
}

/* Inline canvas measurement (no DOM mutation, no reflow). The same
   pattern as the realm's `pretext-modifier` — a single offscreen
   canvas + per-font cache. Used to size the morphing pill bg's path
   exactly to the label's natural width. */
let _measureCtx: CanvasRenderingContext2D | null = null;
const _measureCache = new Map<string, Map<string, number>>();
function measureWord(text: string, font: string): number {
  let cache = _measureCache.get(font);
  if (!cache) {
    cache = new Map();
    _measureCache.set(font, cache);
  }
  const cached = cache.get(text);
  if (cached !== undefined) return cached;
  if (!_measureCtx) {
    _measureCtx = document.createElement('canvas').getContext('2d')!;
  }
  _measureCtx.font = font;
  const w = _measureCtx.measureText(text).width;
  cache.set(text, w);
  return w;
}

/* Pill geometry. PILL_SVG_W is the fixed width of the SVG container —
   wide enough to hold the largest possible morphed pill, with the
   path centered inside via tx offsets. PILL_R = PILL_H / 2 makes
   every pill fully rounded (capsule) regardless of width. */
/* Pill height is shorter than the outer chooser height (40px) so
   the pill sits with breathing room top + bottom. PAD values are
   tight around icon + label for a snug pill. */
const PILL_H = 28;
const PILL_R = PILL_H / 2;
const PILL_SVG_W = 240;

const ICON_W = 16;
const LABEL_GAP = 5;
const PAD_LEFT = 9;
const PAD_RIGHT = 11;
/* Extra column inserted before the "edit" group so the hard 1px
   divider has breathing room on each side. The pill's translate
   transition covers this gap during hover, so there is still no
   visual seam as the pill slides across. */
const DIVIDER_COL_W = 10;

const PILL_LABEL_FONT =
  "600 12px 'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif";

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pillWidthFor(fmt: Format, compact: boolean = false): number {
  if (compact) {
    // Compact pill is icon-only and matches the other buttons' column
    // width exactly (32) so the whole chooser collapses uniformly.
    return 32;
  }
  const labelW = measureWord(cap(fmt), PILL_LABEL_FONT);
  return PAD_LEFT + ICON_W + LABEL_GAP + Math.ceil(labelW) + PAD_RIGHT;
}

/* All paths emit identical 9-command topology (M H Q V Q H Q V Q Z)
   so CSS `d:` interpolates between any pair smoothly — no flubber,
   no JS animation loop. */
function pillPath(width: number): string {
  const w = width;
  const tx = (PILL_SVG_W - w) / 2;
  const r = PILL_R;
  const h = PILL_H;
  return [
    `M ${tx + r} 0`,
    `H ${tx + w - r}`,
    `Q ${tx + w} 0 ${tx + w} ${r}`,
    `V ${h - r}`,
    `Q ${tx + w} ${h} ${tx + w - r} ${h}`,
    `H ${tx + r}`,
    `Q ${tx} ${h} ${tx} ${h - r}`,
    `V ${r}`,
    `Q ${tx} 0 ${tx + r} 0`,
    'Z',
  ].join(' ');
}

const ICONS: Record<Format, string> = {
  isolated: `<svg viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='1.5'>
    <rect x='1.75' y='1' width='12.5' height='14' rx='1.25'/>
    <line x1='4.5' y1='4.5' x2='11.5' y2='4.5'/>
    <line x1='4.5' y1='7' x2='11.5' y2='7'/>
    <line x1='4.5' y1='9.5' x2='11.5' y2='9.5'/>
    <line x1='4.5' y1='12' x2='9' y2='12'/>
  </svg>`,
  embedded: `<svg viewBox='0 0 18 16' fill='none' stroke='currentColor' stroke-width='1.25'>
    <rect x='1.25' y='3.5' width='15.5' height='9' rx='2' fill='currentColor' fill-opacity='0.18'/>
    <rect x='1.25' y='3.5' width='15.5' height='9' rx='2'/>
    <rect x='3' y='5.25' width='5' height='5.5' rx='0.75' fill='currentColor' stroke='none'/>
    <line x1='9.5' y1='6.75' x2='14.75' y2='6.75'/>
    <line x1='9.5' y1='8.5' x2='14.75' y2='8.5'/>
    <line x1='9.5' y1='10.25' x2='12.75' y2='10.25'/>
  </svg>`,
  fitted: `<svg viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='1.25'>
    <rect x='4.25' y='2.5' width='7.5' height='11' rx='0.5'/>
    <circle cx='4.25' cy='2.5' r='1.4' fill='currentColor' stroke='none'/>
    <circle cx='11.75' cy='2.5' r='1.4' fill='currentColor' stroke='none'/>
    <circle cx='4.25' cy='13.5' r='1.4' fill='currentColor' stroke='none'/>
    <circle cx='11.75' cy='13.5' r='1.4' fill='currentColor' stroke='none'/>
  </svg>`,
  atom: `<svg viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='1.5'>
    <rect x='2' y='6' width='12' height='4' rx='2' fill='currentColor' fill-opacity='0.35'/>
    <rect x='2' y='6' width='12' height='4' rx='2'/>
  </svg>`,
  edit: `<svg viewBox='2.5 2.5 18.75 18.75' fill='currentColor'>
    <path d='M4 20.75a.75.75 0 0 1-.75-.75v-4.181a.76.76 0 0 1 .22-.53L14.711 4.05a2.72 2.72 0 0 1 3.848 0l1.391 1.391a2.72 2.72 0 0 1 0 3.848L8.712 20.53a.75.75 0 0 1-.531.22zm.75-4.621v3.121h3.12l7.91-7.91-3.12-3.12zm12.091-5.849 2.051-2.051a1.223 1.223 0 0 0 0-1.727l-1.393-1.394a1.22 1.22 0 0 0-1.727 0L13.72 7.16z'/>
  </svg>`,
  /* form — the auto-generated standard view ("Toggle Standard View"
     in the overflow menu). Sits next to Edit (custom edit template)
     when both are available. */
  form: `<svg viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='1.4'>
    <rect x='2' y='2' width='12' height='12' rx='1.25'/>
    <line x1='4.5' y1='5.25' x2='9.5' y2='5.25'/>
    <rect x='4.5' y='6.5' width='7' height='2' rx='0.5' fill='currentColor' fill-opacity='0.3' stroke='none'/>
    <line x1='4.5' y1='10.5' x2='8' y2='10.5'/>
    <rect x='4.5' y='11.75' width='7' height='1.75' rx='0.5' fill='currentColor' fill-opacity='0.3' stroke='none'/>
  </svg>`,
  head: `<svg viewBox='0 0 16 16' fill='currentColor' stroke='currentColor' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'>
    <circle cx='12.25' cy='3.25' r='1.85' stroke='none'/>
    <circle cx='3.75' cy='8' r='1.85' stroke='none'/>
    <circle cx='12.25' cy='12.75' r='1.85' stroke='none'/>
    <line x1='5.4' y1='9.05' x2='10.6' y2='11.7' fill='none'/>
    <line x1='10.6' y1='4.3' x2='5.4' y2='6.95' fill='none'/>
  </svg>`,
  markdown: `<svg viewBox='0 0 16 16' fill='currentColor'>
    <text x='8' y='11.5' text-anchor='middle' font-size='8.5' font-weight='800' font-family='ui-monospace, SFMono-Regular, Menlo, monospace'>MD</text>
  </svg>`,
  // metadata + spec aren't in the original FORMATS but the type
  // includes them. Reuse appropriate icons / fall back to a neutral
  // dot if the host ever passes them in via @formats.
  // (unused in current contexts)
} as Record<Format, string>;

export default class PillFormatChooser extends Component<Signature> {
  @tracked private hoveredFmt: Format | null = null;
  @tracked private isDragging = false;
  // Live parent content-box width, kept fresh by registerRow's
  // ResizeObserver. Compact mode is a derived getter — no manual sync
  // needed, so it reacts when the user changes active format too (which
  // changes the natural width without firing a resize event).
  @tracked private parentWidth: number = Infinity;

  private rowEl: HTMLElement | null = null;
  private buttonEls: Map<Format, HTMLElement> = new Map();
  // After a drag that moved selection, the browser fires a synthetic
  // click on the originally-pressed button (because of pointer capture)
  // — that would revert active to the press-start format. Suppress it.
  private suppressNextClick = false;

  private get availableFormats(): Format[] {
    return (this.args.formats ?? formats) as Format[];
  }

  private get active(): Format {
    return this.args.format;
  }

  private setActive = (f: Format) => {
    if (f === this.active) return;
    this.args.setFormat(f);
  };

  get hasPreview(): boolean {
    return this.hoveredFmt !== null && this.hoveredFmt !== this.active;
  }

  /* Per-column width. ONLY ONE column at a time is wider:
       previewing → hovered column expands (outlined white preview)
       resting → active column expands (outlined green selected) */
  private colWidthFor(f: Format): number {
    if (this.hasPreview) {
      return f === this.hoveredFmt ? pillWidthFor(f, this.isCompact) : 32;
    }
    return f === this.active ? pillWidthFor(f, this.isCompact) : 32;
  }


  get gridStyle(): SafeString {
    const cols: string[] = [];
    const fmts = this.availableFormats;
    for (const f of fmts) {
      // Insert divider before "edit" — only if both edit AND a preceding
      // non-edit format are in the available list.
      if (f === 'edit' && fmts.indexOf('edit') > 0) {
        cols.push(`${DIVIDER_COL_W}px`);
      }
      cols.push(`${this.colWidthFor(f)}px`);
    }
    return htmlSafe(`grid-template-columns: ${cols.join(' ')};`);
  }

  /* Computed center X for a given format under current grid layout.
     PAD must match the CSS horizontal padding of .pill-format-chooser
     (the grid starts at padding-left). */
  private centerXFor(target: Format): number {
    const PAD = 10;
    let x = PAD;
    const fmts = this.availableFormats;
    for (const f of fmts) {
      if (f === 'edit' && fmts.indexOf('edit') > 0) x += DIVIDER_COL_W;
      const w = this.colWidthFor(f);
      if (f === target) return x + w / 2;
      x += w;
    }
    return x;
  }

  // Pill position + shape follow hovered format if previewing, else
  // active. Stroke color is green when pill sits on active (hard
  // select — including throughout a drag, since drag commits live),
  // gray when previewing a different format via hover.
  get pillTargetFmt(): Format {
    return this.hoveredFmt ?? this.active;
  }
  get pillIsAtActive(): boolean {
    return this.pillTargetFmt === this.active;
  }
  get pillStyle(): SafeString {
    const tx = this.centerXFor(this.pillTargetFmt) - PILL_SVG_W / 2;
    return htmlSafe(`transform: translateX(${tx}px);`);
  }
  get pillPathD(): string {
    return pillPath(pillWidthFor(this.pillTargetFmt, this.isCompact));
  }
  get pillStrokeColor(): string {
    return this.pillIsAtActive ? 'var(--boxel-highlight)' : '#d8d8d8';
  }
  get pillContentColor(): SafeString {
    const c = this.pillIsAtActive ? 'var(--boxel-highlight)' : '#d8d8d8';
    return htmlSafe(`color: ${c};`);
  }

  registerRow = modifier((el: HTMLElement) => {
    this.rowEl = el;
    /* Width-constraint detection.

       Walk up to 12 ancestors and use the smallest clientWidth as the
       chooser's available room. This relies on the chooser's host
       parents NOT being auto-sized to the chooser's content — host
       layouts must give the chooser a full-width or otherwise
       independently-constrained shell, otherwise this signal would
       collapse with the chooser and stick in compact mode.

       (See preview-panel/index.gts and playground-panel.gts CSS for
       the full-width flex shells.)

       Re-measures on: chooser-own resize, body resize, window resize.
       Together these cover the realistic paths a layout change can
       reach the chooser. */
    const observers: ResizeObserver[] = [];
    const ancestors: HTMLElement[] = [];
    let node: HTMLElement | null = el.parentElement;
    let depth = 0;
    while (node && depth < 12) {
      ancestors.push(node);
      node = node.parentElement;
      depth++;
    }
    const measure = () => {
      let smallest = Infinity;
      for (const a of ancestors) {
        if (a.clientWidth > 0) smallest = Math.min(smallest, a.clientWidth);
      }
      if (smallest !== Infinity) this.parentWidth = smallest;
    };
    if (typeof ResizeObserver !== 'undefined') {
      const choserRo = new ResizeObserver(measure);
      choserRo.observe(el);
      observers.push(choserRo);
      for (const a of ancestors) {
        const ro = new ResizeObserver(measure);
        ro.observe(a);
        observers.push(ro);
      }
    }
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    measure();
    return () => {
      for (const ro of observers) ro.disconnect();
      window.removeEventListener('resize', onResize);
      if (this.rowEl === el) this.rowEl = null;
    };
  });

  /* Compact when the parent's available width can't fit the full
     non-compact pill. We always compare against non-compact natural
     so the trigger doesn't depend on current state — no oscillation,
     no manual hysteresis. */
  get isCompact(): boolean {
    const PAD_X = 10;
    let natural = 2 * PAD_X;
    const fmts = this.availableFormats;
    for (const f of fmts) {
      if (f === 'edit' && fmts.indexOf('edit') > 0) natural += DIVIDER_COL_W;
      natural += f === this.active ? pillWidthFor(f, false) : 32;
    }
    return this.parentWidth < natural;
  }

  registerBtn = modifier((el: HTMLElement, [fmt]: [Format]) => {
    this.buttonEls.set(fmt, el);
    return () => {
      if (this.buttonEls.get(fmt) === el) this.buttonEls.delete(fmt);
    };
  });

  setHovered = (f: Format) => {
    if (this.isDragging) return;
    this.hoveredFmt = f;
  };

  clearHovered = () => {
    if (this.isDragging) return;
    this.hoveredFmt = null;
  };

  onClick = (f: Format) => {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }
    this.setActive(f);
  };

  // Press + drag both commit live: setActive runs on pointerdown and
  // on every move that crosses into a new button. Release does
  // nothing — active already reflects where the cursor is.
  onPointerDown = (e: PointerEvent) => {
    const btn = e.currentTarget as HTMLElement;
    const fmt = btn.dataset.fmt as Format | undefined;
    if (!fmt) return;
    btn.setPointerCapture(e.pointerId);
    this.hoveredFmt = null;
    this.isDragging = true;
    this.suppressNextClick = false;
    this.setActive(fmt);
  };

  onPointerMove = (e: PointerEvent) => {
    if (!this.isDragging || !this.rowEl) return;
    const rowRect = this.rowEl.getBoundingClientRect();
    const x = e.clientX - rowRect.left;
    let best: Format = this.active;
    let bestDist = Infinity;
    this.buttonEls.forEach((btnEl, fmt) => {
      const r = btnEl.getBoundingClientRect();
      const cx = r.left + r.width / 2 - rowRect.left;
      const dist = Math.abs(x - cx);
      if (dist < bestDist) {
        bestDist = dist;
        best = fmt;
      }
    });
    if (best !== this.active) this.setActive(best);
  };

  onPointerUp = (e: PointerEvent) => {
    const btn = e.currentTarget as HTMLElement;
    const pressedFmt = btn.dataset.fmt as Format | undefined;
    if (btn.hasPointerCapture(e.pointerId)) {
      btn.releasePointerCapture(e.pointerId);
    }
    this.isDragging = false;
    // If the cursor ended on a different format than where it was
    // pressed, the trailing synthetic click on the press-start button
    // would revert the selection — suppress it.
    if (pressedFmt && pressedFmt !== this.active) {
      this.suppressNextClick = true;
    }
  };

  eq = (a: unknown, b: unknown) => a === b;
  iconFor = (f: Format): SafeString => htmlSafe(ICONS[f] ?? '');

  <template>
    <div
      class='pill-format-chooser
        {{if this.isDragging "dragging"}}
        {{if this.hasPreview "has-preview"}}
        {{if this.isCompact "compact"}}'
      style={{this.gridStyle}}
      data-test-pill-format-chooser
      {{this.registerRow}}
      ...attributes
    >
      {{! ONE pill. Position + shape follow hovered (preview) or
          active (rest). Stroke color flips instantly between green
          (active match) and white (preview). On commit, only the
          stroke color changes — no fade in/out. }}
      <div
        class='pill-container'
        style={{this.pillStyle}}
        aria-hidden='true'
      >
        <svg
          class='pill-bg'
          width={{PILL_SVG_W}}
          height={{PILL_H}}
          viewBox='0 0 240 28'
        >
          <path
            class='pill-path'
            d={{this.pillPathD}}
            fill='none'
            stroke={{this.pillStrokeColor}}
            stroke-width='1.5'
          />
        </svg>
        <div class='pill-content' style={{this.pillContentColor}}>
          <span class='pf-icon'>{{this.iconFor this.pillTargetFmt}}</span>
          <span class='pf-label'>{{this.pillTargetFmt}}</span>
        </div>
      </div>

      {{#each this.availableFormats as |f i|}}
        {{#if (this.eq f 'edit')}}
          {{#unless (this.eq i 0)}}
            <span class='pf-divider'></span>
          {{/unless}}
        {{/if}}
        <button
          class='pf-btn
            {{if (this.eq this.active f) "is-active"}}
            {{if (this.eq this.hoveredFmt f) "is-hover"}}'
          type='button'
          data-fmt={{f}}
          aria-label={{f}}
          title={{f}}
          data-test-format-chooser={{f}}
          {{this.registerBtn f}}
          {{on 'click' (fn this.onClick f)}}
          {{on 'mouseenter' (fn this.setHovered f)}}
          {{on 'mouseleave' this.clearHovered}}
          {{on 'pointerdown' this.onPointerDown}}
          {{on 'pointermove' this.onPointerMove}}
          {{on 'pointerup' this.onPointerUp}}
          {{on 'pointercancel' this.onPointerUp}}
        >
          <span class='pf-icon'>{{this.iconFor f}}</span>
        </button>
      {{/each}}
    </div>

    <style scoped>
      .pill-format-chooser {
        display: grid;
        align-items: center;
        gap: 0;
        padding: 6px 10px;
        position: relative;
        user-select: none;
        height: 40px;
        box-sizing: border-box;
        /* `min-width: 0` lets the chooser shrink below grid-content
           min-content, so the parent's width constraint actually
           reaches the chooser. `max-width: 100%` clamps to it.
           `overflow: visible` so the compact-mode tooltip can extend
           in any direction. We rely on the viewport-anchored
           ResizeObserver below to flip into compact mode before the
           chooser would visibly overflow its parent — no horizontal
           clip safety net so tooltips on edge buttons render fully. */
        min-width: 0;
        max-width: 100%;
        overflow: visible;
        transition: grid-template-columns 320ms
          cubic-bezier(0.4, 0, 0.2, 1);
        color: var(--boxel-light);
      }
      .pill-format-chooser.dragging {
        transition: grid-template-columns 60ms
          cubic-bezier(0.2, 0, 0, 1);
      }
      .pf-divider {
        width: 1px;
        height: 18px;
        background: rgba(255, 255, 255, 0.18);
        justify-self: center;
        position: relative;
        z-index: 2;
      }

      /* Pill containers — outlined SVG bg + HTML content, sized
         PILL_H tall (28). Top:6 = (40-28)/2 to vertically center
         in the 40px chooser row (was 4 = visually heavy on top). */
      .pill-container {
        position: absolute;
        top: 6px;
        left: 0;
        width: 240px;
        height: 28px;
        z-index: 1;
        pointer-events: none;
        transition:
          transform 320ms cubic-bezier(0.4, 0, 0.2, 1),
          opacity 200ms ease;
        will-change: transform;
      }
      .pill-format-chooser.dragging .pill-container {
        transition:
          transform 60ms cubic-bezier(0.2, 0, 0, 1),
          opacity 200ms ease;
      }
      .pill-bg {
        position: absolute;
        top: 0;
        left: 0;
        overflow: visible;
      }
      /* Path morphs in shape (d) only — fill + stroke change
         INSTANTLY on commit so the white→green outline swap is a
         snap, not an animation. */
      .pill-path {
        transition: d 320ms cubic-bezier(0.4, 0, 0.2, 1);
        will-change: d;
      }
      .pill-format-chooser.dragging .pill-path {
        transition: d 240ms cubic-bezier(0.2, 0, 0, 1);
      }
      .pill-content {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font: 600 12px/1 var(--boxel-font-family);
        text-transform: capitalize;
        white-space: nowrap;
        transition: color 200ms ease;
      }
      .pill-content .pf-icon {
        flex: 0 0 auto;
      }

      /* Buttons — rectangular hit-targets above the pill containers
         (z-index 5) so clicks always land on the button. Height 28
         matches the pill height + chooser content area so the
         button icon vertically lines up with the pill icon
         (both centered in the same 28px band). */
      .pf-btn {
        position: relative;
        z-index: 5;
        width: 100%;
        height: 28px;
        background: transparent;
        color: var(--boxel-light);
        border: 0;
        padding: 0;
        border-radius: 0;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
        opacity: 0.55;
        transition:
          opacity 180ms ease,
          color 180ms ease;
      }
      .pf-btn:hover {
        opacity: 1;
      }
      .pill-format-chooser.dragging .pf-btn {
        cursor: grabbing;
      }
      /* Whichever button the pill is currently over hides its own
         icon (the pill carries one). At rest that's the active
         button; while previewing it's the hovered button — and the
         active button's icon comes back, colored GREEN to mark
         "currently selected". During DRAG no green: active is
         updating live so the previous-selection indicator would just
         be the icon you're dragging from a moment ago. */
      .pf-btn.is-active .pf-icon {
        opacity: 0;
        transition: opacity 120ms ease;
      }
      .pill-format-chooser.has-preview:not(.dragging)
        .pf-btn.is-active {
        color: var(--boxel-highlight);
        opacity: 1;
      }
      .pill-format-chooser.has-preview:not(.dragging)
        .pf-btn.is-active
        .pf-icon {
        opacity: 1;
      }
      .pf-btn.is-hover:not(.is-active) .pf-icon {
        opacity: 0;
        transition: opacity 120ms ease;
      }
      .pf-icon {
        flex: 0 0 auto;
        height: 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .pf-icon :deep(svg) {
        height: 16px;
        width: auto;
        display: block;
      }

      /* Compact mode — parent is too narrow for the full natural pill.
         Collapse the morphing pill to icon-only (label hidden) so the
         active button matches the other 32px columns. The whole chooser
         shrinks uniformly. */
      .pill-format-chooser.compact .pill-content .pf-label {
        display: none;
      }
      /* Custom tooltip above the button on hover. Only shown in
         compact mode (where icons stand alone with no visible label).
         Uses data-fmt for the text so we get the bare format name
         (not capitalized via JS). The native `title=` attr stays as
         an accessibility / long-press fallback. */
      .pill-format-chooser.compact .pf-btn {
        position: relative;
      }
      .pill-format-chooser.compact .pf-btn::after {
        content: attr(data-fmt);
        position: absolute;
        bottom: calc(100% + 8px);
        left: 50%;
        background: rgba(0, 0, 0, 0.92);
        color: var(--boxel-light);
        font: 600 11px/1 var(--boxel-font-family);
        text-transform: capitalize;
        letter-spacing: 0.2px;
        padding: 5px 9px;
        border-radius: 6px;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        transform: translateX(-50%);
        z-index: 10;
      }
      /* Compact view = icon-only. The tooltip is the user's only way
         to read a label, so it must appear instantly on hover with no
         delay. During a drag, pointer-capture suppresses :hover events
         on neighbor buttons, so we also show the tooltip on whichever
         button is currently `is-active` (which updates live as the
         cursor crosses buttons) — this makes the tooltip follow the
         drag without lagging on the originally-pressed button. */
      .pill-format-chooser.compact .pf-btn:hover::after,
      .pill-format-chooser.compact.dragging .pf-btn.is-active::after {
        opacity: 1;
      }
    </style>
  </template>
}
