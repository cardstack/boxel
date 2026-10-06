// Pretui — PageScaffold: named application regions as real landmarks, over the surfaces layout engine.
import Component from '@glimmer/component';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';
import { Layout } from '../surfaces/layout/index.js';

// ── PageScaffold ─────────────────────────────────────────────────────────
// Ported from @cardstack/boxel-layout's `Layout`; upstream visual
// reference is Web Awesome's `wa-page`. What each got wrong:
//
//   • boxel-layout's presets hard-code LIGHT hex values —
//     `--boxel-layout-bg: #f8fafc`, `--boxel-layout-divider: #e2e8f0`,
//     `--boxel-layout-border: #d1d5db` — so a notebook or tools preset
//     goes on glowing pale grey the moment a dark theme is applied. Every
//     one of those knobs is remapped to a Pretui token here, which is the
//     entire reason PageScaffold exists rather than "just use Layout".
//   • boxel-layout has exactly one `{{yield}}`: there are no regions. The
//     rhythm is real, the frame is not. PageScaffold adds the frame.
//   • wa-page ships regions but expects `slot="..."` strings on children
//     and a `[navigation-placement]` attribute; here they are named blocks
//     (Law 7) and the shape is DERIVED from which blocks you passed, with
//     `:has()` — no layout prop to keep in sync with your markup.
//   • wa-page's responsive collapse is a viewport media query, which is
//     wrong inside a card that shares the screen. This uses an unnamed
//     container query, so the frame folds when the PANE is narrow.
//   • Neither ships a skip link. This one does, and it is the first thing
//     in the tab order.
//   • Law 1: the `tools` preset draws a 1px border for separation. The
//     border is neutralised to transparent and the frame carries a
//     hairline-plus-shadow instead.
//
// Regions map to real landmarks: <header>, <nav>, <main>, <aside>,
// <footer>. Only <main> is mandatory (it is the default block).

export type PageScaffoldPreset = 'bare' | 'page' | 'notebook' | 'tools';

let scaffoldSeq = 0;

export interface PageScaffoldSignature {
  Args: {
    /** boxel-layout preset: `page` (default), `bare`, `notebook`, `tools` */
    preset?: PageScaffoldPreset;
    /** accessible name for the `<main>` region */
    label?: string;
    /** accessible name for the `<nav>` rail (default `Section navigation`) */
    navLabel?: string;
    /** accessible name for the `<aside>` rail (default `Supplementary`) */
    asideLabel?: string;
    /** width of the navigation rail; any CSS length (default `14rem`) */
    navWidth?: string;
    /** width of the aside rail; any CSS length (default `16rem`) */
    asideWidth?: string;
    /** cap on the content measure; overrides the preset's own (default `72rem`) */
    maxWidth?: string;
    /** pin the masthead to the top of the scroll container */
    stickyMasthead?: boolean;
    /** hairlines between the bands, as the `notebook` preset does */
    divided?: boolean;
    /** render the skip-to-content link (default true) */
    skipLink?: boolean;
  };
  Blocks: {
    /** top band, full width — product name, account, global actions */
    masthead: [];
    /** second band under the masthead — breadcrumb, filters, a Toolbar */
    subhead: [];
    /** the start rail, a `<nav>` landmark */
    navigation: [];
    /** the content column, a `<main>` landmark. The only required block. */
    default: [];
    /** the end rail, an `<aside>` landmark — outline, metadata, activity */
    aside: [];
    /** bottom band, full width */
    footer: [];
  };
  Element: HTMLDivElement;
}

export class PageScaffold extends Component<PageScaffoldSignature> {
  private mainId = `pretui-page-main-${(scaffoldSeq += 1)}`;

