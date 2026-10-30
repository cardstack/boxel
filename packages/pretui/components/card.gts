// Pretui — Card: the hairline surface with header, media, body and footer bands.
import Component from '@glimmer/component';
import { guidFor } from '@ember/object/internals';
import { on } from '@ember/modifier';
import { OWNS_PRESS, listen } from '../focus';
import type {
  PretuiAppearance,
  PretuiSize,
  PretuiTone,
} from '../pretui-primitives';
import { pretuiOrientation, pretuiSize } from '../internal/structure-layout';
import type {
  Orientation,
  OrientationAlias,
  SizeAlias,
} from '../internal/structure-layout';

// ── Card ─────────────────────────────────────────────────────────────────
//
// Sources read: shadcn-ui card.tsx (Card / CardHeader / CardTitle /
// CardDescription / CardAction / CardContent / CardFooter),
// mantine Card + Card.Section, chakra card.
//
// **The name collision, stated first because it will otherwise cost a week.**
// Pretui already has two things an agent might mean by "Card":
//
//   • `CopyFit` (fitted.gts) is a container-query IDENTITY — one design
//     that re-cuts itself across badge / strip / tile / card sizes. It is what
//     a Boxel record looks like at whatever size the grid gives it.
//   • `Panel` (structure.gts) is a SURFACE — body, hairline, action bar.
//
// React's `Card` is neither. It is a COMPOSITION SHAPE: header (title +
// description + an action parked top-end), optional media, body, footer. That
// is what this is, and it deliberately reuses Panel's surface recipe rather
// than inventing a third one — same `--card`, same `--radius-surface`, same
// `--pretui-shadow-*` ladder — so the kit still reads as one system.
//
// What upstream gets wrong, and what is fixed:
//
//   1. **shadcn's action slot is a `:has()` hack on a data attribute**
//      (`has-data-[slot=card-action]:grid-cols-[1fr_auto]`), which means the
//      header silently reverts to one column if you nest the action one level
//      deeper. Here the component knows whether the block was passed
//      (`has-block`) and reflects `data-has-action`, so nesting cannot break
//      it and no `:has()` is required at all.
//   2. **Every shadcn part is a `<div>`.** `CardTitle` is a div with
//      `font-semibold` — no heading level, no `role`, so a page of cards has
//      no document outline, and nothing wires `aria-labelledby`, so a card
//      used as a region has no accessible name. Here the title is an `<h3>`
//      with an id and the `<section>` is `aria-labelledby` it, so a card is a
//      named region the moment it has a title and nothing extra when it
//      does not.
//   3. **No focus treatment on a clickable card.** Every kit's "interactive
//      card" recipe is a hover shadow. A card whose only control is reached by
//      Tab then shows nothing. `@interactive` adds `:focus-within` here, which
//      is the state that actually exists when a keyboard user is in the card.
//   4. **Mantine's root is unconditionally `overflow: hidden`**, which clips
//      every Popover, Menu, Tooltip and focus ring rendered inline inside a
// card — and the kit renders overlays in place. Here the
//      root does NOT clip; the media band carries its own corner radii and
//      its own `overflow: hidden`, which is the only place clipping was ever
//      needed.
//   5. **Mantine positions sections by sniffing `child.type === CardSection`**
//      with a `displayName` string fallback, so wrapping a section in a memo
//      or an HOC silently stops the full-bleed trick. Named blocks cannot be
//      wrapped away.
//   6. **Tone is a colour prop.** Chakra/Mantine spell card emphasis as
//      `variant` + `colorPalette` resolved in a theme file the component
// cannot document. This takes the kit's tone × appearance grid, so a
//      `danger` `filled` card is the same recipe as a `danger` `filled`
//      Button rather than a parallel table.
//   7. **`className` is the styling API upstream.** Here it is tokens plus
//      `...attributes`; `--pretui-card-pad` / `-radius` / `-gap` are the knobs.

/** What keeps its own clicks inside a selectable card: every control the
 * kit treats as owning a press, plus native media, embeds and inline
 * overlays. The walk runs over the composed path, so the controls inside an
 * open shadow root (media-chrome's buttons) count too. */
const KEEPS_ITS_CLICK = [
  OWNS_PRESS,
  '[tabindex]',
  'video',
  'audio',
  'iframe',
  'object',
  'embed',
  'dialog',
  '[popover]',
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="tooltip"]',
  '[role="slider"]',
].join(', ');

export type CardAppearance = Exclude<PretuiAppearance, 'accent'> | 'accent';

