import { array } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import type { ChoreoContext } from 'glimmer-motion';
import { beacon, Choreo, motion } from 'glimmer-motion';

const IN = 0.32;
const GROUP = 0.38;
const FLIGHT = 1.18;
const PULSE = 0.46;
const GLIDE = [0.22, 1, 0.36, 1];
const LAST = 4;
const SLIDES = [0, 1, 2, 3, 4] as const;

/**
 * Held calls, week 36. The line is the series; the bead rides it from
 * Monday to Friday, path-mapped onto that measured delta.
 */
const SERIES = 'M 56 62 L 106 49 L 156 68 L 206 37 L 256 56';
const RIDE = 'M 0 0 L 40 -18 L 80 14 L 130 -36 L 180 -8';

const DAYS = [
  { h: 56, id: 'mon', label: 'Mon', x: 47 },
  { h: 69, id: 'tue', label: 'Tue', x: 97 },
  { h: 50, id: 'wed', label: 'Wed', x: 147 },
  { h: 81, id: 'thu', label: 'Thu', x: 197 },
  { h: 62, id: 'fri', label: 'Fri', x: 247 },
] as const;

/**
 * A presentation is a run that parks — and a deck is five of those, in a row.
 *
 * Click the plate to open the next gate on this slide. Mash mid-build and the
 * segment completes rather than skipping. When the slide is done, the same
 * click turns the page. The arrows in the bar change slides outright; they
 * do not play builds. Back shows the previous slide already built.
 */
export class Presentation extends Component {
  @tracked live = false;
  @tracked slide = 0;
  @tracked arrive: 'back' | 'fwd' = 'fwd';
  private seen = false;
  private c: ChoreoContext | null = null;

  wire = modifier((el: HTMLElement, [c]: [ChoreoContext]) => {
    this.c = c;
    const host = el.closest('.pres-slide') as
      | (HTMLElement & { presentation?: Presentation })
      | null;
    if (host) {
      host.presentation = this;
    }
    return () => {
      this.c = null;
      if (host) {
        delete host.presentation;
      }
    };
  });

  /** first render of a region compiles no timeline — start on the next frame */
  boot = modifier(() => {
    const id = requestAnimationFrame(() => {
      if (!this.seen) {
        this.seen = true;
        this.live = true;
      }
    });
    return () => cancelAnimationFrame(id);
  });

  get atStart() {
    return this.slide <= 0;
  }

  get atEnd() {
    return this.slide >= LAST;
  }

  get folio() {
    return `${this.slide + 1} / ${LAST + 1}`;
  }

  is = (n: number) => this.slide === n;

  tap = () => {
    if (!this.live) {
      this.live = true;
      return;
    }
    const run = this.c?.run;
    if (run && !run.isDone()) {
      run.advance();
      return;
    }
    this.fwd();
  };

  fwd = (event?: Event) => {
    event?.stopPropagation();
    if (this.slide >= LAST) {
      return;
    }
    this.arrive = 'fwd';
    this.slide += 1;
  };

  back = (event: Event) => {
    event.stopPropagation();
    if (this.slide <= 0) {
      return;
    }
    this.arrive = 'back';
    this.slide -= 1;
  };

  <template>
    <div class="ex">
      <div class="pres" {{this.boot}}>
        <Choreo
          class={{if (this.is 0) "pres-slide is-title" "pres-slide"}}
          data-arrive={{this.arrive}}
          data-slide={{this.slide}}
          aria-label="Advance the presentation"
          {{on "click" this.tap}}
          as |c|
        >
          <span hidden {{this.wire c}}></span>

