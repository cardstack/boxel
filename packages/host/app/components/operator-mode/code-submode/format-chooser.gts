import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe, type SafeString } from '@ember/template';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';

import { Button } from '@cardstack/boxel-ui/components';
import { cn, eq, or } from '@cardstack/boxel-ui/helpers';

import type { Format } from '@cardstack/runtime-common';

import { formatsWithIcons, type FormatWithIcon } from '../card-formats';

interface Signature {
  Args: {
    format: Format;
    setFormat: (format: Format) => void;
    additionalClass?: string;
    formats?: Format[];
    formatsWithIcons?: FormatWithIcon[];
  };
  Element: HTMLElement;
}

/* Inline canvas measurement — same pattern as PillFormatChooser.
   One offscreen canvas shared across instances, per-font cache. */
let _measureCtx: CanvasRenderingContext2D | null = null;
const _measureCache = new Map<string, Map<string, number>>();
function measureWord(text: string, font: string): number {
  let cache = _measureCache.get(font);
  if (!cache) {
    cache = new Map();
    _measureCache.set(font, cache);
  }
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  if (!_measureCtx) {
    _measureCtx = document.createElement('canvas').getContext('2d')!;
  }
  _measureCtx.font = font;
  const w = _measureCtx.measureText(text).width;
  cache.set(text, w);
  return w;
}

/* Layout constants — must stay in sync with CSS.
   Mirrors --boxel-sp-2xs (6.75px) for PAD_X, --boxel-sp-3xs (4.76px)
   for GAP_PX / LABEL_GAP, and calc(--boxel-button-sm - 2px) (28px) +
   border (2px) + padding (14px) ≈ 32px for COLLAPSED_W. */
const COLLAPSED_W = 32;
const ICON_W = 16; // 1rem
const PAD_X = 7; // ≈ --boxel-sp-2xs, both sides
const LABEL_GAP = 5; // ≈ --boxel-sp-3xs, margin between icon and label
const GAP_PX = 5; // ≈ --boxel-sp-3xs, grid gap between columns
const DIVIDER_COL_W = 9;
const LABEL_FONT =
  "600 12px 'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif";

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function expandedWidthFor(fmt: Format): number {
  const textW = measureWord(cap(fmt), LABEL_FONT);
  return PAD_X + ICON_W + LABEL_GAP + Math.ceil(textW) + PAD_X;
}

export default class FormatChooser extends Component<Signature> {
  @tracked private hoveredFmt: Format | null = null;
  @tracked private isDragging = false;
  private suppressNextClick = false;
  private btnEls: Map<Format, HTMLElement> = new Map();

  // ── Derived state ────────────────────────────────────────────────────

  private get pillTargetFmt(): Format {
    return this.hoveredFmt ?? this.args.format;
  }

  get pillIsAtActive(): boolean {
    return this.pillTargetFmt === this.args.format;
  }

  private get availableFormats(): Format[] {
    return this.formats.map((f) => f.format);
  }

  // ── Layout math ──────────────────────────────────────────────────────

  /* Column width for a given format. During drag all columns collapse
     to icon-only so the pill can slide without labels flashing. */
  private colWidthFor(f: Format): number {
    if (this.isDragging) return COLLAPSED_W;
    return f === this.pillTargetFmt ? expandedWidthFor(f) : COLLAPSED_W;
  }

  private hasDividerBefore(f: Format, fmts: Format[]): boolean {
    return (f === 'edit' || f === 'metadata') && fmts.indexOf(f) > 0;
  }

  /* Both gridStyle and pillStyle derive from the same colWidthFor() so
     layout and pill position are always in sync — no DOM measurement. */
  get gridStyle(): SafeString {
    const fmts = this.availableFormats;
    const cols: string[] = [];
    for (const f of fmts) {
      if (this.hasDividerBefore(f, fmts)) cols.push(`${DIVIDER_COL_W}px`);
      cols.push(`${this.colWidthFor(f)}px`);
    }
    return htmlSafe(`grid-template-columns: ${cols.join(' ')};`);
  }