export interface CardSignature {
  Args: {
    /** Header title. Sugar for `<:title>`; the block wins when both exist. */
    title?: string;
    /** Header supporting line. Sugar for `<:description>`. */
    description?: string;
    /** Small uppercase line above the title. */
    eyebrow?: string;
    /** Tone. Default `neutral`. */
    tone?: PretuiTone;
    /** Appearance. Default `outlined` — the hairline surface. */
    appearance?: CardAppearance;
    /** Size; sets the host font-size, everything inside is em. */
    size?: SizeAlias;
    /** `vertical` (default) stacks media above the body; `horizontal` puts
     * media on the start edge. `direction` is accepted as an alias. */
    orientation?: Orientation;
    direction?: OrientationAlias;
    /**
     * The card contains a control and should react as one surface: hover
     * elevation plus a `:focus-within` ring. It does NOT make the card itself
     * clickable — a card-sized `<button>` around arbitrary content is a
     * nested-interactive trap, and the caller's own link stays the target.
     */
    interactive?: boolean;
    /** Body scrolls instead of growing; the caller supplies the height. */
    scroll?: boolean;
    /** Selected state: a tint plus an inline-start rule, and `aria-pressed`
     * on the select control when `@onSelect` is set. */
    selected?: boolean;
    /**
     * Makes the whole surface a select target. One full-size `<button>` sits
     * BEHIND the content as a sibling, so the card's own links and buttons
     * stay valid, stay their own targets, and never bubble into it.
     */
    onSelect?: () => void;
    /** The select control's name. Defaults to the generated title. */
    selectLabel?: string;
  };
  Blocks: {
    /** Replaces the whole generated header — for a header carrying controls. */
    header: [];
    /** Just the title line, when it needs markup. */
    title: [];
    /** Just the description line, when it needs markup. */
    description: [];
    /** Parked at the header's end edge, spanning both header rows. */
    action: [];
    /** A full-bleed band above the body — an AspectRatio, a chart, a map. */
    media: [];
    /** The body. */
    default: [];
    /** The footer band, below a hairline. */
    footer: [];
  };
  Element: HTMLElement;
}

/**
 * Header / media / body / footer composition.
 *
 * ```hbs
 * <Card @title='Lot B-104' @description='Darjeeling first flush'>
 *   <:action><IconButton @label='More' /></:action>
 *   <:media><AspectRatio @ratio='16 / 9' @src={{this.photo}} /></:media>
 *   <:default>…</:default>
 *   <:footer><Button>Open</Button></:footer>
 * </Card>
 * ```
 *
 * Named-block rule: once ANY named block is present, wrap the body in
 * `<:default>`. Loose content beside named blocks passes `boxel parse` and
 * fails the realm transpile with "the tag cannot contain other content".
 */
export class Card extends Component<CardSignature> {
  /** The heading's id, so the `<section>` can be `aria-labelledby` it. Only
   * referenced when this component GENERATED the heading — a caller who
   * replaces the whole header with `<:header>` owns the naming. */
  titleId = `${guidFor(this)}-title`;
  /** The title labels the card unless a custom header owns the top. */
  labelledBy = (
    hasHeader: boolean,
    hasTitleBlock: boolean,
  ): string | undefined =>
    !hasHeader && (hasTitleBlock || this.args.title) ? this.titleId : undefined;

  get tone(): PretuiTone {
    return this.args.tone ?? 'neutral';
  }
  get appearance(): CardAppearance {
    return this.args.appearance ?? 'outlined';
  }
  get size(): PretuiSize {
    return pretuiSize(this.args.size);
  }
  /** Names the select control by the title unless `@selectLabel` does. */
  selectLabelledBy = (
    hasHeader: boolean,
    hasTitleBlock: boolean,
  ): string | undefined =>
    this.args.selectLabel
      ? undefined
      : this.labelledBy(hasHeader, hasTitleBlock);

  /** A click anywhere on a selectable card selects it, unless it landed on
   * something that keeps its own click, or ends a text selection. The card's
   * content stays fully interactive: scrolling, media, hover tooltips and
   * drag-selecting text all work as they would outside the card. */
  onSurfaceClick = (event: Event) => {
    let onSelect = this.args.onSelect;
    if (!onSelect) {
      return;
    }
    let card = event.currentTarget as HTMLElement;
    for (let node of event.composedPath()) {
      if (node === card) {
        break;
      }
      let el = node as Element;
      if (typeof el.matches === 'function' && el.matches(KEEPS_ITS_CLICK)) {
        return;
      }
    }
    let selection = card.ownerDocument.getSelection();
    if (
      selection &&
      !selection.isCollapsed &&
      selection.anchorNode &&
      card.contains(selection.anchorNode)
    ) {
      return;
    }
    onSelect();
  };

