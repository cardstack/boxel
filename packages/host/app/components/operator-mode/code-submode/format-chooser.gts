import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import { htmlSafe, type SafeString } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import MetadataIcon from '@cardstack/boxel-icons/clipboard-data';
import MarkdownIcon from '@cardstack/boxel-icons/markdown';
import EditIcon from '@cardstack/boxel-icons/pencil';
import { modifier } from 'ember-modifier';
import window from 'ember-window-mock';

import { Button, Tooltip } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';
import {
  Isolated as IsolatedIcon,
  Embedded as EmbeddedIcon,
  Fitted as FittedIcon,
  Atom as AtomIcon,
  Head as HeadIcon,
  Form as FormIcon,
  type Icon,
} from '@cardstack/boxel-ui/icons';

import { formats, type Format } from '@cardstack/runtime-common';

type FormatWithIcon = {
  format: Format;
  icon?: Icon | null;
  hasDivider?: boolean;
};

export const formatIcons: Partial<Record<Format, Icon>> = {
  isolated: IsolatedIcon,
  embedded: EmbeddedIcon,
  atom: AtomIcon,
  fitted: FittedIcon,
  edit: EditIcon,
  form: FormIcon,
  head: HeadIcon,
  markdown: MarkdownIcon,
  metadata: MetadataIcon,
};

interface Signature {
  Args: {
    format: Format;
    setFormat: (format: Format) => void;
    formats?: Format[];
  };
  Element: HTMLElement;
}

interface FormatButtonSignature {
  Args: {
    activeFormat: Format;
    format: Format;
    icon?: Icon | null;
    pillTargetFmt: Format;
    previewFmt: Format | null;
    registerBtn: unknown;
    onClick: () => void;
  };
  Element: HTMLButtonElement;
}

