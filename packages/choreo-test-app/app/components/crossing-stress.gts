import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import {
  Choreo,
  type ChoreoContext,
  createArming,
  motion,
  spring,
} from 'glimmer-motion';
import config from 'test-app/config/environment';

const slides = [0, 1, 2] as const;
type Slide = (typeof slides)[number];
type Mode = 'manual' | 'auto' | 'stress';

const titles = ['Tide', 'Ember', 'Violet'] as const;
const chips = ['drift', 'heat', 'arc'] as const;
const labels = ['01  Tide', '02  Ember', '03  Violet'] as const;

/** Loose on purpose: a stiff spring lands before you can cut into it. */
const flight = spring({ bounce: 0.12, visualDuration: 0.58 });

const AUTO = 1.8;
const STRESS = 0.72;

/**
 * Magic Move stress — `/crossing-stress`, not the Kiln film at
 * `/crossing-reel`.
 *
 * Three full-viewport slides, each with its own looping motion at more
 * than one depth (a wash behind, a matching tile in the middle, a spark
 * in front), and a different ground colour so a cut is never ambiguous.
 * Shared identities (hero, title, chip) stay mounted: only the stylesheet
 * says where they live. Slide-local washes and ornaments insert and leave.
 *
 * A cut can land at any phase of those loops, and mid-flight. The region
 * measures the matching tile *where it currently is* (live box, transform
 * included), then flies it onto the next slide's resting start via the
 * crossing curve. Intra-slide CSS loops are frozen for the span of that
 * run (`data-phase="crossing"`) so they do not fight the flight, and they
 * restart from rest on landing.
 *
 * The question the page is asking: does the looping motion composite
 * smoothly with a Magic Move that interrupted it?
 */
export class CrossingStress extends Component {
  @tracked slide: Slide = 0;
  @tracked mode: Mode = config.environment === 'test' ? 'manual' : 'auto';

  private arming = createArming();
  private region: ChoreoContext | null = null;
  private raf = 0;
  private started = 0;

  get title() {
    return titles[this.slide];
  }

  get chip() {
    return chips[this.slide];
  }

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

  register = modifier((el: HTMLElement) => {
    el.closest<HTMLElement>('.app-shell')?.setAttribute(
      'data-layout-ignore',
      '',
    );
    Object.defineProperty(el, 'choreoCrossingStress', {
      configurable: true,
      value: this,
    });
    (
      window as Window & { __choreoCrossingStress?: CrossingStress }
    ).__choreoCrossingStress = this;
    window.addEventListener('keydown', this.onKey);
    if (this.mode !== 'manual') {
      this.started = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
    return () => {
      cancelAnimationFrame(this.raf);
      window.removeEventListener('keydown', this.onKey);
      delete (window as Window & { __choreoCrossingStress?: CrossingStress })
        .__choreoCrossingStress;
      el.closest<HTMLElement>('.app-shell')?.removeAttribute(
        'data-layout-ignore',
      );
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

  private onKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight' || event.key === ' ') {
      event.preventDefault();
      this.advance();
    } else if (event.key === 'ArrowLeft') {
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

  /** Tests and the HUD step slides; live autoplay does not use this. */
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
    <div
      class="xstress-viewport"
      data-test-crossing-stress
      data-slide={{this.slide}}
      data-phase={{this.phase}}
      {{this.register}}
    >
      <header class="xstress-hud" {{on "click" this.eat}}>
        <p class="xstress-index">
          <span>{{this.label}}</span>
          <span class="xstress-phase" data-test-phase>{{this.phase}}</span>
        </p>
        <p class="xstress-lede">
          Cut at any time — the matching tile flies from wherever it is to
          the next slide's start.
        </p>
        <div class="xstress-controls">
          <button
            type="button"
            data-test-back
            {{on "click" this.back}}
          >Prev</button>
          <button
            type="button"
            data-test-next
            {{on "click" this.advance}}
          >Next</button>
          <button
            type="button"
            class={{if (this.isMode "auto") "is-on"}}
            data-test-auto
            {{on "click" this.playAuto}}
          >Auto</button>
          <button
            type="button"
            class={{if (this.isMode "stress") "is-on"}}
            data-test-stress
            {{on "click" this.playStress}}
          >Stress</button>
          {{#each slides as |slide|}}
            <button
              type="button"
              class={{if (this.on slide) "is-on xstress-dot" "xstress-dot"}}
              aria-label={{this.dotLabel slide}}
              data-test-dot={{slide}}
              {{on "click" (fn this.go slide)}}
            ></button>
          {{/each}}
        </div>
      </header>

      <Choreo
        class="xstress-stage"
        data-slide={{this.slide}}
        data-phase={{this.phase}}
        @quiet={{true}}
        {{on "click" this.advance}}
        as |c|
      >
        <span hidden {{this.wire c}}></span>

        {{#if this.crossing}}
          {{! Shared identities are kept-and-moved (same DOM, new rest).
              Slide-local washes and ornaments insert/leave — Crossing
              dissolves those, Move flies the matching tile from its live
              box onto the next slide's start. }}
          <c.Parallel>
            <c.Move
              @of={{c.moved "hero"}}
              @spring={{flight}}
              @size="crop"
              @swap="none"
            />
            <c.Move
              @of={{c.moved "chip"}}
              @spring={{flight}}
              @size="crop"
              @swap="none"
            />
            <c.Move
              @of={{c.moved "title"}}
              @spring={{flight}}
              @size="crop"
              @swap="none"
            />
            <c.Raise @of={{c.id "hero"}} />
            <c.Crossing @swap="none" @spring={{flight}} />
          </c.Parallel>
        {{/if}}

        {{#if (this.on 0)}}
          <div
            class="xstress-wash"
            data-test-wash
            {{motion id="wash-0" role="ambient"}}
          ></div>
          <div
            class="xstress-orb is-back"
            {{motion id="orb-0" role="ambient"}}
          ></div>
          <div
            class="xstress-spark"
            {{motion id="spark-0" role="ambient"}}
          ></div>
        {{else if (this.on 1)}}
          <div
            class="xstress-wash"
            data-test-wash
            {{motion id="wash-1" role="ambient"}}
          ></div>
          <div
            class="xstress-orb is-back"
            {{motion id="orb-1" role="ambient"}}
          ></div>
          <div
            class="xstress-spark"
            {{motion id="spark-1" role="ambient"}}
          ></div>
        {{else}}
          <div
            class="xstress-wash"
            data-test-wash
            {{motion id="wash-2" role="ambient"}}
          ></div>
          <div
            class="xstress-orb is-back"
            {{motion id="orb-2" role="ambient"}}
          ></div>
          <div
            class="xstress-spark"
            {{motion id="spark-2" role="ambient"}}
          ></div>
        {{/if}}

        <span
          class="xstress-hero"
          data-test-hero
          {{motion id="hero" role="hero"}}
        ></span>
        <b
          class="xstress-title"
          data-test-title
          {{motion id="title" role="type"}}
        >{{this.title}}</b>
        <small
          class="xstress-chip"
          data-test-chip
          {{motion id="chip" role="chip"}}
        >{{this.chip}}</small>
      </Choreo>
    </div>
  </template>
}
