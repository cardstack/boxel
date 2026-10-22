// Pretui — StepsWithMedia: a step list whose active step shows its media.
import Component from '@glimmer/component';
import { guidFor } from '@ember/object/internals';
import { StepList } from './step-list';
import type { StepItem, StepListVariant } from './step-list';
import { MediaViewer } from './media-viewer';
import type { MediaAssetSpec } from '../internal/media-viewer';
import { cssStyle } from '../pretui-css';
import { ariaLevelFor } from '../internal/blocks';
import type { BlockHeadingLevel } from '../internal/blocks';

// ═════════════════════════════════════════════════════════════════════════
// B3 · StepsWithMedia
// ═════════════════════════════════════════════════════════════════════════
//
// From catalog-app's storefront-how-it-works: a framed media panel beside a
// numbered list of steps.
//
// THE MEDIA IS A STATIC COLUMN, NOT A PER-STEP SWITCHER, and the reason is
// the tier definition rather than taste. Per-step switching needs a
// selected index, a keyboard path across the steps, focus management and an
// announcement when the panel changes — that is a state machine, which
// makes it a COMPONENT, not a block. A block that quietly grew one would be
// exactly the failure this tier exists to prevent.
//
// The caller keeps the ability anyway, and keeps it correctly: `@current`
// and `@asset` are both args, so a host that already owns a selected index
// passes a different asset alongside a different `@current` and gets
// per-step media with the state living where state belongs. That is the
// controlled pattern, and it costs this block nothing.
//
// Step semantics are NOT reimplemented. `StepList` (controls-composites)
// already owns the <ol>/<li>, the numbered markers, six states with a
// glyph each, per-step detail lines, the completion summary wired with
// aria-describedby, the polite live region, and its own container-query
// responsive behaviour. This block passes `@steps`, `@current`, `@variant`
// and `@summary` straight through and adds nothing but the column.
//
// BETTER THAN THE INSPIRATION:
//   · `STEPS` was a module-level const, so the block was welded to one
//     product → steps are an arg, typed as StepList's own `StepItem`, so
//     they gain state, detail lines and the summary for free.
//   · The framed asset was an AUTOPLAYING GIF that could not be paused and
//     ignored `prefers-reduced-motion`, with no static poster — the file's
//     worst defect → the asset goes through `MediaViewer`, which routes a
//     video to the kit's player (transport, captions, keyboard, no
//     autoplay) and an image to a frame that reserves its ratio.
//   · `@ts-expect-error` on the asset import → the asset is data.
//   · A container query collapsing to one column: KEPT, and kept unnamed.
//
// No browser-chrome frame around the screenshot, deliberately: that is a
// visual treatment, not part of a steps block, and the source's version
// hardcoded its traffic-light colours and read three meaningless dots to a
// screen reader. A caller who wants one puts it in the `<:media>` block.

export interface StepsWithMediaSignature {
  Args: {
    /** Small line above the title. */
    eyebrow?: string;
    /** Section title. */
    title?: string;
    /** One paragraph under the title. */
    lead?: string;
    /** The steps, handed straight to StepList. */
    steps: readonly StepItem[];
    /** Index of the current step — StepList derives
     * complete/current/upcoming for steps without an explicit state. */
    current?: number;
    /** StepList presentation: `steps` (numbered rail) or `track`. */
    variant?: StepListVariant;
    /** Show StepList's derived completion summary. */
    summary?: boolean;
    /** Accessible name for the step list. Defaults to the title. */
    stepsLabel?: string;
    /** The media panel's asset. Routed by MediaViewer. */
    asset?: MediaAssetSpec;
    /** Which side the media sits on VISUALLY at wide widths. Source order
     * is always content-first. Default `start`, matching the source. */
    mediaSide?: 'start' | 'end';
    /** Hold the media panel at a fixed CSS `aspect-ratio`. */
    ratio?: string;
    /** Heading level for the title in the host page. */
    headingLevel?: BlockHeadingLevel;
  };
  Blocks: {
    /** Replaces the media panel — a BrowserFrame, a Chart, a Scene. */
    media: [];
    /** Anything under the step list. */
    default: [];
  };
  Element: HTMLElement;
}

export class StepsWithMedia extends Component<StepsWithMediaSignature> {
  private titleId = guidFor(this) + '-title';