  get preset(): PageScaffoldPreset {
    return this.args.preset ?? 'page';
  }
  get navLabel() {
    return this.args.navLabel ?? 'Section navigation';
  }
  get asideLabel() {
    return this.args.asideLabel ?? 'Supplementary';
  }
  get skipHref() {
    return `#${this.mainId}`;
  }
  get showSkipLink() {
    return this.args.skipLink ?? true;
  }
  get divided() {
    return this.args.divided ?? this.preset === 'notebook';
  }
  get style() {
    return cssStyleFrom([
      cssDeclaration('--pretui-page-nav-width', this.args.navWidth),
      cssDeclaration('--pretui-page-aside-width', this.args.asideWidth),
      cssDeclaration('--boxel-layout-max-inline-size', this.args.maxWidth),
    ]);
  }

  <template>
    <div
      class='pretui-page-scaffold'
      style={{this.style}}
      data-preset={{this.preset}}
      data-divided={{if this.divided 'true' 'false'}}
      data-test-pretui-page-scaffold
      ...attributes
    >
      {{#if this.showSkipLink}}
        <a class='ps-skip' href={{this.skipHref}}>Skip to main content</a>
      {{/if}}

      <Layout @preset={{this.preset}}>
        <div class='ps-frame'>
          {{#if (has-block 'masthead')}}
            <header
              class='ps-band ps-masthead'
              data-sticky={{if @stickyMasthead 'true' 'false'}}
            >
              {{yield to='masthead'}}
            </header>
          {{/if}}

          {{#if (has-block 'subhead')}}
            <div class='ps-band ps-subhead'>{{yield to='subhead'}}</div>
          {{/if}}

          <div class='ps-body'>
            {{#if (has-block 'navigation')}}
              <nav class='ps-nav' aria-label={{this.navLabel}}>
                {{yield to='navigation'}}
              </nav>
            {{/if}}

            {{! tabindex=-1 so the skip link actually MOVES focus rather
                than only scrolling — the omission that makes most skip
                links useless for screen-reader users. }}
            <main
              class='ps-main'
              id={{this.mainId}}
              tabindex='-1'
              aria-label={{@label}}
            >
              {{yield}}
            </main>

            {{#if (has-block 'aside')}}
              <aside class='ps-aside' aria-label={{this.asideLabel}}>
                {{yield to='aside'}}
              </aside>
            {{/if}}
          </div>

          {{#if (has-block 'footer')}}
            <footer class='ps-band ps-footer'>{{yield to='footer'}}</footer>
          {{/if}}
        </div>
      </Layout>
    </div>

    <style scoped>
      @layer PretComponent {
        /* Unnamed container query only. The NAMED forms
           (`container: name / inline-size`) make the scoped-CSS transpiler
           drop every rule after them, silently. */
        .pretui-page-scaffold {
          container-type: inline-size;
          position: relative;
          box-sizing: border-box;
          min-width: 0;
          color: var(--foreground);
          font-family: var(--font-sans);
          font-size: var(--text-ui-md, 12.5px);

          /* boxel-layout's own knobs, repointed at Pretui tokens. Upstream
             defaults are literal light hexes; these follow the theme. */
          --boxel-layout-fg: var(--foreground);
          --boxel-layout-bg: transparent;
          --boxel-layout-border: transparent;
          --boxel-layout-divider: var(--border);
          --boxel-layout-radius: var(--radius-surface, 10px);
          --boxel-layout-gap: var(--pretui-page-gap, var(--space-6, 18px));
        }

        /* The presets that draw their own surface get it from the frame
           instead: hairline + shadow, one property (Law 1). */
        .pretui-page-scaffold[data-preset='notebook'],
        .pretui-page-scaffold[data-preset='tools'] {
          border-radius: var(--pretui-page-radius, var(--radius-surface, 10px));
          background: var(--pretui-page-bg, var(--card));
          box-shadow: var(
            --pretui-page-shadow,
            var(--pretui-shadow-card, 0 0 0 1px var(--border), 0 1px 2px
                rgb(0 0 0 / 0.12))
          );
        }

        .ps-skip {
          position: absolute;
          inset-inline-start: var(--space-3, 8px);
          inset-block-start: var(--space-3, 8px);
          z-index: 20;
          transform: translateY(-200%);
          padding: var(--space-2, 5px) var(--space-4, 11px);
          border-radius: var(--radius-chip, 6px);
          background: var(--card);
          color: var(--card-foreground);
          font-size: var(--text-ui-sm, 11.5px);
          font-weight: 600;
          text-decoration: none;
          box-shadow: var(
            --pretui-shadow-raised,
            0 0 0 1px var(--border),
            0 2px 10px rgb(0 0 0 / 0.18)
          );
          transition: transform var(--pretui-dur-snap, 160ms)
            var(--pretui-ease-snap, ease);
        }

        /* Law 5 — the end state is the fallback, never a frozen midpoint. */
        .ps-skip:focus-visible {
          transform: translateY(0);
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }

        .ps-frame {
          display: flex;
          flex-direction: column;
          gap: var(--pretui-page-gap, var(--space-6, 18px));
          min-width: 0;
        }

        .ps-band {
          min-width: 0;
        }

        .ps-masthead[data-sticky='true'] {
          position: sticky;
          inset-block-start: var(--pretui-page-sticky-top, 0px);
          z-index: 10;
          background: var(--pretui-page-bg, var(--card));
        }

        .ps-body {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: var(--pretui-page-column-gap, var(--space-6, 18px));
          align-items: start;
          min-width: 0;
        }

        /* The frame shape is DERIVED from the blocks that were passed —
           there is no layout prop to hold wrong. */
        .ps-body:has(> .ps-nav) {
          grid-template-columns:
            var(--pretui-page-nav-width, 14rem)
            minmax(0, 1fr);
        }

        .ps-body:has(> .ps-aside) {
          grid-template-columns:
            minmax(0, 1fr)
            var(--pretui-page-aside-width, 16rem);
        }

        .ps-body:has(> .ps-nav):has(> .ps-aside) {
          grid-template-columns:
            var(--pretui-page-nav-width, 14rem)
            minmax(0, 1fr)
            var(--pretui-page-aside-width, 16rem);
        }

        .ps-nav,
        .ps-main,
        .ps-aside {
          min-width: 0;
        }

        .ps-nav,
        .ps-aside {
          position: sticky;
          inset-block-start: var(--pretui-page-sticky-top, 0px);
          align-self: start;
        }

        /* The skip target takes programmatic focus (tabindex=-1); that focus
           ring is noise, so it is dropped ONLY for the non-keyboard case —
           :focus-visible keeps a real ring rather than `outline: none`. */
        .ps-main:focus:not(:focus-visible) {
          outline: none;
        }

        .ps-main:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 3px;
          border-radius: var(--pretui-page-radius, var(--radius-surface, 10px));
        }

        /* The `notebook` preset divides its blocks — but only blocks that
           are surfaces `Unit`s, which plain regions are not. Pretui draws
           the same hairlines between the bands so `@divided` means what a
           reader expects. */
        .pretui-page-scaffold[data-divided='true'] .ps-band + .ps-band,
        .pretui-page-scaffold[data-divided='true'] .ps-band + .ps-body,
        .pretui-page-scaffold[data-divided='true'] .ps-body + .ps-band {
          border-block-start: 1px solid var(--border);
          padding-block-start: var(--pretui-page-gap, var(--space-6, 18px));
        }

        /* Container query, unnamed. It resolves against the nearest ancestor
           container — .pretui-page-scaffold — so .ps-body inside it matches.
           Measures the PANE, never the viewport. */
        @container (max-width: 48rem) {
          .ps-body,
          .ps-body:has(> .ps-nav),
          .ps-body:has(> .ps-aside),
          .ps-body:has(> .ps-nav):has(> .ps-aside) {
            grid-template-columns: minmax(0, 1fr);
          }

          .ps-nav,
          .ps-aside {
            position: static;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .ps-skip {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
