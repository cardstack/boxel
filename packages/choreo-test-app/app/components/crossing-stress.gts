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
  styles,
} from 'glimmer-motion';
import config from 'test-app/config/environment';

const slides = [0, 1, 2] as const;
type Slide = (typeof slides)[number];
type Mode = 'manual' | 'auto' | 'stress';

const labels = ['01  Tide', '02  Ember', '03  Violet'] as const;

/** Loose on purpose: a stiff spring lands before you can cut into it. */
const flight = spring({ bounce: 0.12, visualDuration: 0.58 });

function radiusFor(slide: Slide) {
  return ['28px', '36px', '0px'][slide]!;
}

const deck = [
  {
    chip: 'drift',
    n: 0 as Slide,
    orb: 'xstress-orb-0',
    spark: 'xstress-spark-0',
    title: 'Tide',
    tone: 'tide',
    wash: 'xstress-wash-0',
  },
  {
    chip: 'heat',
    n: 1 as Slide,
    orb: 'xstress-orb-1',
    spark: 'xstress-spark-1',
    title: 'Ember',
    tone: 'ember',
    wash: 'xstress-wash-1',
  },
  {
    chip: 'arc',
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

/**
 * Magic Move stress — `/crossing-stress`, not the Kiln film at
 * `/crossing-reel`.
 *
 * Three full-viewport slides as counterpart trees: same ids (`xstress-hero`,
 * `xstress-title`, `xstress-chip`) in each, unique washes and ornaments. One
 * `<c.Crossing>` is the whole move — Keynote's rule: whatever paired, flies;
 * whatever didn't, fades. The canned step does not care whether the sprite
 * is a plate, a word, or a pill.
 *
 * A cut can land at any phase of the intra-slide loops, and mid-flight.
 * Loops are CSS transforms on the motion nodes themselves, so the pass
 * snapshots the live box — not a rest frame with a wiggling child inside.
 * `data-phase="crossing"` stills them for the run (`@quiet` pauses the
 * rest); they restart from rest on landing.
 */
export class CrossingStress extends Component {
  @tracked slide: Slide = 0;
  @tracked mode: Mode = config.environment === 'test' ? 'manual' : 'auto';

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

  register = modifier((el: HTMLElement) => {
    el.closest<HTMLElement>('.app-shell')?.setAttribute(
      'data-layout-ignore',
      ''
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
        'data-layout-ignore'
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
          Cut at any time — the matching tile flies from wherever it is to the
          next slide's start.
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
          {{! One composite, every matched id — plate, type, chip. Unmatched
              washes and sparks leave/arrive. @swap="none": each identity
              is one skin; a during-crossfade of identical fills dims. }}
          <c.Crossing @swap="none" @spring={{flight}} />
        {{/if}}

        {{#each deck as |s|}}
          {{#if (this.on s.n)}}
            <section class="xstress-slide" data-slide={{s.n}}>
              <div
                class="xstress-wash {{s.tone}}"
                data-test-wash
                {{motion id=s.wash role="ambient"}}
              ></div>
              <div
                class="xstress-orb {{s.tone}}"
                {{motion id=s.orb role="ambient"}}
              ></div>
              <div
                class="xstress-spark {{s.tone}}"
                {{motion id=s.spark role="ambient"}}
              ></div>
              <div
                class="xstress-hero {{s.tone}}"
                data-test-hero
                {{motion
                  id="xstress-hero"
                  role="hero"
                  style=(styles borderRadius=(radiusFor s.n))
                }}
              ></div>
              <b
                class="xstress-title {{s.tone}}"
                data-test-title
                {{motion id="xstress-title" role="type"}}
              >{{s.title}}</b>
              <small
                class="xstress-chip {{s.tone}}"
                data-test-chip
                {{motion id="xstress-chip" role="chip"}}
              >{{s.chip}}</small>
            </section>
          {{/if}}
        {{/each}}
      </Choreo>
    </div>
  </template>
}
