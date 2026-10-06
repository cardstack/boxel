// Pretui — CtaBand: a full-width call-to-action band.
import Component from '@glimmer/component';
import { guidFor } from '@ember/object/internals';
import type { PretuiAppearance, PretuiTone } from '../pretui-primitives';
import { ariaLevelFor } from '../internal/blocks';
import type { BlockHeadingLevel } from '../internal/blocks';

// ═════════════════════════════════════════════════════════════════════════
// B4 · CtaBand
// ═════════════════════════════════════════════════════════════════════════
//
// From catalog-app's storefront-footer: the closing call-to-action band
// every landing page ends with.
//
// LADDER NOTE, stated in the file because it matters more than the code:
// this is the one of the four that is NOT really a block. It composes no
// kit component — its whole value is a surface treatment plus slots, which
// is component work. Its honest tier is Surfaces (structure territory). It
// ships here because it terminates the storefront family and because a
// block file is where it was asked for; the recommendation to move it into
// `structure.gts` is in the report.
//
// Built to be exemplary rather than elaborate: the entire visual range is
// the kit's grid — `@tone` picks the hue and sets `--pretui-tone` /
// `--pretui-tone-on`, `@appearance` picks the recipe, and the recipes are
// written once and read those two properties. Thirty-five dresses, zero
// hand-authored pairs, and the resolved axes are reflected as `data-tone` /
// `data-appearance` so a consumer styles by attribute rather than by arg.
//
// BETTER THAN THE INSPIRATION:
//   · The only component in the corpus that did not even ATTEMPT a token —
//     `background: #14141a`, `color: #fff`, `#b7b4ab` raw, so it was a dark
//     surface that could never follow a theme → there is not one colour
//     literal outside a `var()` fallback here, and the dark band is
//     `@tone='neutral' @appearance='accent'`, which a season re-dresses and
//     a dark theme inverts for free.
//   · Zero args, all copy hardcoded → everything is an arg.
//   · Called a footer but rendered a `<section>` with an `<h3>` and no
//     landmark → it is a `<section>` because a CTA band IS a section, and
//     it is a named region: the heading is a real heading element with a
//     caller-chosen level, and `aria-labelledby` points at it. A caller who
//     wants a `<footer>` landmark wraps it in one, which is the correct
//     place for that decision.
//   · The copy said "List it" and there was NO CTA CONTROL in it at all →
//     `<:actions>` is the point of the component, and the demo shows the
//     dual-CTA pair.

export interface CtaBandSignature {
  Args: {
    /** Small line above the headline. */
    eyebrow?: string;
    /** The headline. Required — it names the band. */
    headline: string;
    /** One paragraph under the headline. */
    lead?: string;
    /** Semantic hue. Default `primary`. */
    tone?: PretuiTone;
    /** Visual weight. Default `accent`. */
    appearance?: PretuiAppearance;
    /** Text alignment. `center` (default) for a closing band, `start` when
     * it sits inside a column of left-aligned prose. */
    align?: 'start' | 'center';
    /** Heading level in the host page. */
    headingLevel?: BlockHeadingLevel;
  };
  Blocks: {
    /** The call-to-action controls. */
    actions: [];
    /** Fine print under the actions. */
    default: [];
  };
  Element: HTMLElement;
}

export class CtaBand extends Component<CtaBandSignature> {
  private headlineId = guidFor(this) + '-headline';

  get tone(): PretuiTone {
    return this.args.tone ?? 'primary';
  }
  get appearance(): PretuiAppearance {
    return this.args.appearance ?? 'accent';
  }
  get align(): 'start' | 'center' {
    return this.args.align === 'start' ? 'start' : 'center';
  }
  get headingAriaLevel() {
    return ariaLevelFor(this.args.headingLevel);
  }

