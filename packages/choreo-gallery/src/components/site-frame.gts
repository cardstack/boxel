import { array } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { ChoreoMark } from 'choreo-gallery/components/choreo-mark';
import { HowPanel } from 'choreo-gallery/components/how-panel';
import { TempoPicker } from 'choreo-gallery/components/tempo-picker';
import { ThemePicker } from 'choreo-gallery/components/theme-picker';
import {
  crossingActive,
  returningHome,
  scrollIntent,
  wireRegion,
} from 'choreo-gallery/lib/crossing';
import { factor } from 'choreo-gallery/lib/tempo';
import { theme } from 'choreo-gallery/lib/theme';
import { modifier } from 'ember-modifier';
import { Choreo, type ChoreoContext, MotionConfig } from 'glimmer-motion';

/**
 * The page is a <Choreo @route> region: a route swap inside it is one
 * render pass, and the timeline below is the whole gallery ⇄ demo crossing —
 * Keynote's slide grammar, spoken directly. The topbar and footer sit
 * OUTSIDE the region: chrome that never re-renders is steady by construction,
 * not a pair of snapshots dissolving into each other.
 *
 * The timeline renders only while a crossing is in flight (crossingActive),
 * so a gallery filter pass compiles nothing and <Presence> keeps owning the
 * filter animation.
 */
const BASE = 0.9;
/* Emphasised, not snappy. [0.22, 1, 0.36, 1] leaves almost instantly and then
   coasts, which reads as a jump followed by a settle; a Magic Move wants to
   gather itself, travel, and arrive. */
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

/**
 * The brand mark, clicked while already standing in the gallery. The router
 * treats a same-route click as a no-op — LinkTo marks itself `active` on its
 * own route — so the leftover intent is "take me back to the top". From a
 * demo page the click is a real transition and the crossing owns the scroll;
 * this deliberately stays out of its way.
 */
const wire = modifier((_el: Element, [c]: [ChoreoContext]) => {
  wireRegion(c);
});

interface Signature {
  Args: {
    homeActive: boolean;
    homeHref: string;
    navigateHome: () => void;
  };
  Blocks: { default: [] };
}

export class SiteFrame extends Component<Signature> {
  followHome = (event: MouseEvent) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    if (this.args.homeActive) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      this.args.navigateHome();
    }
  };

  <template>
    <div class='choreo-site' data-theme={{theme.resolved}}>
      <MotionConfig @reducedMotion='user'>
        <div class='app-shell'>
          <header class='topbar'>
            <a href={{@homeHref}} class='brand' {{on 'click' this.followHome}}>
              <ChoreoMark />
              <span class='brand-copy'>
                <span class='brand-name'>Choreo</span>
                <span class='brand-sub'>by Cardstack</span>
              </span>
            </a>
            {{! One link. Motion is credited in the hero's tagline and the test
            runner is a development URL, not a destination — anything else here
            competes with the one thing this bar is for. }}
            <nav class='top-links'>
              <TempoPicker />
              <ThemePicker />
              <a
                href='https://github.com/cardstack/choreo'
                target='_blank'
                rel='noopener noreferrer'
              >GitHub</a>
            </nav>
          </header>
          {{! it flies out of the picker above and back into it, so it belongs
          next to the picker rather than inside whatever page is showing }}
          <HowPanel />
          <main class='page-shell'>
            {{! @quiet: thirty live demos compositing under a Magic Move is not
            dropped frames, it is erratic pacing — the crossing pauses what
            is running when it lifts off and hands it back on landing }}
            <Choreo
              @route={{true}}
              @quiet={{true}}
              @scroll={{scrollIntent}}
              class='page'
              as |c|
            >
              <span hidden {{wire c}}></span>
              {{#if (crossingActive)}}
                {{#let (t) as |tt|}}
                  <c.Parallel>
                    {{! the canned crossing: leaves dissolve as the paired stage
                    and type lift off, arrivals land near the settle — and
                    the crossfade carries color, so the ground never leaks
                    through the flying stage }}
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
                    {{! the code and the pager, which really can wait for the
                    move to land }}
                    <c.Tween
                      @of={{c.onstage (c.inserted 'late')}}
                      @opacity={{array 0 1}}
                      @delay={{tt.lateDelay}}
                      @duration={{tt.late}}
                      @ease={{EASE}}
                    />
                    {{#if (returningHome)}}
                      {{! The unmatched tiles are the gallery's own to bring in
                      AFTER the landing (see cardAnimate): this hold claims
                      them — the yield rule — so the canned arrive leaves
                      them alone and nothing competes with the move for
                      frames. z-index at its resting value is a no-op worn
                      only for the claim. }}
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
              href='https://github.com/cardstack/choreo/blob/main/LICENSE'
              target='_blank'
              rel='noopener noreferrer'
            >
              MIT License
            </a>
          </footer>
        </div>
      </MotionConfig>
    </div>
  </template>
}
