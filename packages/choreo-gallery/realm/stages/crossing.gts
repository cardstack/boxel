import { Choreo, type ChoreoContext, createArming } from '@cardstack/choreo';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion, styles, to } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { realmFile } from '../lib/realm-url';
import { factor } from '../lib/tempo';
import { tuneMotion, tuneNumber } from '../lib/tuning';
import { liveScroll, playClip } from '../lib/xstress-live';
import { CrossingNotes } from '../notes/crossing';

const slides = [0, 1, 2] as const;
type Slide = (typeof slides)[number];
type Mode = 'manual' | 'auto' | 'stress';

const labels = ['01  Tide', '02  Ember', '03  Violet'] as const;

/**
 * Same morph as the gallery ⇄ demo crossing: one duration, one ease. A
 * spring lands before you can read the skins swap.
 */
const BASE = 0.9;
const EASE = [0.2, 0, 0, 1] as const;

function t() {
  const m =
    tuneNumber('crossing', BASE, 'Crossing duration', 0.05, 3, 0.01) * factor();
  return {
    arrive: tuneNumber('crossing', 0.55, 'Arrival fraction', 0.05, 1, 0.01) * m,
    leave:
      tuneNumber('crossing', 0.42, 'Departure fraction', 0.05, 1, 0.01) * m,
    move: m,
  };
}

/** radius + shadow dissolve — Kiln's curve, not a skin swap */
const plateTween = { duration: 0.42, ease: [0.22, 1, 0.36, 1] } as const;

function radiusFor(slide: Slide) {
  return ['28px', '36px', '0px'][slide]!;
}

const deck = [
  {
    chip: 'drift',
    inset: 'flood',
    kicker: 'flood line',
    n: 0 as Slide,
    orb: 'xstress-orb-0',
    spark: 'xstress-spark-0',
    title: 'Tide',
    tone: 'tide',
    wash: 'xstress-wash-0',
  },
  {
    chip: 'heat',
    inset: '1280°',
    kicker: 'night kiln',
    n: 1 as Slide,
    orb: 'xstress-orb-1',
    spark: 'xstress-spark-1',
    title: 'Ember',
    tone: 'ember',
    wash: 'xstress-wash-1',
  },
  {
    chip: 'arc',
    inset: 'pass',
    kicker: 'no horizon',
    n: 2 as Slide,
    orb: 'xstress-orb-2',
    spark: 'xstress-spark-2',
    title: 'Violet',
    tone: 'violet',
    wash: 'xstress-wash-2',
  },
] as const;

const AUTO = 1.8;
const STRESS = 0.72;

const CLIP = realmFile('asset/xstress-loop.mp4');

/** doubled so the overflow pane can wrap without a seam */
const tape = [
  'flood line',
  'drift 04',
  'kiln floor',
  '1280°',
  'no horizon',
  'pass 7',
  'heat soak',
  'arc bay',
  'flood line',
  'drift 04',
  'kiln floor',
  '1280°',
  'no horizon',
  'pass 7',
  'heat soak',
  'arc bay',
] as const;

/**
 * Crossing: three slides, and a cut that can land at any phase.
 *
 * What the stage is FOR: `c.Crossing` is the only step whose argument cannot
 * be made in a still. Two skins cross inside one flying box while a <video>
 * plays, a pane scrolls, and a mark spins — none of them participants, all
 * of them running through the pass. A view transition snapshots, and a
 * snapshot freezes; this does not, and you can only tell by watching.
 *
 * The beige plate is ONE element: `c.Move` tweens its real box; `animate`
 * tweens radius (that has to live on the modifier, or a size tween smears
 * the corners). Drop-shadows do not tween: Tide's tight teal, Ember's huge
 * warm and Violet's small black are three different lights. Mixing the
 * `box-shadow` string parses and rebuilds every frame and interpolates
 * colour through mud. Each rest-state shadow is a dedicated caster with a
 * static `box-shadow`; only opacity crossfades — the same grammar as the
 * Crossing skins. Live innards — a looping <video>, an overflow pane that
 * auto-scrolls, a spinning mark, a meter, ticking dots — are NOT
 * participants: they reflow with the box and keep running mid-flight (the
 * case a view-transition snapshot would freeze). CSS loops on the hero
 * itself still freeze, because those fight the Move transform. An inset
 * caption inside the plate IS a counterpart, so a skin crosses while its
 * parent flies. Titles, kickers, and chips pair as counterparts
 * (`pack="content"` on type). A kept hairline `c.Move`s with the plate.
 * Unique washes fade.
 *
 * A cut can land at any phase of the intra-slide loops, and mid-flight.
 * Loops are CSS transforms on the motion nodes themselves, so the pass
 * snapshots the live box. `data-phase="crossing"` stills them for the run;
 * they restart from rest on landing.
 *
 * The stage opens still: a tile does not run the conductor, because thirty
 * tiles cutting on their own clocks is a gallery that will not sit still to
 * be read, and the crossing is a thing you ask for rather than something
 * that happens at you. Next, Auto and Stress start it.
 */
