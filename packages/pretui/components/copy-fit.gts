// Pretui — CopyFit: one adaptive design across badge / strip / tile / card
// sub-formats, container-query driven. Media-forward when media exists;
// otherwise the monogram placeholder (wordmark letter on foreground).
// Translated from pretui-design-system (components/fitted + css/structure.css).
//
// Naming (catalog-taxonomy.md): `fitted` is a Boxel rendering format; CopyFit
// is the layout MECHANISM that makes copy and optional media adapt across the
// fitted format's quantums.
import Component from '@glimmer/component';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';
import { statusHue } from '../internal/ink';

const or = (...values: unknown[]) => values.some(Boolean);

export interface CopyFitSignature {
  Args: {
    title: string;
    eyebrow?: string;
    meta?: string;
    media?: string; // image URL
    mediaBg?: string;
    monogram?: string;
    footerLeft?: string;
    footerRight?: string;
    /**
     * Hue for the monogram cover. Defaults to `statusHue` over the monogram
     * source, so the same title is the same colour on every card by every
     * author (Law 2's corollary) — a caller override is the exception.
     */
    coverHue?: string;
    /**
     * Render the placeholder instead of the content.
     *
     * This is the same element tree and the same container-query ladder, with
     * shimmer bones where the text goes — so the placeholder degrades through
     * badge / strip / tile / card *identically* to the real card, and the
     * layout does not move when the data arrives. That is the whole point:
     * the surveyed source achieved it by hand-duplicating the size ladder in
     * a second file (and the thresholds were already drifting across three
     * copies). Here there is one ladder, because there is one component.
     */
    loading?: boolean;
    /** what the placeholder announces (default 'Loading') */
    loadingLabel?: string;
  };
  Blocks: { media: []; footerLeft: []; footerRight: [] };
  Element: HTMLDivElement;
}

/**
 * One adaptive design across badge / strip / tile / card, container-query
 * driven.
 *
 * Cover pass 2026-08-13 (boxel-catalog E7), two ideas:
 *
 * **The monogram is a cover, not a grey box.** With no image, the media band
 * is a Law-2 treatment derived from one hue — a 135° tint gradient with the
 * letter in ink mixed from the same hue — and that hue comes from `statusHue`
 * over the monogram source, so it is stable and never picked by hand. (The
 * surveyed source keyed its cover off a hardcoded type→colour table with a
 * `#ff5b9c` fallback, and interpolated the whole thing into an `htmlSafe`
 * style string, bypassing both the cascade and CSP. The hash is the better
 * answer and Pretui already owned it.)
 *
 * **The tile tells the grid what it is.** The root publishes
 * `data-no-image='true' | 'false'`, so a parent can pick the cell's aspect
 * ratio from the tile's own content — an inversion of control that lets a
 * masonry pack monogram tiles at 16:9 and photo tiles at 4:3:
 *
 * ```css
 * .grid > * { aspect-ratio: 4 / 3; }
 * .grid > *:has([data-no-image='true']) { aspect-ratio: 16 / 9; }
 * ```
 */