const FormatButton: TemplateOnlyComponent<FormatButtonSignature> = <template>
  <Button
    @size='auto'
    class={{cn
      'pf-btn'
      active=(eq @activeFormat @format)
      is-hover=(eq @previewFmt @format)
      pill-visible=(eq @format @pillTargetFmt)
    }}
    type='button'
    data-fmt={{@format}}
    aria-label={{@format}}
    aria-pressed={{eq @activeFormat @format}}
    title={{@format}}
    data-test-format-chooser={{@format}}
    {{! @glint-ignore }}
    {{@registerBtn @format}}
    {{on 'click' @onClick}}
  >
    {{#if @icon}}
      {{! md icon is larger because tabler icons have extra padding which shrinks them }}
      <@icon
        class='pf-icon'
        width={{if (eq @format 'markdown') '24' ICON_W}}
        height={{if (eq @format 'markdown') '24' ICON_W}}
      />
    {{/if}}
  </Button>
  <style scoped>
    /* Buttons — rectangular hit-targets above pill containers (z-index 5).
       Height matches --pf-pill-h so button icons align with pill icon. */
    .pf-btn {
      --boxel-button-color: transparent;
      --boxel-button-text-color: inherit;
      --boxel-button-padding: 0;

      width: 100%;
      height: var(--pf-pill-h);
      min-width: var(--pf-pill-h);
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
    /* The pill carries the icon for its current button, so that button hides
       its own icon. While previewing, the hovered button hides its icon and
       the active button shows its icon in green ("currently selected"). */
    .pf-btn.active {
      color: var(--pf-active-color);
      opacity: 1;
    }
    .pf-icon {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
  </style>
</template>;

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
const BTN_COL_W = 32; // fixed width for non-active, non-previewed buttons
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
    return BTN_COL_W;
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
  // Smallest ancestor clientWidth, updated by ResizeObserver.
  // Also reacts to active-format changes, which shift natural width without a resize event.
  @tracked private parentWidth: number = Infinity;

  private rowEl: HTMLElement | null = null;
  private buttonEls: Map<Format, HTMLElement> = new Map();

  private get argFormats(): Format[] {
    return (this.args.formats ?? formats) as Format[];
  }

  private get availableFormatsWithIcons(): FormatWithIcon[] {
    return this.argFormats.map((f) => {
      let hasDivider =
        f === 'edit' || (!this.argFormats.includes('edit') && f === 'head');
      return {
        format: f,
        icon: formatIcons[f] ?? null,
        hasDivider,
      };
    });
  }

  private get pillTargetIcon(): Icon | null {
    return formatIcons[this.pillTargetFmt] ?? null;
  }

  private setActive = (f: Format) => {
    if (f === this.args.format) return;
    this.args.setFormat(f);
  };

  get hasPreview(): boolean {
    return this.previewFmt !== null && this.previewFmt !== this.args.format;
  }

  private get previewFmt(): Format | null {
    return this.hoveredFmt;
  }

  /* One column wider at a time: hovered (preview) or active (rest). */
  private colWidthFor(f: Format): number {
    if (this.hasPreview) {
      return f === this.previewFmt
        ? pillWidthFor(f, this.isCompact)
        : BTN_COL_W;
    }
    return f === this.args.format ? pillWidthFor(f, this.isCompact) : BTN_COL_W;
  }

  get gridStyle(): SafeString {
    const cols: string[] = [];
    const fmts = this.availableFormatsWithIcons;
    for (const f of fmts) {
      if (f.hasDivider && fmts.indexOf(f) > 0) {
        cols.push(`${DIVIDER_COL_W}px`);
      }
      cols.push(`${this.colWidthFor(f.format)}px`);
    }
    return htmlSafe(`grid-template-columns: ${cols.join(' ')};`);
  }

  /* Center X of a format button under the current grid layout. */
  private centerXFor(target: Format): number {
    let x = PAD_LEFT;
    let isFirst = true;
    const fmts = this.availableFormatsWithIcons;
    for (const f of fmts) {
      if (f.hasDivider && fmts.indexOf(f) > 0) {
        // divider col + btn col separated by two gaps
        x += GAP_PX + DIVIDER_COL_W + GAP_PX;
      } else {
        if (!isFirst) x += GAP_PX;
        isFirst = false;
      }
      const w = this.colWidthFor(f.format);
      if (f.format === target) return x + w / 2;
      x += w;
    }
    return x;
  }

  // Pill tracks hoveredFmt while previewing, active format at rest.
  get pillTargetFmt(): Format {
    return this.previewFmt ?? this.args.format;
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
      if (found !== null) this.hoveredFmt = found;
    };
    const onMouseLeave = () => {
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
    const fmts = this.availableFormatsWithIcons;
    for (const f of fmts) {
      if (f.hasDivider && fmts.indexOf(f) > 0) {
        natural += GAP_PX + DIVIDER_COL_W + GAP_PX;
      } else {
        if (!isFirst) natural += GAP_PX;
        isFirst = false;
      }
      natural +=
        f.format === this.args.format
          ? pillWidthFor(f.format, false)
          : BTN_COL_W;
    }
    return this.parentWidth < natural;
  }

  registerBtn = modifier((el: HTMLElement, [fmt]: [Format]) => {
    this.buttonEls.set(fmt, el);
    return () => {
      if (this.buttonEls.get(fmt) === el) this.buttonEls.delete(fmt);
    };
  });

  onClick = (f: Format) => {
    this.setActive(f);
  };

  <template>
    <div
      class={{cn
        'pill-format-chooser'
        has-preview=this.hasPreview
        compact=this.isCompact
      }}
      style={{this.gridStyle}}
      role='group'
      aria-label='Card format'
      data-test-format-chooser-root
      data-test-format-chooser-mode={{if this.isCompact 'compact' 'full'}}
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
            <this.pillTargetIcon
              class='pf-icon'
              width={{ICON_W}}
              height={{ICON_W}}
            />
          {{/if}}
          <span
            class='pf-label'
            data-test-format-chooser-pill-label
          >{{this.pillTargetFmt}}</span>
        </div>
      </div>

      {{#each this.availableFormatsWithIcons key='format' as |fw i|}}
        {{#if fw.hasDivider}}
          {{#unless (eq i 0)}}
            <span class='pf-divider'></span>
          {{/unless}}
        {{/if}}
        {{#if this.isCompact}}
          <Tooltip @placement='top'>
            <:trigger>
              <FormatButton
                @activeFormat={{@format}}
                @format={{fw.format}}
                @icon={{fw.icon}}
                @pillTargetFmt={{this.pillTargetFmt}}
                @previewFmt={{this.previewFmt}}
                @registerBtn={{this.registerBtn}}
                @onClick={{fn this.onClick fw.format}}
              />
            </:trigger>
            <:content>
              <span class='pf-tooltip-label'>{{fw.format}}</span>
            </:content>
          </Tooltip>
        {{else}}
          <FormatButton
            @activeFormat={{@format}}
            @format={{fw.format}}
            @icon={{fw.icon}}
            @pillTargetFmt={{this.pillTargetFmt}}
            @previewFmt={{this.previewFmt}}
            @registerBtn={{this.registerBtn}}
            @onClick={{fn this.onClick fw.format}}
          />
        {{/if}}
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

        --pf-height: var(
          --container-button-size,
          var(--boxel-form-control-height)
        );
        --pf-bg: var(--boxel-dark);
        --pf-color: var(--boxel-light);
        --pf-active-color: var(--boxel-highlight);

        --pf-btn-opacity: 0.55;
        --pf-divider-color: var(--boxel-500);
        --pf-preview-color: var(--boxel-200);

        --pf-transition: 320ms cubic-bezier(0.4, 0, 0.2, 1);
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
        overflow: hidden;
        background-color: var(--pf-bg);
        color: var(--pf-color);
        border-radius: var(--boxel-border-radius-2xl);
        transition: grid-template-columns var(--pf-transition);
      }
      .pill-format-chooser:not(.has-preview) {
        --pf-preview-color: var(--pf-active-color);
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
        z-index: 6;
        pointer-events: none;
        transition: transform var(--pf-transition);
        will-change: transform;
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

      /* Compact mode — parent too narrow for the full pill; collapse to icon-only. */
      .pill-format-chooser.compact .pill-content .pf-label {
        display: none;
      }

      .pf-tooltip-label {
        text-transform: capitalize;
      }
    </style>
  </template>
}