  get mediaSide(): 'start' | 'end' {
    return this.args.mediaSide === 'end' ? 'end' : 'start';
  }
  get headingAriaLevel() {
    return ariaLevelFor(this.args.headingLevel);
  }
  get style() {
    return cssStyle('--pretui-swm-ratio', this.args.ratio);
  }
  get ratioMode(): string {
    return this.args.ratio ? 'fixed' : 'intrinsic';
  }
  get steps(): StepItem[] {
    return [...(this.args.steps ?? [])];
  }
  get stepsLabel(): string {
    return this.args.stepsLabel ?? this.args.title ?? 'Steps';
  }
  get labelledBy() {
    return this.args.title ? this.titleId : undefined;
  }

  <template>
    <section
      class='pretui-swm'
      style={{this.style}}
      data-media-side={{this.mediaSide}}
      aria-labelledby={{this.labelledBy}}
      data-test-pretui-steps-with-media
      ...attributes
    >
      <div class='pretui-swm-grid'>
        <div class='pretui-swm-content'>
          {{#if @eyebrow}}
            <p class='pretui-swm-eyebrow'>{{@eyebrow}}</p>
          {{/if}}
          {{#if @title}}
            <h2
              id={{this.titleId}}
              class='pretui-swm-title'
              aria-level={{this.headingAriaLevel}}
            >{{@title}}</h2>
          {{/if}}
          {{#if @lead}}
            <p class='pretui-swm-lead'>{{@lead}}</p>
          {{/if}}
          <StepList
            @steps={{this.steps}}
            @current={{@current}}
            @variant={{@variant}}
            @summary={{@summary}}
            @label={{this.stepsLabel}}
            data-test-pretui-swm-steps
          />
          {{yield}}
        </div>

        {{#if (has-block 'media')}}
          <div
            class='pretui-swm-media'
            data-ratio={{this.ratioMode}}
            data-test-pretui-swm-media
          >{{yield to='media'}}</div>
        {{else}}
          {{! see the note in HeroSplit — else-if does not narrow @asset }}
          {{#if @asset}}
            <div
              class='pretui-swm-media'
              data-ratio={{this.ratioMode}}
              data-test-pretui-swm-media
            >
              <MediaViewer @asset={{@asset}} />
            </div>
          {{/if}}
        {{/if}}
      </div>
    </section>

    <style scoped>
      @layer PretComponent {
        .pretui-swm {
          container-type: inline-size;
          display: block;
        }
        .pretui-swm-grid {
          display: grid;
          grid-template-columns:
            minmax(0, var(--pretui-swm-content-fr, 1fr))
            minmax(0, var(--pretui-swm-media-fr, 1fr));
          gap: var(--pretui-swm-gap, var(--space-8, 34px));
          align-items: start;
        }
        .pretui-swm[data-media-side='start'] .pretui-swm-media {
          order: -1;
        }
        .pretui-swm-content {
          display: grid;
          gap: var(--space-4, 11px);
          align-content: start;
          min-width: 0;
        }
        .pretui-swm-eyebrow {
          margin: 0;
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          font-weight: 500;
          letter-spacing: var(--track-eyebrow, 0.08em);
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        .pretui-swm-title {
          margin: 0;
          font-family: var(--font-serif);
          font-size: var(--pretui-swm-title-size, var(--text-heading, 19px));
          font-weight: 400;
          line-height: 1.2;
          letter-spacing: var(--track-heading, -0.02em);
          color: var(--foreground);
          text-wrap: balance;
        }
        .pretui-swm-lead {
          margin: 0;
          font-size: var(--text-body, 15px);
          line-height: 1.5;
          color: var(--muted-foreground);
          max-width: 58ch;
        }
        .pretui-swm-media {
          min-width: 0;
          position: sticky;
          top: var(--pretui-swm-sticky-top, 0);
        }
        .pretui-swm-media[data-ratio='fixed'] {
          aspect-ratio: var(--pretui-swm-ratio, 16 / 9);
          overflow: hidden;
          display: grid;
          place-items: center;
          border-radius: var(--radius-surface, 10px);
        }

        @container (max-width: 46rem) {
          .pretui-swm-grid {
            grid-template-columns: minmax(0, 1fr);
            gap: var(--pretui-swm-gap-narrow, var(--space-5, 14px));
          }
          .pretui-swm[data-media-side='start'] .pretui-swm-media {
            order: 0;
          }
          /* Sticky is a wide-column affordance. In one column it would pin
             the picture over the steps you are trying to read. */
          .pretui-swm-media {
            position: static;
          }
        }
      }
    </style>
  </template>
}
