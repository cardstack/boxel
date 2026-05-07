import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import { htmlSafe, type SafeString } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';

import { Button } from '@cardstack/boxel-ui/components';
import { cn, eq, or } from '@cardstack/boxel-ui/helpers';
import type { Icon } from '@cardstack/boxel-ui/icons';

import { formats, type Format } from '@cardstack/runtime-common';

import { formatIcons, type FormatWithIcon } from '../card-formats';

interface Signature {
  Args: {
    format: Format;
    setFormat: (format: Format) => void;
    formats?: Format[];
  };
  Element: HTMLElement;
}

/* Offscreen canvas measurement — no DOM mutation, no reflow.
   Sizes the pill path to match each label's natural text width. */
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

/* PILL_SVG_W is wide enough for the largest pill; the path is centered
   inside via tx offsets. PILL_R = PILL_H / 2 makes every pill a capsule.
   PILL_H is shorter than --pf-height so the pill has breathing room. */
const PILL_H = 28; // --pf-pill-h
const PILL_R = PILL_H / 2;
const PILL_SVG_W = 240; // --pf-pill-svg-w

const ICON_W = 16; // --pf-icon-w
const LABEL_GAP = 5;
const PAD_LEFT = 9; // --pf-pad-left (var(--boxel-sp-xs))
const PAD_RIGHT = 11;
/* Extra column before "edit"/"metadata" groups gives the divider breathing
   room. The pill's translate transition covers this gap seamlessly. */
const DIVIDER_COL_W = 10; // --pf-divider-col-w
const GAP_PX = 5; // --pf-gap-px

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
  const tx = (PILL_SVG_W - width) / 2;
  const r = PILL_R;
  const h = PILL_H;
  return [
    `M ${tx + r} 0`,
    `H ${tx + width - r}`,
    `Q ${tx + width} 0 ${tx + width} ${r}`,
    `V ${h - r}`,
    `Q ${tx + width} ${h} ${tx + width - r} ${h}`,
    `H ${tx + r}`,
    `Q ${tx} ${h} ${tx} ${h - r}`,
    `V ${r}`,
    `Q ${tx} 0 ${tx + r} 0`,
    'Z',
  ].join(' ');
}

export default class PillFormatChooser extends Component<Signature> {
  @tracked private hoveredFmt: Format | null = null;
  @tracked private isDragging = false;
  // Smallest ancestor clientWidth, updated by ResizeObserver.
  // Also reacts to active-format changes, which shift natural width without a resize event.
  @tracked private parentWidth: number = Infinity;

  private rowEl: HTMLElement | null = null;
  private buttonEls: Map<Format, HTMLElement> = new Map();
  // After a drag that changed format, the browser fires a synthetic click
  // on the press-start button — suppress it to avoid reverting the selection.
  private suppressNextClick = false;

  private get availableFormats(): Format[] {
    return (this.args.formats ?? formats) as Format[];
  }

  private get availableFormatsWithIcons(): FormatWithIcon[] {
    return this.availableFormats.map((f) => ({
      format: f,
      icon: formatIcons[f] ?? null,
    }));
  }

  private get pillTargetIcon(): Icon | null {
    return formatIcons[this.pillTargetFmt] ?? null;
  }

  private setActive = (f: Format) => {
    if (f === this.args.format) return;
    this.args.setFormat(f);
  };

  get hasPreview(): boolean {
    return this.hoveredFmt !== null && this.hoveredFmt !== this.args.format;
  }

  /* One column wider at a time: hovered (preview) or active (rest). */
  private colWidthFor(f: Format): number {
    if (this.hasPreview) {
      return f === this.hoveredFmt ? pillWidthFor(f, this.isCompact) : 32;
    }
    return f === this.args.format ? pillWidthFor(f, this.isCompact) : 32;
  }

  get gridStyle(): SafeString {
    const cols: string[] = [];
    const fmts = this.availableFormats;
    for (const f of fmts) {
      // Insert divider before "edit" or "metadata" — only when not first.
      if ((f === 'edit' || f === 'metadata') && fmts.indexOf(f) > 0) {
        cols.push(`${DIVIDER_COL_W}px`);
      }
      cols.push(`${this.colWidthFor(f)}px`);
    }
    return htmlSafe(`grid-template-columns: ${cols.join(' ')};`);
  }

