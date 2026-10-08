import { Choreo, type ChoreoContext } from '@cardstack/choreo';
import { array } from '@ember/helper';
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';

import type { Crossing } from '../lib/crossing';
import { factor } from '../lib/tempo';
import { ChoreoMark } from './choreo-mark';
import { ChoreoRoot } from './choreo-root';
import { GalleryLink } from './gallery-link';
import { HowPanel } from './how-panel';
import { TempoPicker, ThemePicker } from './pickers';

/**
 * The page is a <Choreo @route> region: a page swap inside it is one render
 * pass, and the timeline below is the whole gallery ⇄ demo crossing —
 * Keynote's slide grammar, spoken directly. The top bar and footer sit
 * OUTSIDE the region: chrome that never re-renders is steady by construction.
 *
 * The timeline renders only while a crossing is in flight, so a gallery
 * filter pass compiles nothing and <Presence> keeps owning the filter
 * animation.
 */
const BASE = 0.9;
/* Emphasised, not snappy: a Magic Move wants to gather itself, travel, and
   arrive, not jump and settle. */
const EASE = [0.2, 0, 0, 1] as const;

/** every time in the crossing derives from one morph, so tempo retimes it whole */
function t() {
  const m = BASE * factor();
  return {
    arrive: 0.55 * m,
    late: 0.4 * m,
    lateDelay: 0.66 * m,
    leave: 0.42 * m,
    move: m,
  };
}

interface Signature {
  Args: {
    crossing: Crossing;
    /** the brand mark, clicked: back to the gallery, or its top */
    goHome: () => void;
    /** where the brand mark points: the gallery card's own URL */
    homeHref: string;
  };
  Blocks: { default: [] };
}

export class SiteFrame extends Component<Signature> {
  wire = modifier((element: Element, [c]: [ChoreoContext]) => {
    this.args.crossing.wire(c, element);
  });

  <template>
    <ChoreoRoot class='app-shell'>
      <header class='topbar'>
        <GalleryLink
          @href={{@homeHref}}
          @onFollow={{@goHome}}
          class='brand'
          data-gallery-brand
        >
          <ChoreoMark />
          <span class='brand-copy'>
            <span class='brand-name'>Choreo</span>
            <span class='brand-sub'>by Cardstack</span>
          </span>
        </GalleryLink>
        <nav class='top-links' aria-label='Gallery'>
          <TempoPicker />
          <ThemePicker />
          <a
            href='https://github.com/cardstack/boxel/tree/main/packages/choreo'
            target='_blank'
            rel='noopener noreferrer'
          >GitHub</a>
        </nav>
      </header>
      {{! it flies out of the picker above and back into it, so it belongs
        next to the picker rather than inside whatever page is showing }}
      <HowPanel />
      <main class='page-shell'>
        {{! @quiet: dozens of live demos compositing under a Magic Move is not
          dropped frames, it is erratic pacing — the crossing pauses what is
          running when it lifts off and hands it back on landing }}
        <Choreo
          @route={{true}}
          @quiet={{true}}
          @scroll={{@crossing.scrollIntent}}
          class='page'
          as |c|
        >
          <span hidden {{this.wire c}}></span>
          {{#if @crossing.active}}
            {{#let (t) as |tt|}}
              <c.Parallel>
                {{! the canned crossing: leaves dissolve as the paired stage
                  and type lift off, arrivals land near the settle — and the
                  crossfade carries color, so the ground never leaks through
                  the flying stage }}
                <c.Crossing
                  @duration={{tt.move}}
                  @ease={{EASE}}
                  @leave={{tt.leave}}
                  @arrive={{tt.arrive}}
                  @overlap={{0.18}}
                />
                {{! the hero's own exit — it RISES out rather than dissolving
                  in place, and the generic leave yields it to this step }}
                <c.Tween
                  @of={{c.onstage (c.removed 'scene')}}
                  @y={{array 0 -28}}
                  @opacity={{array 1 0}}
                  @duration={{tt.leave}}
                  @ease={{EASE}}
                />
                {{! the code and the pager, which really can wait for the move
                  to land }}
                <c.Tween
                  @of={{c.onstage (c.inserted 'late')}}
                  @opacity={{array 0 1}}
                  @delay={{tt.lateDelay}}
                  @duration={{tt.late}}
                  @ease={{EASE}}
                />
                {{#if @crossing.returningHome}}
                  {{! The unmatched tiles are the grid's own to bring in AFTER
                    the landing: this hold claims them, so the canned arrive
                    leaves them alone and nothing competes with the move for
                    frames. z-index at its resting value is a no-op worn only
                    for the claim. }}
                  <c.Hold
                    @of={{array
                      (c.onstage (c.inserted 'card'))
                      (c.onstage (c.inserted 'stage'))
                      (c.onstage (c.inserted 'type'))
                    }}
                    @zIndex={{0}}
                  />
                {{/if}}
              </c.Parallel>
            {{/let}}
          {{/if}}
          {{yield}}
        </Choreo>
      </main>
      <footer class='footer'>
        <span>© 2026 Cardstack Foundation</span>
        <a
          href='https://github.com/cardstack/boxel/blob/main/packages/choreo/LICENSE'
          target='_blank'
          rel='noopener noreferrer'
        >
          MIT License
        </a>
      </footer>
    </ChoreoRoot>
    <style scoped>
      .app-shell {
        display: flex;
        flex-direction: column;
      }

      .topbar {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        padding: 18px 28px;
        /* blur only — no tint of its own. Content scrolling underneath
           softens instead of darkening. */
        backdrop-filter: blur(18px);
        background: transparent;
        border-bottom: 1px solid var(--line);
        transition: border-color 220ms var(--ease);
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .brand-copy {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }

      /* Syne at 800, nudged 1px right: the C's open counter reads as more
         space on its left than its right */
      .brand-name {
        font-family: var(--font-display);
        font-weight: 800;
        font-size: 16px;
        letter-spacing: -0.03em;
        margin-left: 1px;
      }

      .brand-sub {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--ink-dim);
      }

      .top-links {
        display: flex;
        align-items: center;
        gap: 22px;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-dim);
      }

      @media (hover: hover) {
        .top-links a:hover {
          color: var(--ink);
        }
      }

      /* the main wraps the <Choreo> region that IS the page: the shell keeps
         the footer at the foot, the region keeps the page's own measure */
      .page-shell {
        flex: 1;
        display: flex;
        flex-direction: column;
      }

      .page {
        width: min(var(--page), calc(100% - 48px));
        margin: 0 auto;
        padding: 56px 0 96px;
        flex: 1;
      }

      .footer {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 40px 24px 48px;
        border-top: 1px solid var(--line);
        margin-top: 64px;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      .footer a {
        color: var(--ink-dim);
      }

      @media (hover: hover) {
        .footer a:hover {
          color: var(--copper-ink);
        }
      }

      @media (max-width: 720px) {
        .topbar {
          padding: 14px 16px;
          gap: 12px;
        }

        .top-links {
          gap: 12px;
          letter-spacing: 0.08em;
        }

        /* if it is ever squeezed anyway, it clips rather than printing
           itself over the control next to it */
        .brand-copy {
          min-width: 0;
        }

        .brand-name,
        .brand-sub {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .page {
          width: 100%;
          padding: 32px 16px 64px;
        }
      }

      @media (max-width: 600px) {
        .top-links {
          flex-wrap: wrap;
          row-gap: 10px;
        }
      }

      @media (max-width: 400px) {
        .top-links {
          gap: 10px;
          font-size: 10px;
        }
      }
    </style>
  </template>
}