export class CopyFit extends Component<CopyFitSignature> {
  get mediaStyle() {
    // `@mediaBg` and `@coverHue` are caller strings reaching an inline style
    // — both go through the kit allowlist so neither can carry its own
    // declarations.
    // The caller's hue is validated BEFORE it wins: `??` on the raw value would
    // let a rejected string swallow the derived hue and leave the tile with
    // neither, which is the one case the Law-2 guarantee is about.
    return cssStyleFrom([
      cssDeclaration('--pretui-fitted-mediabg', this.args.mediaBg),
      cssDeclaration('--pretui-fitted-cover-hue', this.args.coverHue) ??
        cssDeclaration('--pretui-fitted-cover-hue', this.coverHue),
    ]);
  }
  get monogram() {
    return (this.args.monogram ?? this.args.title ?? '?').slice(0, 1);
  }
  /** Stable hash → one of the chart hues. Keyed on the whole monogram source
   * rather than the single letter, so "Ledger" and "Lantern" do not collide. */
  get coverHue() {
    return statusHue(this.args.monogram ?? this.args.title ?? '');
  }
  get hasFooter() {
    return this.args.footerLeft || this.args.footerRight;
  }
  get loadingLabel() {
    return this.args.loadingLabel ?? 'Loading';
  }
  <template>
    <div
      class='pretui-fitted'
      data-no-image={{if (has-block 'media') 'false' (if @media 'false' 'true')}}
      data-loading={{if @loading 'true'}}
      role={{if @loading 'status'}}
      aria-busy={{if @loading 'true'}}
      data-test-pretui-fitted
      ...attributes
    >
      <div class='pretui-fitted-root'>
        <div
          class='pretui-fitted-media'
          data-cover={{if
            @loading
            'loading'
            (if (has-block 'media') 'slot' (if @media 'image' 'mono'))
          }}
          style={{this.mediaStyle}}
        >
          {{#if @loading}}
            {{! the band itself is the shimmer }}
          {{else if (has-block 'media')}}
            {{yield to='media'}}
          {{else if @media}}
            <img src={{@media}} alt='' />
          {{else}}
            <span class='pretui-fitted-mono'>{{this.monogram}}</span>
          {{/if}}
        </div>
        <div class='pretui-fitted-content'>
          {{#if @loading}}
            <span class='pretui-vh'>{{this.loadingLabel}}</span>
            <span
              class='pretui-eyebrow pretui-fitted-eyebrow pretui-fitted-bone'
              aria-hidden='true'
            ></span>
            <span
              class='pretui-fitted-title pretui-fitted-bone'
              aria-hidden='true'
            ></span>
            <span
              class='pretui-fitted-meta pretui-fitted-bone'
              aria-hidden='true'
            ></span>
            <span class='pretui-fitted-footer' aria-hidden='true'><span
                class='pretui-fitted-bone pretui-fitted-bone-foot'
              ></span><span
                class='pretui-fitted-bone pretui-fitted-bone-foot'
              ></span></span>
          {{else}}
            {{#if @eyebrow}}<span class='pretui-eyebrow pretui-fitted-eyebrow'>{{@eyebrow}}</span>{{/if}}
            <span class='pretui-fitted-title'>{{@title}}</span>
            {{#if @meta}}<span class='pretui-fitted-meta'>{{@meta}}</span>{{/if}}
            {{#if (or this.hasFooter (has-block 'footerLeft') (has-block 'footerRight'))}}
              <span class='pretui-fitted-footer'><span>{{#if (has-block 'footerLeft')}}{{yield to='footerLeft'}}{{else}}{{@footerLeft}}{{/if}}</span><span>{{#if (has-block 'footerRight')}}{{yield to='footerRight'}}{{else}}{{@footerRight}}{{/if}}</span></span>
            {{/if}}
          {{/if}}
        </div>
      </div>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-fitted {
          container-type: size;
          width: 100%;
          height: 100%;
        }
        .pretui-fitted-root {
          position: relative;
          display: flex;
          width: 100%;
          height: 100%;
          background: var(--card);
          border-radius: var(--radius-surface, 10px);
          box-shadow: var(--pretui-shadow-card, 0 0 0 1px var(--border));
          overflow: hidden;
          flex-direction: column;
        }
        .pretui-fitted-media {
          position: relative;
          background: var(--pretui-fitted-mediabg, var(--foreground));
          color: var(--pretui-on-neutral, var(--boxel-light));
          display: grid;
          place-items: center;
          flex: none;
          overflow: hidden;
        }
        .pretui-fitted-media img {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        /* The monogram COVER (Law 2: one hue in, a complete treatment out).
           `--pretui-fitted-mediabg` still wins when a caller sets it, so this
           is a better default rather than a new rule to fight. */
        .pretui-fitted-media[data-cover='mono'] {
          --_ch: var(--pretui-fitted-cover-hue, var(--chart-1));
          background: var(
            --pretui-fitted-mediabg,
            linear-gradient(
              135deg,
              color-mix(in oklch, var(--_ch) 26%, var(--card)),
              color-mix(in oklch, var(--_ch) 8%, var(--card))
            )
          );
          color: color-mix(in oklch, var(--foreground) 16%, var(--_ch));
        }
        .pretui-fitted-mono {
          font-family: var(--font-serif);
          font-style: italic;
          font-size: 20px;
          font-weight: 600;
        }
        /* ── the placeholder ──────────────────────────────────────────────
           Bones wear the SAME classes as the text they stand in for, so every
           `display: none` / `font-size` rule in the ladder below applies to
           them unchanged: the eyebrow disappears at badge size for the bone
           exactly as it does for the eyebrow. Nothing here re-states a
           threshold. */
        @keyframes pretui-fitted-shimmer {
          from {
            background-position: 200% 0;
          }
          to {
            background-position: -200% 0;
          }
        }
        .pretui-fitted-media[data-cover='loading'],
        .pretui-fitted-bone {
          background: linear-gradient(
            90deg,
            var(--inset, var(--boxel-100)) 40%,
            var(--hover, var(--boxel-100)) 50%,
            var(--inset, var(--boxel-100)) 60%
          );
          background-size: 200% 100%;
          animation: pretui-fitted-shimmer 1.6s linear infinite;
        }
        .pretui-fitted-bone {
          min-height: 1em;
          border-radius: 4px;
          color: transparent;
        }
        .pretui-fitted-bone.pretui-fitted-eyebrow {
          width: 38%;
        }
        .pretui-fitted-bone.pretui-fitted-title {
          width: 74%;
        }
        .pretui-fitted-bone.pretui-fitted-meta {
          width: 52%;
        }
        .pretui-fitted-bone-foot {
          width: 22%;
          min-height: 0.85em;
        }
        /* Reduced motion lands on the END state — a flat, honest resting
           placeholder, never a frozen midpoint of the sweep. */
        @media (prefers-reduced-motion: reduce) {
          .pretui-fitted-media[data-cover='loading'],
          .pretui-fitted-bone {
            animation: none;
            background: var(--inset, var(--boxel-100));
          }
        }
        .pretui-vh {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        .pretui-fitted-content {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 10px 12px;
          min-width: 0;
          flex: 1;
          justify-content: center;
        }
        .pretui-fitted-title {
          font-weight: 600;
          font-size: var(--text-ui-md, 12.5px);
          letter-spacing: var(--track-heading, -0.02em);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pretui-fitted-meta {
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pretui-eyebrow {
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          font-weight: 500;
          letter-spacing: var(--track-eyebrow, 0.08em);
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        .pretui-fitted-eyebrow {
          display: none;
        }
        .pretui-fitted-footer {
          display: none;
          align-items: center;
          justify-content: space-between;
          margin-top: auto;
          padding-top: 8px;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
        /* badge — tiny: square mark + a word */
        @container ((max-width: 139px) or (max-height: 47px)) {
          .pretui-fitted-root {
            flex-direction: row;
            align-items: stretch;
            border-radius: 8px;
          }
          .pretui-fitted-media {
            width: 100cqh;
            height: 100%;
            flex: none;
          }
          .pretui-fitted-mono {
            font-size: 13px;
          }
          .pretui-fitted-content {
            padding: 0 9px;
            gap: 0;
            min-width: 0;
          }
          .pretui-fitted-meta {
            display: none;
          }
          .pretui-fitted-title {
            font-size: var(--text-ui-xs, 11px);
          }
        }
        /* strip — short & wide: square media left */
        @container (min-width: 140px) and (min-height: 48px) and (max-height: 89px) {
          .pretui-fitted-root {
            flex-direction: row;
            align-items: stretch;
          }
          .pretui-fitted-media {
            width: 100cqh;
            height: 100%;
            flex: none;
          }
          .pretui-fitted-content {
            padding: 0 12px;
            min-width: 0;
          }
        }
        /* tile — roughly square: media on top */
        @container (min-width: 140px) and (min-height: 90px) and (max-height: 189px) {
          .pretui-fitted-media {
            height: 54%;
          }
          .pretui-fitted-eyebrow {
            display: block;
          }
        }
        /* card — tall, media-forward */
        @container (min-width: 140px) and (min-height: 190px) {
          .pretui-fitted-media {
            height: 52%;
          }
          .pretui-fitted-mono {
            font-size: 28px;
          }
          .pretui-fitted-eyebrow {
            display: block;
          }
          .pretui-fitted-footer {
            display: flex;
          }
          .pretui-fitted-content {
            padding: 12px 14px;
          }
        }
      }
    </style>
  </template>
}
