// Pretui — HeroSplit: a two-column hero: headline and actions beside media.
import Component from '@glimmer/component';
import { guidFor } from '@ember/object/internals';
import { Chip } from './chip';
import { MediaViewer } from './media-viewer';
import type { MediaAssetSpec } from '../internal/media-viewer';
import { cssStyle } from '../pretui-css';
import { ariaLevelFor } from '../internal/blocks';
import type { BlockHeadingLevel } from '../internal/blocks';

// ═════════════════════════════════════════════════════════════════════════
// B2 · HeroSplit
// ═════════════════════════════════════════════════════════════════════════
//
// From catalog-app's storefront-hero. Split grid: eyebrow / headline /
// lead / chip strip / dual CTA on one side, a media stage on the other.
//
// The three problems are all responsive, and this is what it does about
// each:
//
//   1. SOURCE ORDER IS ALWAYS CONTENT FIRST. The content column is the
//      first child of the grid in every configuration; `@mediaSide='start'`
//      moves the media visually with `order`, and only at wide widths.
//      A screen reader, a reading-mode extension and a keyboard tab pass
//      always meet the headline before the picture, which is the one
//      ordering that is never wrong.
//   2. AT NARROW WIDTHS the grid collapses to a single column and the
//      `order` override is cancelled at equal specificity, so the visual
//      order rejoins the source order — media below content, never a
//      picture ahead of the headline on a phone. The measurement is an
//      UNNAMED container query against the block's own box: a hero inside a
//      600px card pane must stack even when the viewport is 1600px wide.
//   3. THE MEDIA STAGE IS RATIO-HONEST. With no `@ratio`, the stage takes
//      the asset's intrinsic ratio and MediaViewer reserves the space
//      before the bytes arrive (the Law-8 corollary). With `@ratio`, the
//      stage holds exactly that box: a landscape asset letterboxes inside
//      it and a portrait asset is centred and clipped symmetrically, so a
//      row of heroes keeps its rhythm whatever the caller uploads. Nothing
//      is stretched and nothing overflows the grid.
//
// BETTER THAN THE INSPIRATION:
//   · Every chip and every line of copy was a literal in the template, so
//     the source could not be reused without a fork → all copy is args,
//     `@chips` is data, and the CTA is a named block so the caller supplies
//     real Buttons rather than a fixed pair of href/label pairs.
//   · `#11cf8a` twice as a hard literal (with a comment admitting it
//     diverged from `--primary` on purpose), plus `#15151b0a`, `#fbfaf5`
//     and `#ff5b9c` interpolated into `htmlSafe` styles → this block
//     authors no colour at all. Chips take a hue token; everything else is
//     inherited ink.
//   · The rotation was hard-capped at three images with per-`nth-child`
//     delays, had NO manual navigation, no `aria-live`, no
//     `aria-roledescription`, and animated `pointer-events` inside
//     keyframes → THE ROTATION IS GONE. A hero that cycles images is a
//     carousel, a carousel has state, and state is not a block's to own.
//     The kit already ships `Carousel` (structure-scroll.gts) with
//     navigation, keyboard support and a reduced-motion contract; a caller
//     who wants rotation puts one in the `<:media>` block and gets all of
//     that instead of a bespoke 12-second loop nobody can pause.
//   · The stage was welded to <img> → `@asset` goes through `MediaViewer`,
//     so a hero can lead with a video or an audio piece and the right
//     adapter is chosen without the caller knowing the kind.
//
// The stage never crops: ImageFrame fits the image inside a fixed `@ratio`.
// A hero that wants a cropped, edge-to-edge image passes its own in the
// media block.

export interface HeroChip {
  label: string;
  /** A tone token, e.g. `var(--success, var(--boxel-success))`. Validated by the kit's
   * CSS allowlist before it reaches a style attribute. */
  hue?: string;
  /** Show the leading dot. Off by default here: a hero chip is a feature
   * label, not a status. */
  dot?: boolean;
}

export interface HeroSplitSignature {
  Args: {
    /** Small line above the headline. */
    eyebrow?: string;
    /** The headline. Required — it is the block's accessible name. */
    headline: string;
    /** One paragraph under the headline. */
    lead?: string;
    /** The chip strip. Data, never markup. */
    chips?: readonly HeroChip[];
    /** The media stage's asset — image, video or audio. Routed by
     * MediaViewer, which reserves the space before it loads. */
    asset?: MediaAssetSpec;
    /** Which side the media sits on VISUALLY at wide widths. Source order
     * is always content-first regardless. Default `end`. */
    mediaSide?: 'start' | 'end';
    /** Hold the media stage at a fixed CSS `aspect-ratio` (`16 / 9`,
     * `4 / 3`). Omit it and the stage takes the asset's own ratio. */
    ratio?: string;
    /** Heading level for the headline in the host page. A hero is often
     * the page's `<h1>`. */
    headingLevel?: BlockHeadingLevel;
  };
  Blocks: {
    /** Replaces the media stage entirely — a Carousel, a Chart, a Scene. */
    media: [];
    /** The call-to-action controls. Buttons come from the caller so their
     * tone, appearance and behaviour are the caller's to choose. */
    actions: [];
    /** Anything under the actions — fine print, a trust strip. */
    default: [];
  };
  Element: HTMLElement;
}

export class HeroSplit extends Component<HeroSplitSignature> {
  private headlineId = guidFor(this) + '-headline';