  /* Left edge of a format's column, including container padding and
     inter-column gaps. Mirrors PillFormatChooser's centerXFor(). */
  private leftXFor(target: Format): number {
    const fmts = this.availableFormats;
    let x = PAD_X;
    let isFirst = true;
    for (const f of fmts) {
      if (this.hasDividerBefore(f, fmts)) {
        x += GAP_PX + DIVIDER_COL_W + GAP_PX;
      } else {
        if (!isFirst) x += GAP_PX;
        isFirst = false;
      }
      if (f === target) return x;
      x += this.colWidthFor(f);
    }
    return x;
  }

  get pillStyle(): SafeString {
    const target = this.pillTargetFmt;
    const tx = Math.round(this.leftXFor(target));
    const w = this.isDragging
      ? COLLAPSED_W
      : Math.round(expandedWidthFor(target));
    return htmlSafe(`transform: translateX(${tx}px); width: ${w}px;`);
  }

  // ── Actions ──────────────────────────────────────────────────────────

  private setActive(f: Format) {
    if (f === this.args.format) return;
    this.args.setFormat(f);
  }

  onClick = (f: Format) => {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }
    this.args.setFormat(f);
  };

  setHovered = (f: Format) => {
    if (this.isDragging) return;
    this.hoveredFmt = f;
  };

  clearHovered = () => {
    if (this.isDragging) return;
    this.hoveredFmt = null;
  };

  // ── Drag ─────────────────────────────────────────────────────────────

  onPointerDown = (e: Event) => {
    const pe = e as PointerEvent;
    const btn = pe.currentTarget as HTMLElement;
    const fmt = btn.dataset['fmt'] as Format | undefined;
    if (!fmt) return;
    btn.setPointerCapture(pe.pointerId);
    this.hoveredFmt = null;
    this.isDragging = true;
    this.suppressNextClick = false;
    this.setActive(fmt);
  };

  onPointerMove = (e: Event) => {
    const pe = e as PointerEvent;
    if (!this.isDragging) return;
    let best: Format = this.args.format;
    let bestDist = Infinity;
    this.btnEls.forEach((el, fmt) => {
      const r = el.getBoundingClientRect();
      const dist = Math.abs(pe.clientX - (r.left + r.width / 2));
      if (dist < bestDist) {
        bestDist = dist;
        best = fmt;
      }
    });
    this.setActive(best);
  };

  onPointerUp = (e: Event) => {
    const pe = e as PointerEvent;
    const btn = pe.currentTarget as HTMLElement;
    const pressedFmt = btn.dataset['fmt'] as Format | undefined;
    if (btn.hasPointerCapture(pe.pointerId)) {
      btn.releasePointerCapture(pe.pointerId);
    }
    this.isDragging = false;
    if (pressedFmt && pressedFmt !== this.args.format) {
      this.suppressNextClick = true;
    }
  };

  // ── Modifier ─────────────────────────────────────────────────────────

  registerBtn = modifier((el: HTMLElement, [fmt]: [Format]) => {
    this.btnEls.set(fmt, el);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    return () => {
      if (this.btnEls.get(fmt) === el) this.btnEls.delete(fmt);
      el.removeEventListener('pointerdown', this.onPointerDown);
      el.removeEventListener('pointermove', this.onPointerMove);
      el.removeEventListener('pointerup', this.onPointerUp);
      el.removeEventListener('pointercancel', this.onPointerUp);
    };
  });

  // ── Template ─────────────────────────────────────────────────────────

  <template>
    <div class='format-chooser' ...attributes>
      <div
        class='format-chooser__buttons {{if this.isDragging "dragging"}}'
        style={{this.gridStyle}}
        {{on 'mouseleave' this.clearHovered}}
      >
        <div
          class='format-pill {{if this.pillIsAtActive "is-active"}}'
          style={{this.pillStyle}}
          aria-hidden='true'
        ></div>
        {{#each this.formats as |f|}}
          {{#if (or (eq f.format 'metadata') (eq f.format 'edit'))}}
            <span class='format-chooser__divider'></span>
          {{/if}}
          <Button
            @size='auto'
            class={{cn
              'format-chooser__button'
              active=(eq @format f.format)
              is-target=(eq this.pillTargetFmt f.format)
            }}
            {{on 'click' (fn this.onClick f.format)}}
            {{on 'mouseenter' (fn this.setHovered f.format)}}
            {{this.registerBtn f.format}}
            data-fmt={{f.format}}
            data-test-format-chooser={{f.format}}
          >
            {{#if f.icon}}
              <f.icon class='format-icon' />
              <span class='format-name'>{{f.format}}</span>
            {{else}}
              {{f.format}}
            {{/if}}
          </Button>
          {{! TODO in CS-8701: show indicator when custom template exists }}
        {{/each}}
      </div>
    </div>
    <style scoped>
      .format-chooser {
        height: var(--boxel-format-chooser-height);
        display: flex;
        justify-content: center;
        align-items: center;
        background-color: var(--boxel-dark);
        overflow: hidden;
      }

      /* grid-template-columns set via inline style; transition animates
         column width changes so layout and pill stay in sync. */
      .format-chooser__buttons {
        position: relative;
        display: grid;
        align-items: center;
        gap: var(--boxel-sp-3xs);
        width: 100%;
        padding: var(--boxel-sp-2xs);
        border: 0;
        border-radius: var(--boxel-border-radius);
        box-shadow: var(--boxel-deep-box-shadow);
        user-select: none;
        transition: grid-template-columns 320ms cubic-bezier(0.4, 0, 0.2, 1);
      }

      .format-chooser__buttons.dragging {
        cursor: grabbing;
        transition: grid-template-columns 60ms cubic-bezier(0.2, 0, 0, 1);
      }

      /* Pill slides via transform; width matches the target column width
         (both computed from the same JS data as grid-template-columns). */
      .format-pill {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        margin-block: auto;
        box-sizing: border-box;
        height: calc(var(--boxel-button-sm) - 2px);
        border-radius: var(--boxel-border-radius-2xl);
        border: 1.5px solid
          color-mix(in oklch, var(--boxel-light) 55%, transparent);
        pointer-events: none;
        z-index: 0;
        will-change: transform;
        transition:
          transform 320ms cubic-bezier(0.4, 0, 0.2, 1),
          border-color 200ms ease;
      }

      .format-pill.is-active {
        border-color: var(--boxel-highlight);
      }

      .format-chooser__buttons.dragging .format-pill {
        transition:
          transform 60ms cubic-bezier(0.2, 0, 0, 1),
          border-color 200ms ease;
      }

      .format-chooser__button {
        --boxel-button-color: transparent;
        --boxel-button-font: 600 var(--boxel-font-xs);
        --boxel-button-text-color: var(--boxel-light);
        --boxel-button-letter-spacing: 0;
        width: 100%;
        height: calc(var(--boxel-button-sm) - 2px);
        padding-inline: var(--boxel-sp-2xs);
        border-color: transparent;
        border-radius: var(--boxel-border-radius-2xl);
        text-transform: capitalize;
        overflow: hidden;
        opacity: 0.55;
        position: relative;
        z-index: 1;
        transition: opacity 180ms ease;
        cursor: pointer;
      }

      .format-chooser__button.active,
      .format-chooser__button.is-target {
        --boxel-button-text-color: var(--boxel-highlight);
        opacity: 1;
      }

      .format-chooser__buttons.dragging .format-chooser__button {
        cursor: grabbing;
      }

      .format-chooser__divider {
        width: 1px;
        height: 18px;
        align-self: center;
        justify-self: center;
        background-color: var(--boxel-500);
        opacity: 0.35;
      }

      .format-icon {
        width: 1rem;
        height: 1rem;
        flex: 0 0 1rem;
      }

      /* Label is clipped by overflow:hidden at collapsed column width;
         opacity transitions in when the column expands for the target. */
      .format-name {
        white-space: nowrap;
        overflow: hidden;
        flex-shrink: 1;
        min-width: 0;
        margin-left: var(--boxel-sp-3xs);
        opacity: 0;
        transition: opacity 200ms ease;
      }

      .format-chooser__button.is-target .format-name {
        opacity: 1;
      }
    </style>
  </template>

  private get formats(): FormatWithIcon[] {
    return this.args.formatsWithIcons ?? formatsWithIcons;
  }
}
