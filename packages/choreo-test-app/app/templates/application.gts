import { array } from '@ember/helper';
import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';
import { modifier } from 'ember-modifier';
import { pageTitle } from 'ember-page-title';
import { Choreo, type ChoreoContext, MotionConfig } from 'glimmer-motion';
import { ChoreoMark } from 'test-app/components/choreo-mark';
import { HowPanel } from 'test-app/components/how-panel';
import { TempoPicker } from 'test-app/components/tempo-picker';
import { ThemePicker } from 'test-app/components/theme-picker';
import {
  crossingActive,
  returningHome,
  scrollIntent,
  wireRegion,
} from 'test-app/lib/crossing';
import { factor } from 'test-app/lib/tempo';

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
function scrollHome(event: Event) {
  if ((event.currentTarget as HTMLElement).classList.contains('active')) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

const wire = modifier((_el: Element, [c]: [ChoreoContext]) => {
  wireRegion(c);
});

<template>
  {{pageTitle "Choreo"}}
  <MotionConfig @reducedMotion="user">
    <div class="app-shell">
      <header class="topbar">
        <LinkTo @route="index" class="brand" {{on "click" scrollHome}}>
          <ChoreoMark />
          <span class="brand-copy">
            <span class="brand-name">Choreo</span>
            <span class="brand-sub">by Cardstack</span>
          </span>
        </LinkTo>
        <nav class="top-links" aria-label="Main navigation">
          <LinkTo @route="index">Demos</LinkTo>
          <LinkTo @route="docs">Docs</LinkTo>
          <LinkTo @route="widget-room">3D Gallery</LinkTo>
          <TempoPicker />
          <ThemePicker />
          <a
            href="https://github.com/cardstack/choreo"
            target="_blank"
            rel="noopener noreferrer"
          >GitHub</a>
        </nav>
      </header>
      {{! it flies out of the picker above and back into it, so it belongs
          next to the picker rather than inside whatever page is showing }}
      <HowPanel />
      <main class="page-shell">
        {{! @quiet: thirty live demos compositing under a Magic Move is not
            dropped frames, it is erratic pacing — the crossing pauses what
            is running when it lifts off and hands it back on landing }}
        <Choreo
          @route={{true}}
          @quiet={{true}}
          @scroll={{scrollIntent}}
          class="page"
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
                <c.Tween
                  @of={{c.onstage (c.inserted "guide-page")}}
                  @opacity={{array 0 1}}
                  @duration={{tt.arrive}}
                  @ease={{EASE}}
                />
                {{! the hero's own exit — it RISES out rather than dissolving
                    in place, and the generic leave yields it to this step }}
                <c.Tween
                  @of={{c.onstage (c.removed "scene")}}
                  @y={{array 0 -28}}
                  @opacity={{array 1 0}}
                  @duration={{tt.leave}}
                  @ease={{EASE}}
                />
                {{! the code and the pager, which really can wait for the
                    move to land }}
                <c.Tween
                  @of={{c.onstage (c.inserted "late")}}
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
                      (c.onstage (c.inserted "card"))
                      (c.onstage (c.inserted "stage"))
                      (c.onstage (c.inserted "type"))
                    }}
                    @zIndex={{0}}
                  />
                {{/if}}
              </c.Parallel>
            {{/let}}
          {{/if}}
          {{outlet}}
        </Choreo>
      </main>
      <footer class="footer">
        <span>© 2026 Cardstack Foundation</span>
        <a
          href="https://github.com/cardstack/choreo/blob/main/LICENSE"
          target="_blank"
          rel="noopener noreferrer"
        >
          MIT License
        </a>
      </footer>
    </div>
  </MotionConfig>
</template>