  /* Center X of a format button under the current grid layout. */
  private centerXFor(target: Format): number {
    let x = PAD_LEFT;
    let isFirst = true;
    const fmts = this.availableFormats;
    for (const f of fmts) {
      if ((f === 'edit' || f === 'metadata') && fmts.indexOf(f) > 0) {
        // divider col + btn col separated by two gaps
        x += GAP_PX + DIVIDER_COL_W + GAP_PX;
      } else {
        if (!isFirst) x += GAP_PX;
        isFirst = false;
      }
      const w = this.colWidthFor(f);
      if (f === target) return x + w / 2;
      x += w;
    }
    return x;
  }

  // Pill tracks hoveredFmt while previewing, active format at rest.
  get pillTargetFmt(): Format {
    return this.hoveredFmt ?? this.args.format;
  }
  get pillStyle(): SafeString {
    const tx = this.centerXFor(this.pillTargetFmt) - PILL_SVG_W / 2;
    return htmlSafe(`transform: translateX(${tx}px);`);
  }
  get pillPathD(): string {
    return pillPath(pillWidthFor(this.pillTargetFmt, this.isCompact));
  }
  registerRow = modifier((el: HTMLElement) => {
    this.rowEl = el;
    /* Walk up to 12 ancestors; use the smallest clientWidth as available room.
       Host layouts must give the chooser a full-width shell — auto-sized parents
       would collapse with the chooser and lock it in compact mode. */
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
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      for (const a of ancestors) ro.observe(a);
      observers.push(ro);
    }
    window.addEventListener('resize', measure);
    measure();

    // Track hover via the stable container rather than mouseenter/mouseleave
    // on individual buttons. Buttons change their own layout on hover (grid
    // columns animate), which causes spurious leave/enter cycles that flicker.
    const onMouseMove = (e: MouseEvent) => {
      if (this.isDragging) return;
      let found: Format | null = null;
      this.buttonEls.forEach((btnEl, fmt) => {
        const r = btnEl.getBoundingClientRect();
        if (
          e.clientX >= r.left &&
          e.clientX <= r.right &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom
        ) {
          found = fmt;
        }
      });
      this.hoveredFmt = found;
    };
    const onMouseLeave = () => {
      if (this.isDragging) return;
      this.hoveredFmt = null;
    };
    el.addEventListener('mousemove', onMouseMove);
    el.addEventListener('mouseleave', onMouseLeave);

    return () => {
      for (const ro of observers) ro.disconnect();
      window.removeEventListener('resize', measure);
      el.removeEventListener('mousemove', onMouseMove);
      el.removeEventListener('mouseleave', onMouseLeave);
      if (this.rowEl === el) this.rowEl = null;
    };
  });

  /* Always compare against non-compact width so the trigger is stateless —
     no oscillation, no hysteresis. */
  get isCompact(): boolean {
    let natural = 2 * PAD_LEFT;
    let isFirst = true;
    const fmts = this.availableFormats;
    for (const f of fmts) {
      if ((f === 'edit' || f === 'metadata') && fmts.indexOf(f) > 0) {
        natural += GAP_PX + DIVIDER_COL_W + GAP_PX;
      } else {
        if (!isFirst) natural += GAP_PX;
        isFirst = false;
      }
      natural += f === this.args.format ? pillWidthFor(f, false) : 32;
    }
    return this.parentWidth < natural;
  }

  registerBtn = modifier((el: HTMLElement, [fmt]: [Format]) => {
    this.buttonEls.set(fmt, el);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    return () => {
      if (this.buttonEls.get(fmt) === el) this.buttonEls.delete(fmt);
      el.removeEventListener('pointerdown', this.onPointerDown);
      el.removeEventListener('pointermove', this.onPointerMove);
      el.removeEventListener('pointerup', this.onPointerUp);
      el.removeEventListener('pointercancel', this.onPointerUp);
    };
  });

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
  onPointerDown = (e: Event) => {
    const pe = e as PointerEvent;
    const btn = pe.currentTarget as HTMLElement;
    const fmt = btn.dataset.fmt as Format | undefined;
    if (!fmt) return;
    btn.setPointerCapture(pe.pointerId);
    this.hoveredFmt = null;
    this.isDragging = true;
    this.suppressNextClick = false;
    this.setActive(fmt);
  };

  onPointerMove = (e: Event) => {
    const pe = e as PointerEvent;
    if (!this.isDragging || !this.rowEl) return;
    const rowRect = this.rowEl.getBoundingClientRect();
    const x = pe.clientX - rowRect.left;
    let best: Format = this.args.format;
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
    if (best !== this.args.format) this.setActive(best);
  };

  onPointerUp = (e: Event) => {
    const pe = e as PointerEvent;
    const btn = pe.currentTarget as HTMLElement;
    const pressedFmt = btn.dataset.fmt as Format | undefined;
    if (btn.hasPointerCapture(pe.pointerId)) {
      btn.releasePointerCapture(pe.pointerId);
    }
    this.isDragging = false;
    // Suppress the trailing synthetic click that would revert to the press-start format.
    if (pressedFmt && pressedFmt !== this.args.format) {
      this.suppressNextClick = true;
    }
  };

  <template>
    <div
      class={{cn
        'pill-format-chooser'
        dragging=this.isDragging
        has-preview=this.hasPreview
        compact=this.isCompact
      }}
      style={{this.gridStyle}}
      role='group'
      aria-label='Card format'
      {{this.registerRow}}
      ...attributes
    >
      {{! Single pill — slides and morphs to follow hover/active. Stroke snaps instantly on commit. }}
      <div class='pill-container' style={{this.pillStyle}} aria-hidden='true'>
        <svg class='pill-bg' width='240' height='28' viewBox='0 0 240 28'>
          <path
            class='pill-path'
            d={{this.pillPathD}}
            fill='var(--pf-bg)'
            stroke='var(--pf-preview-color)'
            stroke-width='1.5'
          />
        </svg>
        <div class='pill-content'>
          {{#if this.pillTargetIcon}}
            <this.pillTargetIcon class='pf-icon' width='16' height='16' />
          {{/if}}
          <span class='pf-label'>{{this.pillTargetFmt}}</span>
        </div>
      </div>

      {{#each this.availableFormatsWithIcons as |fw i|}}
        {{#if (or (eq fw.format 'metadata') (eq fw.format 'edit'))}}
          {{#unless (eq i 0)}}
            <span class='pf-divider'></span>
          {{/unless}}
        {{/if}}
        <Button
          @size='auto'
          class={{cn
            'pf-btn'
            active=(eq @format fw.format)
            is-hover=(eq this.hoveredFmt fw.format)
          }}
          type='button'
          data-fmt={{fw.format}}
          aria-label={{fw.format}}
          aria-pressed={{eq @format fw.format}}
          title={{fw.format}}
          data-test-format-chooser={{fw.format}}
          {{this.registerBtn fw.format}}
          {{on 'click' (fn this.onClick fw.format)}}
        >
          {{#if fw.icon}}
            <fw.icon class='pf-icon' width='16' height='16' />
          {{/if}}
        </Button>
      {{/each}}
    </div>

    <style scoped>
      .pill-format-chooser {
        /* JS-mirrored layout tokens — keep in sync with the corresponding constants. */
        --pf-gap-px: 5px; /* GAP_PX */
        --pf-pad-left: var(--boxel-sp-xs); /* PAD_LEFT */
        --pf-divider-col-w: 10px; /* DIVIDER_COL_W */
        --pf-pill-h: 28px; /* PILL_H */
        --pf-pill-svg-w: 240px; /* PILL_SVG_W */
        --pf-icon-w: 16px; /* ICON_W */

        --pf-height: var(--boxel-form-control-height);
        --pf-bg: var(--boxel-dark);
        --pf-color: var(--boxel-light);
        --pf-active-color: var(--boxel-highlight);

        --pf-btn-opacity: 0.55;
        --pf-divider-color: var(--boxel-500);
        --pf-preview-color: var(--boxel-200);

        --pf-transition: 320ms cubic-bezier(0.4, 0, 0.2, 1);
        --pf-transition-drag: 60ms cubic-bezier(0.2, 0, 0, 1);
        /* pill-path morph needs more time than snap reposition during drag */
        --pf-transition-drag-path: 240ms cubic-bezier(0.2, 0, 0, 1);
        --pf-transition-btn: 180ms ease;
        --pf-transition-icon: 120ms ease;

        display: grid;
        align-items: center;
        gap: var(--pf-gap-px);
        padding: var(--boxel-sp-3xs) var(--pf-pad-left);
        position: relative;
        user-select: none;
        height: var(--pf-height);
        box-sizing: border-box;
        /* min-width: 0 lets the chooser shrink below its grid min-content so
           the parent constraint reaches it. overflow: visible lets compact
           tooltips extend freely — compact mode kicks in before overflow occurs. */
        min-width: 0;
        max-width: 100%;
        overflow: visible;
        background-color: var(--pf-bg);
        color: var(--pf-color);
        border-radius: var(--boxel-border-radius-2xl);
        transition: grid-template-columns var(--pf-transition);
      }
      .pill-format-chooser:not(.has-preview) {
        --pf-preview-color: var(--pf-active-color);
      }
      .pill-format-chooser.dragging {
        transition: grid-template-columns var(--pf-transition-drag);
      }
      .pf-divider {
        width: 1px;
        height: 18px;
        background: var(--pf-divider-color);
        justify-self: center;
        position: relative;
        z-index: 2;
      }

      /* Pill containers — outlined SVG bg + HTML content, sized
         --pf-pill-h, vertically centered in --pf-height. */
      .pill-container {
        position: absolute;
        top: calc((var(--pf-height) - var(--pf-pill-h)) / 2);
        left: 0;
        width: var(--pf-pill-svg-w);
        height: var(--pf-pill-h);
        z-index: 1;
        pointer-events: none;
        transition: transform var(--pf-transition);
        will-change: transform;
      }
      .pill-format-chooser.dragging .pill-container {
        transition: transform var(--pf-transition-drag);
      }
      .pill-bg {
        position: absolute;
        top: 0;
        left: 0;
        overflow: visible;
      }
      /* d morphs smoothly; stroke snaps instantly on commit (gray→green). */
      .pill-path {
        transition: d var(--pf-transition);
        will-change: d;
      }
      .pill-format-chooser.dragging .pill-path {
        transition: d var(--pf-transition-drag-path);
      }
      .pill-content {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-3xs);
        font-weight: 600;
        font-size: var(--boxel-font-size-xs);
        line-height: 1;
        font-family: inherit;
        text-transform: capitalize;
        white-space: nowrap;
        color: var(--pf-preview-color);
      }
      .pill-content .pf-icon {
        flex: 0 0 auto;
      }

      /* Buttons — rectangular hit-targets above pill containers (z-index 5).
         Height matches --pf-pill-h so button icons align with pill icon. */
      .pf-btn {
        --boxel-button-color: transparent;
        --boxel-button-text-color: inherit;
        --boxel-button-padding: 0;

        width: 100%;
        height: var(--pf-pill-h);
        border-color: transparent;
        border-radius: var(--boxel-border-radius-sm);
        position: relative;
        z-index: 5;
        pointer-events: auto;
        cursor: pointer;
        opacity: var(--pf-btn-opacity);
        transition:
          opacity var(--pf-transition-btn),
          color var(--pf-transition-btn);
      }
      .pf-btn:hover {
        --boxel-button-color: transparent;
        opacity: 1;
      }
      .pill-format-chooser.dragging .pf-btn {
        cursor: grabbing;
        transition:
          opacity var(--pf-transition-drag),
          color var(--pf-transition-drag);
      }
      /* The pill carries the icon for its current button, so that button hides
         its own icon. While previewing, the hovered button hides its icon and
         the active button shows its icon in green ("currently selected").
         During drag, no green — active changes live, green would flicker. */
      .pf-btn.active .pf-icon,
      .pf-btn.is-hover:not(.active) .pf-icon {
        opacity: 0;
        transition: opacity var(--pf-transition-icon);
      }
      .pill-format-chooser.has-preview:not(.dragging) .pf-btn.active {
        color: var(--pf-active-color);
        opacity: 1;
      }
      .pill-format-chooser.has-preview:not(.dragging) .pf-btn.active .pf-icon {
        opacity: 1;
      }
      .pf-icon {
        flex: 0 0 auto;
        height: var(--pf-icon-w);
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .pf-icon :deep(svg) {
        height: var(--pf-icon-w);
        width: auto;
        display: block;
      }

      /* Compact mode — parent too narrow for the full pill; collapse to icon-only. */
      .pill-format-chooser.compact .pill-content .pf-label {
        display: none;
      }
      /* Tooltip above button in compact mode (icons have no visible label).
         Uses data-fmt so text is unmodified; title= is the a11y fallback. */
      .pill-format-chooser.compact .pf-btn {
        position: relative;
      }
      .pill-format-chooser.compact .pf-btn::after {
        content: attr(data-fmt);
        position: absolute;
        bottom: calc(100% + 8px);
        left: 50%;
        text-transform: capitalize;
        letter-spacing: var(--boxel-lsp-xs);
        padding: 5px 9px;
        background: var(--pf-bg);
        color: var(--pf-color);
        border-radius: var(--boxel-border-radius-sm);
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        transform: translateX(-50%);
        z-index: 10;
      }
      /* Show tooltip instantly — it's the only label in compact mode.
         During drag, pointer-capture kills :hover on neighbors, so show
         the tooltip on .active instead so it follows the cursor. */
      .pill-format-chooser.compact .pf-btn:hover::after,
      .pill-format-chooser.compact.dragging .pf-btn.active::after {
        opacity: 1;
      }
    </style>
  </template>
}