  get mediaSide(): 'start' | 'end' {
    return this.args.mediaSide === 'start' ? 'start' : 'end';
  }
  get headingAriaLevel() {
    return ariaLevelFor(this.args.headingLevel);
  }
  get style() {
    return cssStyle('--pretui-hero-ratio', this.args.ratio);
  }
  get ratioMode(): string {
    return this.args.ratio ? 'fixed' : 'intrinsic';
  }
  get chips(): HeroChip[] {
    return (this.args.chips ?? []).map((chip) => ({
      label: chip.label,
      hue: chip.hue,
      dot: chip.dot ?? false,
    }));
  }

  <template>
    <section
      class='pretui-hero'
      style={{this.style}}
      data-media-side={{this.mediaSide}}
      aria-labelledby={{this.headlineId}}
      data-test-pretui-hero-split
      ...attributes
    >
      <div class='pretui-hero-grid'>
        {{! Content is ALWAYS the first child. `order` moves the picture,
            never the prose. }}
        <div class='pretui-hero-content'>
          {{#if @eyebrow}}
            <p class='pretui-hero-eyebrow'>{{@eyebrow}}</p>
          {{/if}}
          <h2
            id={{this.headlineId}}
            class='pretui-hero-headline'
            aria-level={{this.headingAriaLevel}}
          >{{@headline}}</h2>
          {{#if @lead}}
            <p class='pretui-hero-lead'>{{@lead}}</p>
          {{/if}}
          {{#if this.chips.length}}
            <ul class='pretui-hero-chips' role='list'>
              {{#each this.chips key='@index' as |chip|}}
                <li>
                  <Chip
                    @label={{chip.label}}
                    @hue={{chip.hue}}
                    @dot={{chip.dot}}
                  />
                </li>
              {{/each}}
            </ul>
          {{/if}}
          {{#if (has-block 'actions')}}
            <div
              class='pretui-hero-actions'
              data-test-pretui-hero-actions
            >{{yield to='actions'}}</div>
          {{/if}}
          {{yield}}
        </div>

        {{#if (has-block 'media')}}
          <div
            class='pretui-hero-media'
            data-ratio={{this.ratioMode}}
            data-test-pretui-hero-media
          >{{yield to='media'}}</div>
        {{else}}
          {{! Glint does not narrow an @arg through an else-if chain, so the
              nested if-block is what makes @asset non-optional here.
              Behaviour is identical. NB: a Glimmer comment ends at the first
              closing brace pair, so it can never quote curly syntax. }}
          {{#if @asset}}
            <div
              class='pretui-hero-media'
              data-ratio={{this.ratioMode}}
              data-test-pretui-hero-media
            >
              <MediaViewer @asset={{@asset}} />
            </div>
          {{/if}}
        {{/if}}
      </div>
    </section>

    <style scoped>
      @layer PretComponent {
        /* The block's own box is the query container. Unnamed — a NAMED
           container query silently deletes every rule after it. */
        .pretui-hero {
          container-type: inline-size;
          display: block;
        }
        .pretui-hero-grid {
          display: grid;
          grid-template-columns:
            minmax(0, var(--pretui-hero-content-fr, 1fr))
            minmax(0, var(--pretui-hero-media-fr, 1fr));
          gap: var(--pretui-hero-gap, var(--space-8, 34px));
          align-items: center;
        }
        .pretui-hero[data-media-side='start'] .pretui-hero-media {
          order: -1;
        }
        .pretui-hero-content {
          display: grid;
          gap: var(--space-4, 11px);
          justify-items: start;
          min-width: 0;
        }
        .pretui-hero-eyebrow {
          margin: 0;
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          font-weight: 500;
          letter-spacing: var(--track-eyebrow, 0.08em);
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        .pretui-hero-headline {
          margin: 0;
          font-family: var(--font-serif);
          font-size: var(--pretui-hero-headline-size, var(--text-display, 33px));
          font-weight: 400;
          line-height: 1.12;
          letter-spacing: var(--track-heading, -0.02em);
          color: var(--foreground);
          text-wrap: balance;
        }
        .pretui-hero-lead {
          margin: 0;
          font-size: var(--text-body, 15px);
          line-height: 1.5;
          color: var(--muted-foreground);
          max-width: 58ch;
        }
        .pretui-hero-chips {
          margin: 0;
          padding: 0;
          list-style: none;
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2, 6px);
        }
        .pretui-hero-actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--space-3, 8px);
        }
        .pretui-hero-media {
          min-width: 0;
        }
        /* A stated ratio holds the box: landscape letterboxes, portrait is
           centred and clipped evenly. Both are honest; neither distorts. */
        .pretui-hero-media[data-ratio='fixed'] {
          aspect-ratio: var(--pretui-hero-ratio, 4 / 3);
          overflow: hidden;
          display: grid;
          place-items: center;
          border-radius: var(--radius-surface, 10px);
        }

        @container (max-width: 46rem) {
          .pretui-hero-grid {
            grid-template-columns: minmax(0, 1fr);
            gap: var(--pretui-hero-gap-narrow, var(--space-6, 19px));
          }
          /* Same specificity as the wide rule, so the visual order rejoins
             the source order instead of losing to it. */
          .pretui-hero[data-media-side='start'] .pretui-hero-media {
            order: 0;
          }
          .pretui-hero-headline {
            font-size: var(
              --pretui-hero-headline-size-narrow,
              var(--text-heading, 19px)
            );
          }
          .pretui-hero-actions {
            width: 100%;
          }
        }
      }
    </style>
  </template>
}