export class Crossing extends Component {
  @tracked slide: Slide = 0;
  @tracked mode: Mode = 'manual';

  private arming = createArming();
  private region: ChoreoContext | null = null;
  private raf = 0;
  private started = 0;

  get label() {
    return labels[this.slide];
  }

  get crossing() {
    return this.arming.active();
  }

  get phase() {
    return this.crossing ? 'crossing' : 'looping';
  }

  dotLabel = (slide: Slide) => labels[slide];

  get pace() {
    return this.mode === 'stress' ? STRESS : AUTO;
  }

  on = (slide: Slide) => slide === this.slide;

  isMode = (mode: Mode) => this.mode === mode;

  /** the stage element carries the component, as the handle tests step */
  register = modifier((el: HTMLElement) => {
    Object.defineProperty(el, 'choreoCrossing', {
      configurable: true,
      value: this,
    });
    return () => {
      cancelAnimationFrame(this.raf);
    };
  });

  wire = modifier((_el: Element, [c]: [ChoreoContext]) => {
    this.region = c;
    return () => {
      this.region = null;
    };
  });

  /**
   * Conductor only. It assigns `slide`; Choreo `play()`s the Magic Move.
   * Writing tracked state every frame is how a busy page stalls — cut only
   * when the clock actually changes slides.
   */
  private tick = () => {
    if (this.isDestroying || this.mode === 'manual') {
      return;
    }
    const elapsed = (performance.now() - this.started) / 1000;
    const next = (Math.floor(elapsed / this.pace) % slides.length) as Slide;
    if (next !== this.slide) {
      this.cutTo(next);
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  /**
   * `<` / `>` and the arrows step the deck. The stage is focusable and
   * hears its own keys rather than the window's: every tile listening on
   * `window` would all answer one keypress. Space belongs to the scroller,
   * so the stage declines it.
   */
  onKey = (event: Event) => {
    const { key } = event as KeyboardEvent;
    if (event.defaultPrevented) {
      return;
    }
    if (key === 'ArrowRight' || key === '>' || key === '.') {
      event.preventDefault();
      this.advance();
    } else if (key === 'ArrowLeft' || key === '<' || key === ',') {
      event.preventDefault();
      this.back();
    }
  };

  private cutTo = (slide: Slide) => {
    if (slide === this.slide) {
      return;
    }
    if (this.region) {
      this.arming.begin(this.region);
    }
    this.slide = slide;
  };

  /** Tests and the HUD step slides; autoplay does not use this. */
  go = (slide: Slide) => {
    this.stopClock();
    this.cutTo(slide);
  };

  advance = () => {
    this.go(((this.slide + 1) % slides.length) as Slide);
  };

  back = () => {
    this.go(((this.slide + slides.length - 1) % slides.length) as Slide);
  };

  playAuto = () => {
    this.startClock('auto');
  };

  playStress = () => {
    this.startClock('stress');
  };

  eat = (event: Event) => {
    event.stopPropagation();
  };

  private startClock(mode: Mode) {
    this.mode = mode;
    cancelAnimationFrame(this.raf);
    this.started = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private stopClock() {
    this.mode = 'manual';
    cancelAnimationFrame(this.raf);
  }

  <template>
    <div class='ex'>
      <div
        class='xstress-viewport is-embedded'
        data-test-crossing-stress
        data-slide={{this.slide}}
        data-phase={{this.phase}}
        tabindex='0'
        role='group'
        aria-label='Crossing deck — < and > step the slides'
        {{on 'keydown' this.onKey}}
        {{this.register}}
      >
        {{! the HUD only stops a click from reaching the deck's click-to-advance;
            its buttons are the controls }}
        <header
          {{! template-lint-disable no-invalid-interactive }}
          class='xstress-hud'
          {{on 'click' this.eat}}
        >
          <p class='xstress-index'>
            <span>{{this.label}}</span>
            <span class='xstress-phase' data-test-phase>{{this.phase}}</span>
          </p>
          <div class='xstress-controls'>
            <button
              type='button'
              data-test-back
              {{on 'click' this.back}}
            >Prev</button>
            <button
              type='button'
              data-test-next
              {{on 'click' this.advance}}
            >Next</button>
            <button
              type='button'
              class={{if (this.isMode 'auto') 'is-on'}}
              data-test-auto
              {{on 'click' this.playAuto}}
            >Auto</button>
            <button
              type='button'
              class={{if (this.isMode 'stress') 'is-on'}}
              data-test-stress
              {{on 'click' this.playStress}}
            >Stress</button>
            {{#each slides as |slide|}}
              <button
                type='button'
                class={{if (this.on slide) 'is-on xstress-dot' 'xstress-dot'}}
                aria-label={{this.dotLabel slide}}
                data-test-dot={{slide}}
                {{on 'click' (fn this.go slide)}}
              ></button>
            {{/each}}
          </div>
        </header>

        <Choreo
          class='xstress-stage'
          data-slide={{this.slide}}
          data-phase={{this.phase}}
          {{on 'click' this.advance}}
          as |c|
        >
          <span hidden {{this.wire c}}></span>

          {{#if this.crossing}}
            {{#let (t) as |tt|}}
              <c.Parallel>
                {{! Type and pills: different content, so two skins in one
                    flying box — the homepage crossing. }}
                <c.Crossing
                  @duration={{tt.move}}
                  @ease={{EASE}}
                  @leave={{tt.leave}}
                  @arrive={{tt.arrive}}
                  @overlap={{0.18}}
                />
                {{! Kept identities (plate, hairline): real-box tween, never
                    crop-cover (Violet's width would scale Tide into a square). }}
                <c.Move @of={{c.moved}} @duration={{tt.move}} @ease={{EASE}} />
              </c.Parallel>
            {{/let}}
          {{/if}}

          <div
            class='xstress-hero'
            data-test-hero
            {{motion
              id='xstress-hero'
              role='hero'
              style=(styles borderRadius=(radiusFor this.slide))
              animate=(to borderRadius=(radiusFor this.slide))
              transition=(tuneMotion 'crossing' plateTween 'Plate radius')
            }}
          >
            {{#each deck as |s|}}
              <span
                class='xstress-hero-cast {{s.tone}}'
                data-test-cast={{s.n}}
              ></span>
            {{/each}}
            <div class='xstress-hero-face'>
              <video
                class='xstress-hero-shot'
                data-test-shot
                data-test-clip
                src={{CLIP}}
                muted
                loop
                autoplay
                playsinline
                {{playClip}}
              ></video>
              {{! scrolling the tape must not reach the stage's click-to-advance }}
              <div
                {{! template-lint-disable no-invalid-interactive }}
                class='xstress-hero-scroll'
                data-test-scroll
                {{liveScroll}}
                {{on 'click' this.eat}}
                {{on 'pointerdown' this.eat}}
              >
                {{#each tape as |line|}}
                  <p>{{line}}</p>
                {{/each}}
              </div>
              <span class='xstress-hero-mark' data-test-mark></span>
              <span class='xstress-hero-meter' data-test-meter></span>
              <span class='xstress-hero-ticks' aria-hidden='true'>
                <i></i>
                <i></i>
                <i></i>
              </span>
              {{#each deck as |s|}}
                {{#if (this.on s.n)}}
                  <em
                    class='xstress-inset {{s.tone}}'
                    data-test-inset
                    {{motion id='xstress-inset' role='inset' pack='content'}}
                  >{{s.inset}}</em>
                {{/if}}
              {{/each}}
            </div>
          </div>

          <span
            class='xstress-rule'
            data-test-rule
            {{motion id='xstress-rule' role='rule'}}
          ></span>

          {{#each deck as |s|}}
            {{#if (this.on s.n)}}
              <section class='xstress-slide' data-slide={{s.n}}>
                <div
                  class='xstress-wash {{s.tone}}'
                  data-test-wash
                  {{motion id=s.wash role='ambient'}}
                ></div>
                <div
                  class='xstress-orb {{s.tone}}'
                  {{motion id=s.orb role='ambient'}}
                ></div>
                <div
                  class='xstress-spark {{s.tone}}'
                  {{motion id=s.spark role='ambient'}}
                ></div>
                <b
                  class='xstress-title {{s.tone}}'
                  data-test-title
                  {{motion id='xstress-title' role='type' pack='content'}}
                >{{s.title}}</b>
                <small
                  class='xstress-kicker {{s.tone}}'
                  data-test-kicker
                  {{motion id='xstress-kicker' role='type' pack='content'}}
                >{{s.kicker}}</small>
                <small
                  class='xstress-chip {{s.tone}}'
                  data-test-chip
                  {{motion
                    id='xstress-chip'
                    role='chip'
                    style=(styles borderRadius='999px')
                  }}
                >{{s.chip}}</small>
              </section>
            {{/if}}
          {{/each}}
        </Choreo>
      </div>
    </div>
    <style scoped>
      .ex {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        width: 100%;
        max-width: 100%;
        padding-block: 10px;
        padding-inline: 16px;
        overflow: hidden;
        container-type: size;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        -webkit-user-drag: none;
      }
      .xstress-viewport.is-embedded {
        /* The scene's unit basis. Every size below is a MULTIPLE of these rather
           than a raw viewport unit: `.ex` is `container-type: size`, so cq units
           resolve against the stage's box. `--xs-u` is the square unit, `--xs-w`
           the horizontal one. The 1.15 is deliberate slack: at a straight 1:1 the
           plate fills the stage and the slide's own type has nowhere to go.
           Shrinking the OBJECTS while the layout percentages stay put is what buys
           the title, kicker and chip room to be read at tile size. Three tiers
           follow, all keyed to the stage's box: a narrow single-column tile, the
           two-up tile, and the demo page's much larger stage. */
        --xs-u: 1.15cqmin;
        --xs-w: 1.15cqw;

        position: absolute;
        z-index: 0;
        inset: 0;
        overflow: hidden;
        border-radius: inherit;
        background: #0b2e34;
        color: #f3ece3;
        font-family: var(--font-sans);
        user-select: none;
      }
      @container (max-width: 460px) {
        .xstress-viewport.is-embedded {
          --xs-u: 0.9cqmin;
          --xs-w: 0.9cqw;
        }
      }
      @container (min-width: 900px) {
        .xstress-viewport.is-embedded {
          --xs-u: 1.24cqmin;
          --xs-w: 1.24cqw;
        }

        .xstress-viewport.is-embedded .xstress-kicker,
        .xstress-viewport.is-embedded .xstress-chip {
          font-size: clamp(14px, calc(1.05 * var(--xs-w)), 24px);
        }

        .xstress-viewport.is-embedded .xstress-inset {
          font-size: clamp(12px, calc(1.2 * var(--xs-w)), 20px);
        }

        .xstress-viewport.is-embedded .xstress-hero-scroll {
          font-size: clamp(8px, calc(0.72 * var(--xs-w)), 12px);
        }

        .xstress-viewport.is-embedded .xstress-index {
          font-size: clamp(12px, calc(1.05 * var(--xs-w)), 20px);
        }
      }
      .xstress-viewport.is-embedded .xstress-hero-scroll {
        font-size: clamp(6px, calc(0.72 * var(--xs-w)), 10px);
      }

      .xstress-viewport.is-embedded .xstress-kicker,
      .xstress-viewport.is-embedded .xstress-chip {
        font-size: clamp(12px, calc(1.05 * var(--xs-w)), 17px);
      }

      .xstress-viewport.is-embedded .xstress-hud {
        top: 10px;
        right: 12px;
        max-width: none;
        gap: 0.4em 0.55em;
        font-size: 11px;
      }

      @container (min-width: 900px) {
        .xstress-viewport.is-embedded .xstress-hud {
          top: 18px;
          right: 22px;
          gap: 0.55em 0.8em;
          font-size: 13px;
        }
      }

      .xstress-viewport.is-embedded .xstress-index {
        font-size: 10px;
      }

      .xstress-hud {
        position: absolute;
        z-index: 2;
        top: 3%;
        right: 4%;
        left: auto;
        display: flex;
        flex-wrap: wrap;
        gap: 0.65em 1em;
        align-items: center;
        justify-content: flex-end;
        max-width: min(72ch, calc(70 * var(--xs-w)));
        text-align: right;
        pointer-events: auto;
      }

      .xstress-index {
        display: flex;
        gap: 0.8em;
        justify-content: flex-end;
        align-items: baseline;
        margin: 0;
        font-family: var(--font-mono);
        font-size: clamp(11px, calc(1.05 * var(--xs-w)), 18px);
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: #c8c0b6;
      }

      .xstress-phase {
        letter-spacing: 0.2em;
        color: #8fd0c4;
      }

      .xstress-viewport[data-phase='crossing'] .xstress-phase {
        color: #ffb089;
      }

      .xstress-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45em;
        justify-content: flex-end;
        align-items: center;
      }

      .xstress-controls button {
        appearance: none;
        margin: 0;
        padding: 0.35em 0.7em;
        border: 1px solid rgb(243 236 227 / 22%);
        border-radius: 999px;
        background: rgb(12 18 22 / 35%);
        color: #f3ece3;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        cursor: pointer;
      }

      .xstress-controls button.is-on {
        background: rgb(243 236 227 / 16%);
        border-color: rgb(243 236 227 / 55%);
      }

      .xstress-dot {
        width: 11px;
        height: 11px;
        padding: 0 !important;
        border-radius: 50% !important;
      }

      .xstress-stage {
        position: absolute;
        inset: 0;
        /* a stacking context, so a flying crop-scale cannot cover the HUD */
        z-index: 0;
      }

      .xstress-slide {
        position: absolute;
        inset: 0;
      }

      .xstress-stage[data-slide='0'] {
        background: #0b2e34;
      }

      .xstress-stage[data-slide='1'] {
        background: #2c140e;
      }

      .xstress-stage[data-slide='2'] {
        background: #16102c;
      }

      .xstress-wash,
      .xstress-orb,
      .xstress-spark,
      .xstress-hero,
      .xstress-title,
      .xstress-kicker,
      .xstress-chip,
      .xstress-rule {
        position: absolute;
      }
      .xstress-stage[data-phase='crossing'] .xstress-wash,
      .xstress-stage[data-phase='crossing'] .xstress-orb,
      .xstress-stage[data-phase='crossing'] .xstress-spark,
      .xstress-stage[data-phase='crossing'] .xstress-hero,
      .xstress-stage[data-phase='crossing'] .xstress-title,
      .xstress-stage[data-phase='crossing'] .xstress-kicker,
      .xstress-stage[data-phase='crossing'] .xstress-chip,
      .xstress-stage[data-phase='crossing'] .xstress-rule,
      .xstress-stage[data-phase='crossing'] .xstress-hero-mark,
      .xstress-stage[data-phase='crossing'] .xstress-hero-meter,
      .xstress-stage[data-phase='crossing'] .xstress-hero-ticks i,
      .xstress-stage[data-phase='crossing'] .xstress-inset {
        animation: none !important;
      }

      .xstress-wash {
        inset: -18%;
        border-radius: 40%;
        pointer-events: none;
        z-index: 0;
      }

      .xstress-wash.tide {
        background: radial-gradient(
          circle at 40% 45%,
          #1f7c86 0%,
          rgb(14 58 66 / 0%) 68%
        );
        animation: xstress-wash-tide 7.2s ease-in-out infinite alternate;
      }

      .xstress-wash.ember {
        background: radial-gradient(
          circle at 62% 40%,
          #c44a22 0%,
          rgb(44 20 14 / 0%) 70%
        );
        animation: xstress-wash-ember 5.6s ease-in-out infinite alternate;
      }

      .xstress-wash.violet {
        background: radial-gradient(
          circle at 30% 60%,
          #6b48c4 0%,
          rgb(22 16 44 / 0%) 66%
        );
        animation: xstress-wash-violet 8s ease-in-out infinite alternate;
      }

      .xstress-orb {
        width: calc(18 * var(--xs-u));
        height: calc(18 * var(--xs-u));
        border-radius: 50%;
        pointer-events: none;
        filter: blur(1px);
        z-index: 1;
      }

      .xstress-orb.tide {
        top: 14%;
        left: 12%;
        background: rgb(90 210 198 / 28%);
        animation: xstress-orb-tide 4.6s ease-in-out infinite alternate;
      }

      .xstress-orb.ember {
        top: auto;
        bottom: 10%;
        left: 8%;
        background: rgb(255 140 70 / 30%);
        animation: xstress-orb-ember 3.4s ease-in-out infinite alternate;
      }

      .xstress-orb.violet {
        top: 18%;
        right: 10%;
        left: auto;
        background: rgb(180 140 255 / 32%);
        animation: xstress-orb-violet 5.2s ease-in-out infinite alternate;
      }

      .xstress-spark {
        width: calc(2.4 * var(--xs-u));
        height: calc(2.4 * var(--xs-u));
        border-radius: 50%;
        pointer-events: none;
        z-index: 4;
      }

      .xstress-spark.tide {
        top: 28%;
        right: 22%;
        background: #dff7f2;
        box-shadow: 0 0 18px #8fd0c4;
        animation: xstress-spark-tide 1.6s ease-in-out infinite alternate;
      }

      .xstress-spark.ember {
        top: 22%;
        left: 18%;
        background: #ffe0c2;
        box-shadow: 0 0 18px #ff8a4a;
        animation: xstress-spark-ember 1.15s ease-in-out infinite alternate;
      }

      .xstress-spark.violet {
        bottom: 18%;
        right: 28%;
        top: auto;
        background: #eadbff;
        box-shadow: 0 0 18px #b48cff;
        animation: xstress-spark-violet 1.35s ease-in-out infinite alternate;
      }

      .xstress-hero {
        /* never a 0×0 empty span — crop-scale of that is invisible.
           overflow stays visible: the drop-shadows live on .cast children
           (static box-shadow, opacity-blended) and clip would eat them.
           Innards clip on .face. */
        top: 26%;
        left: calc(50% - calc(14 * var(--xs-u)));
        width: calc(28 * var(--xs-u));
        height: calc(28 * var(--xs-u));
        /* solid paint so a size tween re-renders the gradient at every box */
        background-color: #e8d9c4;
        background-image: linear-gradient(
          160deg,
          #f4efe6 0%,
          #e8d9c4 52%,
          #d4b48a 100%
        );
        z-index: 2;
      }
      .xstress-hero-cast {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        opacity: 0;
        will-change: opacity;
        transition: opacity 0.42s cubic-bezier(0.22, 1, 0.36, 1);
      }

      .xstress-stage[data-slide='0'] .xstress-hero-cast.tide,
      .xstress-stage[data-slide='1'] .xstress-hero-cast.ember,
      .xstress-stage[data-slide='2'] .xstress-hero-cast.violet {
        opacity: 1;
      }

      .xstress-hero-cast.tide {
        box-shadow: 0 18px 42px rgb(6 38 42 / 58%);
      }

      .xstress-hero-cast.ember {
        box-shadow: 0 52px 110px rgb(72 16 4 / 78%);
      }

      .xstress-hero-cast.violet {
        box-shadow: 0 6px 18px rgb(0 0 0 / 42%);
      }

      .xstress-hero-face {
        position: absolute;
        inset: 0;
        overflow: clip;
        border-radius: inherit;
      }

      .xstress-hero-shot {
        position: absolute;
        display: block;
        object-fit: cover;
        background: #0b2e34;
        z-index: 1;
      }

      .xstress-hero-scroll {
        position: absolute;
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior: contain;
        z-index: 1;
        padding: 0.35em 0.55em;
        font-family: var(--font-mono);
        font-size: clamp(6px, calc(0.72 * var(--xs-w)), 10px);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        line-height: 1.32;
        color: #2c140e;
        background: rgb(44 20 14 / 16%);
      }

      .xstress-hero-scroll p {
        margin: 0;
      }

      .xstress-hero-mark {
        position: absolute;
        border: 2px solid rgb(44 20 14 / 45%);
        border-top-color: rgb(11 46 52 / 80%);
        border-radius: 50%;
        animation: xstress-hero-spin 2.4s linear infinite;
      }

      .xstress-hero-meter {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 9%;
        transform-origin: 0 50%;
        background: rgb(11 46 52 / 28%);
        animation: xstress-hero-meter 1.7s ease-in-out infinite alternate;
      }

      .xstress-hero-ticks {
        position: absolute;
        display: flex;
        gap: 5px;
      }

      .xstress-hero-ticks i {
        display: block;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: rgb(11 46 52 / 55%);
        animation: xstress-hero-tick 1.1s ease-in-out infinite alternate;
      }

      .xstress-hero-ticks i:nth-child(2) {
        animation-delay: 0.18s;
      }

      .xstress-hero-ticks i:nth-child(3) {
        animation-delay: 0.36s;
      }

      .xstress-inset {
        position: absolute;
        margin: 0;
        font-family: var(--font-mono);
        font-size: clamp(10px, calc(1.2 * var(--xs-w)), 15px);
        font-style: normal;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: #2c140e;
        z-index: 1;
      }

      .xstress-kicker {
        width: max-content;
        z-index: 3;
        margin: 0;
        color: #c8c0b6;
        font-family: var(--font-mono);
        font-size: clamp(11px, calc(1.05 * var(--xs-w)), 16px);
        letter-spacing: 0.14em;
        text-transform: uppercase;
        font-style: normal;
      }

      .xstress-rule {
        height: 2px;
        background: #f3ece3;
        opacity: 0.55;
        z-index: 3;
        animation: xstress-rule-breathe 2.6s ease-in-out infinite alternate;
      }

      .xstress-title,
      .xstress-chip {
        width: max-content;
        z-index: 3;
      }

      .xstress-title {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 800;
        letter-spacing: -0.05em;
        line-height: 0.92;
        white-space: nowrap;
      }

      .xstress-chip {
        padding: 0.35em 0.85em;
        border-radius: 999px;
        font-family: var(--font-mono);
        font-size: clamp(11px, calc(1.05 * var(--xs-w)), 16px);
        letter-spacing: 0.16em;
        text-transform: uppercase;
        font-style: normal;
      }
      .xstress-stage[data-slide='0'] .xstress-hero {
        top: 26%;
        left: calc(50% - calc(14 * var(--xs-u)));
        width: calc(28 * var(--xs-u));
        height: calc(28 * var(--xs-u));
        animation: xstress-hero-tide 2.8s ease-in-out infinite alternate;
      }

      .xstress-title.tide {
        /* Crossing crop scales from WIDTH. A `left:0; right:0; width:auto`
           box is the stage, so Violet's word explodes into a viewport strip.
           Centre the WORD without `translate` — that fights the flight. */
        top: 62%;
        left: 0;
        right: 0;
        width: max-content;
        margin-inline: auto;
        text-align: center;
        font-size: clamp(
          calc(5.7 * var(--xs-u)),
          calc(9 * var(--xs-w)),
          calc(12.82 * var(--xs-u))
        );
        animation: xstress-title-drift 3.6s ease-in-out infinite alternate;
      }

      .xstress-chip.tide {
        top: 22%;
        left: 12%;
        color: #0b2e34;
        background: #8fd0c4;
        box-shadow: 0 10px 24px rgb(143 208 196 / 45%);
        animation: xstress-chip-bob 1.9s ease-in-out infinite alternate;
      }

      .xstress-kicker.tide {
        top: 74%;
        left: 0;
        right: 0;
        width: max-content;
        margin-inline: auto;
        animation: xstress-title-drift 3.6s ease-in-out infinite alternate;
      }

      .xstress-stage[data-slide='0'] .xstress-hero-shot {
        top: 12%;
        left: 12%;
        right: 12%;
        width: auto;
        height: 38%;
      }

      .xstress-stage[data-slide='0'] .xstress-hero-scroll {
        left: 12%;
        right: 12%;
        bottom: 12%;
        height: 28%;
      }

      .xstress-stage[data-slide='0'] .xstress-hero-mark {
        top: 14%;
        right: 12%;
        width: 18%;
        height: 18%;
      }

      .xstress-stage[data-slide='0'] .xstress-hero-ticks {
        left: 12%;
        bottom: 42%;
      }

      .xstress-inset.tide {
        left: 14%;
        top: 14%;
        right: auto;
        bottom: auto;
        animation: xstress-inset-bob 2.2s ease-in-out infinite alternate;
      }

      .xstress-stage[data-slide='0'] .xstress-rule {
        top: 58%;
        left: 22%;
        width: 56%;
      }
      .xstress-stage[data-slide='1'] .xstress-hero {
        top: 18%;
        right: 10%;
        bottom: auto;
        left: auto;
        width: calc(36 * var(--xs-u));
        height: calc(56 * var(--xs-u));
        animation: xstress-hero-ember 2.2s ease-in-out infinite alternate;
      }

      .xstress-title.ember {
        top: 18%;
        left: 8%;
        right: auto;
        width: max-content;
        text-align: left;
        font-size: clamp(
          calc(4.27 * var(--xs-u)),
          calc(6.4 * var(--xs-w)),
          calc(9.97 * var(--xs-u))
        );
        animation: xstress-title-drift 3.6s ease-in-out infinite alternate;
      }

      .xstress-chip.ember {
        left: 8%;
        bottom: 16%;
        top: auto;
        color: #2c140e;
        background: #ffb089;
        box-shadow: 0 18px 40px rgb(255 138 74 / 40%);
        animation: xstress-chip-bob 1.9s ease-in-out infinite alternate;
      }

      .xstress-kicker.ember {
        top: 38%;
        left: 8%;
        animation: xstress-title-drift 3.6s ease-in-out infinite alternate;
      }

      .xstress-stage[data-slide='1'] .xstress-hero-shot {
        top: 8%;
        left: 10%;
        right: 10%;
        height: 46%;
        width: auto;
      }

      .xstress-stage[data-slide='1'] .xstress-hero-scroll {
        left: 10%;
        right: 10%;
        bottom: 9%;
        height: 30%;
        width: auto;
      }

      .xstress-stage[data-slide='1'] .xstress-hero-mark {
        top: 10%;
        right: 14%;
        bottom: auto;
        width: 16%;
        height: 10%;
      }

      .xstress-stage[data-slide='1'] .xstress-hero-ticks {
        left: 12%;
        bottom: 40%;
      }

      .xstress-inset.ember {
        left: 12%;
        top: 10%;
        bottom: auto;
        animation: xstress-inset-bob 2.2s ease-in-out infinite alternate;
      }

      .xstress-stage[data-slide='1'] .xstress-rule {
        top: 34%;
        left: 8%;
        width: 22%;
      }
      .xstress-stage[data-slide='2'] .xstress-hero {
        top: 12%;
        left: 10%;
        right: auto;
        bottom: auto;
        width: calc(60 * var(--xs-u));
        height: calc(28 * var(--xs-u));
        animation: xstress-hero-violet 3.1s ease-in-out infinite alternate;
      }

      .xstress-title.violet {
        top: auto;
        bottom: 22%;
        left: 8%;
        right: auto;
        width: max-content;
        text-align: left;
        font-size: clamp(
          calc(4.63 * var(--xs-u)),
          calc(6.8 * var(--xs-w)),
          calc(10.32 * var(--xs-u))
        );
        animation: xstress-title-drift 3.6s ease-in-out infinite alternate;
      }

      .xstress-chip.violet {
        right: 8%;
        bottom: 12%;
        left: auto;
        top: auto;
        color: #16102c;
        background: #c4b0ff;
        box-shadow: 0 8px 22px rgb(196 176 255 / 40%);
        animation: xstress-chip-bob 1.9s ease-in-out infinite alternate;
      }

      .xstress-kicker.violet {
        right: 8%;
        bottom: 32%;
        left: auto;
        animation: xstress-title-drift 3.6s ease-in-out infinite alternate;
      }

      .xstress-stage[data-slide='2'] .xstress-hero-shot {
        top: 14%;
        left: 6%;
        width: 54%;
        bottom: 14%;
        height: auto;
      }

      .xstress-stage[data-slide='2'] .xstress-hero-scroll {
        top: 14%;
        right: 6%;
        width: 26%;
        bottom: 14%;
        height: auto;
      }

      .xstress-stage[data-slide='2'] .xstress-hero-mark {
        top: 16%;
        left: 8%;
        right: auto;
        width: 10%;
        height: 22%;
      }

      .xstress-stage[data-slide='2'] .xstress-hero-ticks {
        left: 8%;
        right: auto;
        bottom: 8%;
      }

      .xstress-inset.violet {
        left: 8%;
        top: 18%;
        bottom: auto;
        animation: xstress-inset-bob 2.2s ease-in-out infinite alternate;
      }

      .xstress-stage[data-slide='2'] .xstress-rule {
        left: 8%;
        bottom: 18%;
        top: auto;
        width: 28%;
      }

      @media (prefers-reduced-motion: reduce) {
        .xstress-wash,
        .xstress-orb,
        .xstress-spark,
        .xstress-hero,
        .xstress-title,
        .xstress-kicker,
        .xstress-chip,
        .xstress-rule,
        .xstress-hero-mark,
        .xstress-hero-meter,
        .xstress-hero-ticks i,
        .xstress-inset {
          animation: none !important;
        }
      }

      @keyframes xstress-hero-tide {
        from {
          transform: translate(0, 0) rotate(0deg);
        }
        to {
          transform: translate(28px, -36px) rotate(8deg);
        }
      }

      @keyframes xstress-hero-ember {
        from {
          transform: translate(0, 0);
        }
        to {
          transform: translate(-24px, 56px);
        }
      }

      @keyframes xstress-hero-violet {
        from {
          transform: translate(0, 0) scale(1);
        }
        to {
          transform: translate(48px, 18px) scale(1.08);
        }
      }

      @keyframes xstress-title-drift {
        from {
          transform: translate(0, 0);
        }
        to {
          transform: translate(0, -10px);
        }
      }

      @keyframes xstress-chip-bob {
        from {
          transform: translate(0, 0);
        }
        to {
          transform: translate(16px, 12px);
        }
      }

      @keyframes xstress-hero-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @keyframes xstress-hero-meter {
        from {
          transform: scaleX(0.35);
        }
        to {
          transform: scaleX(0.92);
        }
      }

      @keyframes xstress-hero-tick {
        from {
          transform: translateY(0);
          opacity: 0.4;
        }
        to {
          transform: translateY(-5px);
          opacity: 1;
        }
      }

      @keyframes xstress-inset-bob {
        from {
          transform: translate(0, 0);
        }
        to {
          transform: translate(6px, -4px);
        }
      }

      @keyframes xstress-rule-breathe {
        from {
          opacity: 0.28;
          transform: scaleX(0.86);
        }
        to {
          opacity: 0.7;
          transform: scaleX(1);
        }
      }

      @keyframes xstress-wash-tide {
        from {
          transform: scale(1) translate(0, 0);
        }
        to {
          transform: scale(1.14) translate(4%, -3%);
        }
      }

      @keyframes xstress-wash-ember {
        from {
          transform: scale(1.05) translate(0, 0);
        }
        to {
          transform: scale(0.92) translate(-5%, 4%);
        }
      }

      @keyframes xstress-wash-violet {
        from {
          transform: scale(0.96) translate(0, 0);
        }
        to {
          transform: scale(1.18) translate(6%, 5%);
        }
      }

      @keyframes xstress-orb-tide {
        from {
          transform: translate(0, 0);
        }
        to {
          transform: translate(70px, 40px);
        }
      }

      @keyframes xstress-orb-ember {
        from {
          transform: translate(0, 0);
        }
        to {
          transform: translate(50px, -64px);
        }
      }

      @keyframes xstress-orb-violet {
        from {
          transform: translate(0, 0);
        }
        to {
          transform: translate(-80px, 36px);
        }
      }

      @keyframes xstress-spark-tide {
        from {
          transform: translate(0, 0) scale(1);
        }
        to {
          transform: translate(-28px, 46px) scale(1.6);
        }
      }

      @keyframes xstress-spark-ember {
        from {
          transform: translate(0, 0) scale(1);
        }
        to {
          transform: translate(36px, 22px) scale(0.6);
        }
      }

      @keyframes xstress-spark-violet {
        from {
          transform: translate(0, 0) scale(1);
        }
        to {
          transform: translate(-22px, -40px) scale(1.8);
        }
      }
    </style>
  </template>
}

export class CrossingDemo extends GalleryDemo {
  static stage = Crossing;
  static notes = CrossingNotes;
}