          {{#if this.live}}
            {{#if (this.is 0)}}
              <p class="pres-eye" {{motion id="s0-eye" role="build"}}>North Lock
                Terminal</p>
              <h2 class="pres-display" {{motion id="s0-title" role="build"}}>Q3
                board review</h2>
              <p class="pres-lede" {{motion id="s0-kicker" role="build"}}>The
                night window is the whole game.</p>
              <p class="pres-meta" {{motion id="s0-meta" role="build"}}>12
                September 2026 · confidential · yard ops</p>

              <c.Sequence>
                <c.Tween
                  @of={{c.id "s0-eye"}}
                  @opacity={{array 0 1}}
                  @duration={{IN}}
                  @ease="easeOut"
                />
                <c.Tween
                  @of={{c.id "s0-title"}}
                  @opacity={{array 0 1}}
                  @y={{array 14 0}}
                  @duration={{0.48}}
                  @ease="easeOut"
                />
                <c.Gate @delay={{0.7}} />
                <c.Tween
                  @of={{c.id "s0-kicker"}}
                  @opacity={{array 0 1}}
                  @y={{array 8 0}}
                  @duration={{IN}}
                  @ease="easeOut"
                />
                <c.Gate />
                <c.Tween
                  @of={{c.id "s0-meta"}}
                  @opacity={{array 0 1}}
                  @duration={{IN}}
                  @ease="easeOut"
                />
              </c.Sequence>
            {{else if (this.is 1)}}
              <p class="pres-eye">02 — constraint</p>
              <h2 class="pres-hed" {{motion id="s1-hed" role="build"}}>Berth time
                is the constraint</h2>
              <div class="pres-cols">
                <section class="pres-group" {{motion id="s1-g1" role="build"}}>
                  <h3>Where it sits</h3>
                  <ul>
                    <li>Night window at 61% utilisation. We budgeted 74%.</li>
                    <li>Average empty hold is 18 minutes — up from 11 in Q2.</li>
                    <li>Four of five weekday peaks miss the tide gate.</li>
                  </ul>
                </section>
                <section class="pres-group" {{motion id="s1-g2" role="build"}}>
                  <h3>What it costs</h3>
                  <ul>
                    <li>$2.4k demurrage per slipped call, on the current book.</li>
                    <li>Crew overtime tracks the miss, not the plan.</li>
                    <li>The yard cannot pre-stage if the window does not hold.</li>
                  </ul>
                </section>
                <section class="pres-group" {{motion id="s1-g3" role="build"}}>
                  <h3>What we missed</h3>
                  <ul>
                    <li>Week 33: two grain ships stacked on the same night.</li>
                    <li>Week 35: a late bunker stole the window we had sold.</li>
                  </ul>
                </section>
              </div>

              <c.Sequence>
                <c.Tween
                  @of={{c.id "s1-hed"}}
                  @opacity={{array 0 1}}
                  @y={{array 10 0}}
                  @duration={{IN}}
                  @ease="easeOut"
                />
                <c.Gate />
                <c.Tween
                  @of={{c.id "s1-g1"}}
                  @opacity={{array 0 1}}
                  @y={{array 10 0}}
                  @duration={{GROUP}}
                  @ease="easeOut"
                />
                <c.Gate />
                <c.Tween
                  @of={{c.id "s1-g2"}}
                  @opacity={{array 0 1}}
                  @y={{array 10 0}}
                  @duration={{GROUP}}
                  @ease="easeOut"
                />
                <c.Gate />
                <c.Tween
                  @of={{c.id "s1-g3"}}
                  @opacity={{array 0 1}}
                  @y={{array 10 0}}
                  @duration={{GROUP}}
                  @ease="easeOut"
                />
              </c.Sequence>
            {{else if (this.is 2)}}
              <p class="pres-eye">03 — week 36</p>
              <h2 class="pres-hed" {{motion id="s2-hed" role="build"}}>Calls held
                against the plan</h2>
              <div class="pres-split">
                <svg
                  class="pres-plot"
                  viewBox="0 0 320 160"
                  aria-label="Bar chart of calls held Monday to Friday, with a line for the series"
                >
                  <g class="pres-grid" {{motion id="s2-grid" role="build"}}>
                    <line x1="40" y1="18" x2="40" y2="118" />
                    <line x1="40" y1="118" x2="280" y2="118" />
                    <line x1="40" y1="43" x2="280" y2="43" class="is-plan" />
                    <text x="34" y="22" text-anchor="end">16</text>
                    <text x="34" y="47" text-anchor="end">12</text>
                    <text x="34" y="122" text-anchor="end">0</text>
                    <text x="44" y="38" class="pres-plan-lab">plan</text>
                  </g>
                  {{#each DAYS as |day|}}
                    <rect
                      class="pres-col"
                      x={{day.x}}
                      y={{this.barY day.h}}
                      width="22"
                      height={{day.h}}
                      {{motion id=day.id role="bar"}}
                    />
                    <text
                      class="pres-tick"
                      x={{this.barTick day.x}}
                      y="134"
                      text-anchor="middle"
                    >{{day.label}}</text>
                  {{/each}}
                  <path class="pres-ghost" d={{SERIES}} />
                  <path
                    class="pres-series"
                    d={{SERIES}}
                    {{motion id="s2-line" role="build"}}
                  />
                  <span class="pres-origin" {{beacon "week-start"}}></span>
                  <circle
                    class="pres-bead"
                    cx="256"
                    cy="56"
                    r="5"
                    {{motion id="s2-bead" role="bead"}}
                  />
                </svg>
                {{! the origin is HTML — SVG cannot host a beacon }}
                <span class="pres-origin" {{beacon "week-start"}}></span>
                <span class="pres-bead-slot" {{motion id="s2-bead" role="bead"}}
                ></span>
                <ul class="pres-legend" {{motion id="s2-leg" role="build"}}>
                  <li class="is-held">Held</li>
                  <li class="is-plan">Plan · 12</li>
                </ul>
                <p class="pres-note" {{motion id="s2-note" role="build"}}>
                  Thursday is the only day we beat the plan. The line is the
                  held series — mash the click and the bead finishes the week.
                </p>
              </div>

              <c.Sequence>
                <c.Tween
                  @of={{c.id "s2-hed"}}
                  @opacity={{array 0 1}}
                  @duration={{IN}}
                  @ease="easeOut"
                />
                <c.Gate />
                <c.Parallel>
                  <c.Tween
                    @of={{c.id "s2-grid"}}
                    @opacity={{array 0 1}}
                    @duration={{IN}}
                  />
                  <c.Tween
                    @of={{c.inserted "bar"}}
                    @scaleY={{array 0 1}}
                    @duration={{0.52}}
                    @ease="easeOut"
                    @stagger={{0.06}}
                  />
                </c.Parallel>
                <c.Gate />
                <c.Parallel>
                  <c.Tween
                    @of={{c.id "s2-line"}}
                    @pathLength={{array 0 1}}
                    @opacity={{array 0 1}}
                    @duration={{FLIGHT}}
                    @ease={{GLIDE}}
                  />
                  <c.Move
                    @of={{c.id "s2-bead"}}
                    @from={{c.beacon "week-start"}}
                    @path={{RIDE}}
                    @size={{false}}
                    @duration={{FLIGHT}}
                    @ease={{GLIDE}}
                  />
                  <c.Tween
                    @of={{c.id "s2-bead"}}
                    @opacity={{array 0 1}}
                    @duration={{0.2}}
                  />
                  <c.Tween
                    @of={{c.id "s2-leg"}}
                    @opacity={{array 0 1}}
                    @duration={{IN}}
                  />
                </c.Parallel>
                <c.Gate />
                <c.Tween
                  @of={{c.id "s2-note"}}
                  @opacity={{array 0 1}}
                  @duration={{IN}}
                />
              </c.Sequence>
            {{else if (this.is 3)}}
              <p class="pres-eye">04 — the plan</p>
              <h2 class="pres-hed" {{motion id="s3-hed" role="build"}}>Three
                moves this quarter</h2>
              <div class="pres-cols is-two">
                <section class="pres-group" {{motion id="s3-g1" role="build"}}>
                  <h3>1 · Cut the empty hold</h3>
                  <ul>
                    <li>Pre-stage the yard at 16:30, not on the whistle.</li>
                    <li>One tug on standby for the 19:00 window, not two at 21:00.</li>
                    <li>Target: 18 min → 9 min empty hold.</li>
                  </ul>
                </section>
                <section class="pres-group" {{motion id="s3-g2" role="build"}}>
                  <h3>2 · Sell the night window</h3>
                  <ul>
                    <li>Publish a firm 74% book, not a hopeful 61%.</li>
                    <li>Grain takes Tuesday/Thursday nights; mixed cargo the rest.</li>
                    <li>Refuse the late bunker that stole week 35.</li>
                  </ul>
                </section>
              </div>
              <section class="pres-group is-wide" {{motion id="s3-g3" role="build"}}>
                <h3>3 · Measure the turn, not the wish</h3>
                <ul>
                  <li>Yard turns from 3.1 to 4.0 a night is the operating number,
                    not utilisation on a slide.</li>
                  <li>Ops owns the window; commercial owns the book. One miss,
                    both names on the note.</li>
                </ul>
              </section>

              <c.Sequence>
                <c.Tween
                  @of={{c.id "s3-hed"}}
                  @opacity={{array 0 1}}
                  @duration={{IN}}
                  @ease="easeOut"
                />
                <c.Gate />
                <c.Tween
                  @of={{c.id "s3-g1"}}
                  @opacity={{array 0 1}}
                  @y={{array 10 0}}
                  @duration={{GROUP}}
                  @ease="easeOut"
                />
                <c.Gate />
                <c.Tween
                  @of={{c.id "s3-g2"}}
                  @opacity={{array 0 1}}
                  @y={{array 10 0}}
                  @duration={{GROUP}}
                  @ease="easeOut"
                />
                <c.Gate />
                <c.Tween
                  @of={{c.id "s3-g3"}}
                  @opacity={{array 0 1}}
                  @y={{array 10 0}}
                  @duration={{GROUP}}
                  @ease="easeOut"
                />
              </c.Sequence>
            {{else}}
              <p class="pres-eye">05 — the ask</p>
              <h2 class="pres-hed" {{motion id="s4-hed" role="build"}}>Approve
                the night window</h2>
              <div class="pres-ask">
                <p class="pres-figure" {{motion id="s4-fig" role="build"}}>
                  <b>4.2</b>
                  <small>hours saved per call at 74%</small>
                </p>
                <section class="pres-group" {{motion id="s4-g1" role="build"}}>
                  <h3>Decision</h3>
                  <ul>
                    <li>Lock the 19:00–01:00 window as sold capacity, effective
                      week 40.</li>
                    <li>Ops to staff one standby tug; commercial to rebook grain
                      onto Tue/Thu nights.</li>
                    <li>Review at the October board with the turn number, not
                      the utilisation slide.</li>
                  </ul>
                </section>
              </div>

              <c.Sequence>
                <c.Tween
                  @of={{c.id "s4-hed"}}
                  @opacity={{array 0 1}}
                  @duration={{IN}}
                  @ease="easeOut"
                />
                <c.Gate />
                <c.Tween
                  @of={{c.id "s4-g1"}}
                  @opacity={{array 0 1}}
                  @y={{array 10 0}}
                  @duration={{GROUP}}
                  @ease="easeOut"
                />
                <c.Gate />
                <c.Tween
                  @of={{c.id "s4-fig"}}
                  @opacity={{array 0 1 1}}
                  @scale={{array 0.86 1.08 1}}
                  @duration={{PULSE}}
                  @ease="easeOut"
                />
              </c.Sequence>
            {{/if}}
          {{/if}}
        </Choreo>

        <div class="pres-bar">
          <nav
            class="pres-segs"
            data-slide={{this.slide}}
            aria-label="Slides"
          >
            {{#each SLIDES as |n|}}
              <i></i>
            {{/each}}
          </nav>
          <span class="pres-folio">{{this.folio}}</span>
          <button
            type="button"
            class={{if this.atStart "pres-arr is-off" "pres-arr"}}
            aria-label="Previous slide"
            disabled={{this.atStart}}
            {{on "click" this.back}}
          >←</button>
          <button
            type="button"
            class={{if this.atEnd "pres-arr is-off" "pres-arr"}}
            aria-label="Next slide"
            disabled={{this.atEnd}}
            {{on "click" this.fwd}}
          >→</button>
        </div>
      </div>
    </div>
  </template>

  barY = (h: number) => 118 - h;
  barTick = (x: number) => x + 11;
}