  <template>
    <section
      class='pretui-cta'
      data-tone={{this.tone}}
      data-appearance={{this.appearance}}
      data-align={{this.align}}
      aria-labelledby={{this.headlineId}}
      data-test-pretui-cta-band
      ...attributes
    >
      <div class='pretui-cta-inner'>
        {{#if @eyebrow}}
          <p class='pretui-cta-eyebrow'>{{@eyebrow}}</p>
        {{/if}}
        <h2
          id={{this.headlineId}}
          class='pretui-cta-headline'
          aria-level={{this.headingAriaLevel}}
        >{{@headline}}</h2>
        {{#if @lead}}
          <p class='pretui-cta-lead'>{{@lead}}</p>
        {{/if}}
        {{#if (has-block 'actions')}}
          <div
            class='pretui-cta-actions'
            data-test-pretui-cta-actions
          >{{yield to='actions'}}</div>
        {{/if}}
        {{yield}}
      </div>
    </section>

    <style scoped>
      @layer PretComponent {
        .pretui-cta {
          container-type: inline-size;
          display: block;
          border-radius: var(--radius-surface, 10px);
          padding: var(--pretui-cta-pad, var(--space-9, 45px) var(--space-6, 19px));
          color: var(--pretui-band-ink, var(--foreground));
        }
        .pretui-cta-inner {
          display: grid;
          gap: var(--space-4, 11px);
          max-width: var(--pretui-cta-measure, 60ch);
        }
        .pretui-cta[data-align='center'] .pretui-cta-inner {
          justify-items: center;
          text-align: center;
          margin-inline: auto;
        }
        .pretui-cta[data-align='start'] .pretui-cta-inner {
          justify-items: start;
          text-align: start;
        }
        .pretui-cta-eyebrow {
          margin: 0;
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          font-weight: 500;
          letter-spacing: var(--track-eyebrow, 0.08em);
          text-transform: uppercase;
          color: var(--pretui-band-ink-quiet, var(--muted-foreground));
        }
        .pretui-cta-headline {
          margin: 0;
          font-family: var(--font-serif);
          font-size: var(--pretui-cta-headline-size, var(--text-heading, 19px));
          font-weight: 400;
          line-height: 1.18;
          letter-spacing: var(--track-heading, -0.02em);
          color: var(--pretui-band-ink, var(--foreground));
          text-wrap: balance;
        }
        .pretui-cta-lead {
          margin: 0;
          font-size: var(--text-body, 15px);
          line-height: 1.5;
          color: var(--pretui-band-ink-quiet, var(--muted-foreground));
        }
        .pretui-cta-actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--space-3, 8px);
          margin-top: var(--space-1, 3px);
        }

        /* ── Axis 1: tone sets two custom properties. Nothing
           else in this stylesheet knows a hue. ── */
        .pretui-cta[data-tone='neutral'] {
          --pretui-tone: var(--foreground);
          --pretui-tone-on: var(--pretui-on-neutral, var(--background));
        }
        .pretui-cta[data-tone='primary'] {
          --pretui-tone: var(--primary);
          --pretui-tone-on: var(--primary-foreground);
        }
        .pretui-cta[data-tone='info'] {
          --pretui-tone: var(--pretui-info, var(--boxel-blue));
          --pretui-tone-on: var(--pretui-on-info, var(--background));
        }
        .pretui-cta[data-tone='success'] {
          --pretui-tone: var(--success, var(--boxel-success));
          --pretui-tone-on: var(--pretui-on-success, var(--background));
        }
        .pretui-cta[data-tone='warning'] {
          --pretui-tone: var(--warning, var(--boxel-warning));
          --pretui-tone-on: var(--pretui-on-warning, var(--background));
        }
        .pretui-cta[data-tone='danger'] {
          --pretui-tone: var(--destructive);
          --pretui-tone-on: var(--destructive-foreground);
        }
        .pretui-cta[data-tone='attention'] {
          --pretui-tone: var(--pretui-attention, var(--boxel-fuschia));
          --pretui-tone-on: var(--pretui-on-attention, var(--background));
        }

        /* ── Axis 2: the recipes. Written once, reading the two
           properties above — Law 2 generalised. `--pretui-band-ink` and
           `--pretui-band-ink-quiet` are what the type reads, so the eyebrow
           and lead follow the recipe without a second set of rules. ── */
        .pretui-cta[data-appearance='accent'] {
          background: var(--pretui-tone);
          --pretui-band-ink: var(--pretui-tone-on);
          --pretui-band-ink-quiet: color-mix(
            in oklch,
            var(--pretui-tone-on) 72%,
            var(--pretui-tone)
          );
          box-shadow: 0 0 0 1px
              color-mix(in oklch, var(--pretui-tone) 70%, var(--border)),
            var(--pretui-edge-highlight, inset 0 1px 0 rgb(255 255 255 / 0.14));
        }
        .pretui-cta[data-appearance='filled'] {
          background: color-mix(in oklch, var(--pretui-tone) 15%, var(--card));
          --pretui-band-ink: color-mix(
            in oklch,
            var(--pretui-tone) 60%,
            var(--foreground)
          );
          --pretui-band-ink-quiet: color-mix(
            in oklch,
            var(--pretui-tone) 30%,
            var(--muted-foreground)
          );
        }
        .pretui-cta[data-appearance='outlined'] {
          background: var(--card);
          --pretui-band-ink: color-mix(
            in oklch,
            var(--pretui-tone) 55%,
            var(--foreground)
          );
          --pretui-band-ink-quiet: var(--muted-foreground);
          box-shadow: 0 0 0 1px
            color-mix(in oklch, var(--pretui-tone) 45%, var(--border));
        }
        .pretui-cta[data-appearance='filled-outlined'] {
          background: color-mix(in oklch, var(--pretui-tone) 12%, var(--card));
          --pretui-band-ink: color-mix(
            in oklch,
            var(--pretui-tone) 60%,
            var(--foreground)
          );
          --pretui-band-ink-quiet: color-mix(
            in oklch,
            var(--pretui-tone) 30%,
            var(--muted-foreground)
          );
          box-shadow: 0 0 0 1px
            color-mix(in oklch, var(--pretui-tone) 40%, var(--border));
        }
        .pretui-cta[data-appearance='plain'] {
          background: transparent;
          --pretui-band-ink: var(--foreground);
          --pretui-band-ink-quiet: var(--muted-foreground);
        }

        @container (max-width: 34rem) {
          .pretui-cta {
            padding: var(
              --pretui-cta-pad-narrow,
              var(--space-6, 19px) var(--space-4, 11px)
            );
          }
          .pretui-cta-actions {
            width: 100%;
          }
        }
      }
    </style>
  </template>
}