  get orientation(): Orientation {
    return pretuiOrientation(
      this.args.orientation,
      this.args.direction,
      'vertical',
    );
  }

  <template>
    <section
      class='pretui-card'
      data-tone={{this.tone}}
      data-appearance={{this.appearance}}
      data-size={{this.size}}
      data-orientation={{this.orientation}}
      data-interactive={{if @interactive 'true' 'false'}}
      data-scroll={{if @scroll 'true' 'false'}}
      data-selected={{if @selected 'true' 'false'}}
      data-selectable={{if @onSelect 'true' 'false'}}
      aria-labelledby={{this.labelledBy
        (has-block 'header')
        (has-block 'title')
      }}
      data-test-pretui-card
      ...attributes
      {{listen 'click' this.onSurfaceClick}}
    >
      {{#if @onSelect}}
        <button
          type='button'
          class='pretui-card-select'
          aria-pressed={{if @selected 'true' 'false'}}
          aria-label={{@selectLabel}}
          aria-labelledby={{this.selectLabelledBy
            (has-block 'header')
            (has-block 'title')
          }}
          data-test-pretui-card-select
          {{on 'click' @onSelect}}
        ></button>
      {{/if}}
      {{#if (has-block 'media')}}
        <div class='pretui-card-media'>{{yield to='media'}}</div>
      {{/if}}

      <div class='pretui-card-column'>
        {{#if (has-block 'header')}}
          <header class='pretui-card-header' data-has-action='false'>
            {{yield to='header'}}
          </header>
        {{else if (has-block 'title')}}
          <header
            class='pretui-card-header'
            data-has-action={{if (has-block 'action') 'true' 'false'}}
          >
            <div class='pretui-card-heading'>
              {{#if @eyebrow}}
                <span class='pretui-eyebrow'>{{@eyebrow}}</span>
              {{/if}}
              <h3 id={{this.titleId}} class='pretui-card-title'>{{yield
                  to='title'
                }}</h3>
              {{#if (has-block 'description')}}
                <p class='pretui-card-desc'>{{yield to='description'}}</p>
              {{else if @description}}
                <p class='pretui-card-desc'>{{@description}}</p>
              {{/if}}
            </div>
            {{#if (has-block 'action')}}
              <div class='pretui-card-action'>{{yield to='action'}}</div>
            {{/if}}
          </header>
        {{else if @title}}
          <header
            class='pretui-card-header'
            data-has-action={{if (has-block 'action') 'true' 'false'}}
          >
            <div class='pretui-card-heading'>
              {{#if @eyebrow}}
                <span class='pretui-eyebrow'>{{@eyebrow}}</span>
              {{/if}}
              <h3 id={{this.titleId}} class='pretui-card-title'>{{@title}}</h3>
              {{#if (has-block 'description')}}
                <p class='pretui-card-desc'>{{yield to='description'}}</p>
              {{else if @description}}
                <p class='pretui-card-desc'>{{@description}}</p>
              {{/if}}
            </div>
            {{#if (has-block 'action')}}
              <div class='pretui-card-action'>{{yield to='action'}}</div>
            {{/if}}
          </header>
        {{/if}}

        <div class='pretui-card-body'>{{yield}}</div>

        {{#if (has-block 'footer')}}
          <footer class='pretui-card-footer'>{{yield to='footer'}}</footer>
        {{/if}}
      </div>
    </section>

    <style scoped>
      @layer PretComponent {
        .pretui-card {
          --pretui-tone: var(--foreground);
          --pretui-tone-on: var(--background);
          display: flex;
          flex-direction: column;
          min-inline-size: 0;
          box-sizing: border-box;
          border-radius: var(--pretui-card-radius, var(--radius-surface, 10px));
          color: var(--card-foreground);
          font-size: var(--pretui-size-m, var(--boxel-font-size-xs));
          letter-spacing: var(--track-ui, 0.01em);
          /* Deliberately NOT `overflow: hidden`. Mantine clips its card root
             unconditionally, which kills every Popover, Menu and Tooltip
             rendered inline inside a card — and this kit renders overlays in
             place. Only the media band ever needed clipping, and
             it carries its own corners below. */
          transition: box-shadow var(--pretui-dur-snap, 180ms)
            var(--pretui-ease-snap, ease);
        }
        /* size — font-size only; every internal dimension below is em, so one
           declaration scales the whole card. */
        .pretui-card[data-size='xs'] {
          font-size: var(--pretui-size-xs, var(--boxel-font-size-2xs));
        }
        .pretui-card[data-size='s'] {
          font-size: var(--pretui-size-s, var(--boxel-font-size-2xs));
        }
        .pretui-card[data-size='l'] {
          font-size: var(--pretui-size-l, var(--boxel-font-size-sm));
        }
        .pretui-card[data-size='xl'] {
          font-size: var(--pretui-size-xl, var(--boxel-font-size));
        }
        /* tone — one hue token in, the appearance recipes below read it out,
           written once. */
        .pretui-card[data-tone='primary'] {
          --pretui-tone: var(--primary);
          --pretui-tone-on: var(--primary-foreground);
        }
        .pretui-card[data-tone='info'] {
          --pretui-tone: var(--pretui-info, var(--boxel-blue));
          --pretui-tone-on: var(--pretui-on-info, var(--background));
        }
        .pretui-card[data-tone='success'] {
          --pretui-tone: var(--success, var(--boxel-success));
          --pretui-tone-on: var(--pretui-on-success, var(--background));
        }
        .pretui-card[data-tone='warning'] {
          --pretui-tone: var(--warning, var(--boxel-warning));
          --pretui-tone-on: var(--pretui-on-warning, var(--background));
        }
        .pretui-card[data-tone='danger'] {
          --pretui-tone: var(--destructive);
          --pretui-tone-on: var(--destructive-foreground);
        }
        .pretui-card[data-tone='attention'] {
          --pretui-tone: var(--attention);
          --pretui-tone-on: var(--pretui-on-attention, var(--background));
        }
        /* appearance — the five canonical recipes, reading the tone channel. */
        .pretui-card[data-appearance='outlined'] {
          background: var(--pretui-card-bg, var(--card));
          box-shadow: var(
            --pretui-card-shadow,
            var(--pretui-shadow-card, 0 0 0 1px var(--border))
          );
        }
        .pretui-card[data-appearance='filled'] {
          background: var(
            --pretui-card-bg,
            color-mix(in oklch, var(--pretui-tone) 12%, var(--card))
          );
        }
        .pretui-card[data-appearance='filled-outlined'] {
          background: var(
            --pretui-card-bg,
            color-mix(in oklch, var(--pretui-tone) 12%, var(--card))
          );
          box-shadow: var(
            --pretui-card-shadow,
            0 0 0 1px color-mix(in oklch, var(--pretui-tone) 32%, var(--border))
          );
        }
        .pretui-card[data-appearance='accent'] {
          background: var(--pretui-card-bg, var(--pretui-tone));
          color: var(--pretui-tone-on);
        }
        .pretui-card[data-appearance='plain'] {
          background: none;
        }
        /* horizontal — media on the START edge, logical so RTL flips for free */
        .pretui-card[data-orientation='horizontal'] {
          flex-direction: row;
          align-items: stretch;
        }
        .pretui-card[data-orientation='horizontal'] .pretui-card-media {
          flex: none;
          inline-size: var(--pretui-card-media-size, 34%);
        }
        .pretui-card-column {
          display: flex;
          flex-direction: column;
          min-inline-size: 0;
          min-block-size: 0;
          flex: 1 1 auto;
        }
        /* The media band is the only part that has to clip, and it owns the
           two corners it touches — logical, so RTL costs nothing. */
        .pretui-card-media {
          min-inline-size: 0;
          overflow: hidden;
          border-start-start-radius: var(
            --pretui-card-radius,
            var(--radius-surface, 10px)
          );
          border-start-end-radius: var(
            --pretui-card-radius,
            var(--radius-surface, 10px)
          );
        }
        .pretui-card[data-orientation='horizontal'] .pretui-card-media {
          border-start-end-radius: 0;
          border-end-start-radius: var(
            --pretui-card-radius,
            var(--radius-surface, 10px)
          );
        }
        /* The header grid. Two rows so an action parked at the end edge spans
           eyebrow+title+description without any measurement — the column count
           comes from a reflected attribute the component OWNS, not from a
           `:has()` probe that a nested action defeats. */
        .pretui-card-header {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          align-items: start;
          gap: var(--pretui-card-gap, 0.9em);
          padding: var(--pretui-card-pad, 1.1em) var(--pretui-card-pad, 1.1em) 0;
        }
        .pretui-card-header[data-has-action='true'] {
          grid-template-columns: minmax(0, 1fr) auto;
        }
        .pretui-card-heading {
          display: grid;
          gap: 0.15em;
          min-inline-size: 0;
        }
        .pretui-card-action {
          grid-column: 2;
          grid-row: 1;
          justify-self: end;
          align-self: start;
        }
        .pretui-card-title {
          margin: 0;
          font-size: 1.12em;
          font-weight: 600;
          letter-spacing: var(--track-heading, -0.02em);
          min-inline-size: 0;
        }
        .pretui-card-desc {
          margin: 0;
          font-size: 0.94em;
          color: var(--muted-foreground);
          min-inline-size: 0;
        }
        .pretui-eyebrow {
          font-family: var(--font-mono);
          font-size: 0.86em;
          font-weight: 500;
          letter-spacing: var(--track-eyebrow, 0.08em);
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        .pretui-card-body {
          padding: var(--pretui-card-pad, 1.1em);
          min-inline-size: 0;
          flex: 1 1 auto;
        }
        .pretui-card-footer {
          display: flex;
          align-items: center;
          gap: 0.65em;
          padding: 0.75em var(--pretui-card-pad, 1.1em);
          box-shadow: 0 -1px 0 var(--border);
          flex: none;
        }
        /* scroll — the body is the part that moves; header and footer pin. */
        .pretui-card[data-scroll='true'] {
          min-block-size: 0;
        }
        .pretui-card[data-scroll='true'] .pretui-card-body {
          min-block-size: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          scrollbar-gutter: stable;
        }
        /* interactive — hover for the pointer, focus-within for the keyboard.
           The second half is what every source library omits. */
        .pretui-card[data-interactive='true']:hover {
          box-shadow: var(
            --pretui-card-shadow-hover,
            var(
              --pretui-shadow-raised,
              0 0 0 1px var(--border),
              0 2px 10px var(--shadow-ink-mid, rgb(0 0 0 / 0.08))
            )
          );
        }
        .pretui-card[data-interactive='true']:not(
            [data-selectable='true']
          ):focus-within {
          box-shadow: 0 0 0 2px var(--ring);
        }
        /* selectable — the select button sits BEHIND the content, as wide as
           the card, so its focus ring outlines the card. It carries the
           keyboard and the accessible name; pointer clicks land on the
           content and select through the card's own click handler. The
           content is positioned (z-index auto) only so it paints after the
           button: no z-index is set and no stacking context is created, so an
           inline Popup or Menu still rises above neighbouring cards. */
        .pretui-card[data-selectable='true'] {
          position: relative;
          cursor: pointer;
        }
        .pretui-card-select {
          all: unset;
          position: absolute;
          inset: 0;
          border-radius: inherit;
        }
        .pretui-card-select:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-card[data-selectable='true'] > .pretui-card-media,
        .pretui-card[data-selectable='true'] > .pretui-card-column {
          position: relative;
        }
        .pretui-card[data-selectable='true']:hover {
          box-shadow: var(
            --pretui-card-shadow-hover,
            var(
              --pretui-shadow-raised,
              0 0 0 1px var(--border),
              0 2px 10px var(--shadow-ink-mid, rgb(0 0 0 / 0.08))
            )
          );
        }
        /* Selection reads in greyscale: a rule on the inline start, not the
           tint alone. Same recipe as List. */
        .pretui-card[data-selected='true'] {
          position: relative;
        }
        /* The tint is laid OVER the appearance's own fill, so a tone fill or
           a caller's --pretui-card-bg still shows through. plain has no fill
           to tint and accent's on-tone ink would be unreadable on it; both
           carry selection on the rule alone. */
        .pretui-card[data-selected='true']:is(
            [data-appearance='outlined'],
            [data-appearance='filled'],
            [data-appearance='filled-outlined']
          ) {
          background-image: linear-gradient(
            color-mix(
              in oklch,
              var(--pretui-selected, var(--boxel-100)) 70%,
              transparent
            ),
            color-mix(
              in oklch,
              var(--pretui-selected, var(--boxel-100)) 70%,
              transparent
            )
          );
        }
        /* ::after, last in paint order, so it draws over the media band
           without a z-index. */
        .pretui-card[data-selected='true']::after {
          content: '';
          position: absolute;
          inset-block: 0;
          inset-inline-start: 0;
          inline-size: 2px;
          border-start-start-radius: inherit;
          border-end-start-radius: inherit;
          background: var(--primary);
          pointer-events: none;
        }
        .pretui-card[data-selected='true'][data-appearance='accent']::after {
          inline-size: 3px;
          background: var(--pretui-tone-on);
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-card {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
