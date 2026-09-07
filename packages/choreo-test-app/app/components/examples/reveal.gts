import { registerDestructor } from '@ember/destroyable';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion } from 'glimmer-motion';
import { tuneMotion } from 'test-app/lib/demo-tuning';

/** One pour. `shown` is the readout, counted up when the row arrives. */
class Pour {
  @tracked shown = 0;

  take: string;
  label: string;
  heat: number;

  constructor(take: string, label: string, heat: number) {
    this.take = take;
    this.label = label;
    this.heat = heat;
  }

  get tone() {
    return this.heat >= 1000 ? 'is-hot' : '';
  }

  /** the bar reads against the crucible ceiling, not against the hottest pour */
  get fraction() {
    return this.heat / 1400;
  }
}

const log: Array<[string, string, number] | string> = [
  'Shift A · 22:00',
  ['04', 'Atlas', 1280],
  ['07', 'Ember', 920],
  ['11', 'Flux', 640],
  ['02', 'Halo', 410],
  ['19', 'Ore', 760],
  'Shift B · 06:00',
  ['03', 'Forge', 1100],
  ['08', 'Vault', 980],
  ['12', 'Cinder', 1340],
  ['05', 'Slag', 520],
  ['21', 'Tine', 880],
  'Shift C · 14:00',
  ['09', 'Drift', 700],
  ['14', 'Quench', 300],
  ['06', 'Billet', 1180],
  ['17', 'Anvil', 1020],
  ['01', 'Char', 460],
];

const resting = { opacity: 0, y: 26 };
const arrived = { opacity: 1, y: 0 };
const rise = { bounce: 0.2, type: 'spring', visualDuration: 0.44 } as const;

const flat = { scaleX: 0 };
const fill = { delay: 0.14, duration: 0.5, ease: 'easeOut' } as const;

const parked = { opacity: 0, x: -20 };
const passing = { opacity: 1, x: 0 };
const sweep = { duration: 0.34, ease: 'easeOut' } as const;

/**
 * `whileInView` — a pose that plays when the element crosses into view.
 *
 * The column scrolls inside the stage rather than with the page, so the
 * observer is handed that element as its `root`. Without it the rows would be
 * measured against the window, the whole list would count as in view the moment
 * the card is on screen, and all eighteen would play at once — which is the
 * thing this is here to avoid.
 *
 * Two viewport settings, side by side, because the difference is the whole
 * lesson: the pours use `once: true`, so each one arrives and then stays put
 * however many times you scroll past it. The shift markers use `once: false`,
 * so they leave when they leave and play again on the way back. An arrival
 * happens once; an effect tracks the scroll.
 *
 * `onViewportEnter` is the escape hatch for the part the poses cannot do — the
 * readout counting up to its heat. The pose animates the element; the callback
 * runs your own code on the same crossing.
 */
export class Reveal extends Component {
  @tracked generation = 0;
  @tracked root?: Element;
  private column?: HTMLElement;
  private frames = new Set<number>();

  constructor(owner: Owner, args: object) {
    super(owner, args);
    registerDestructor(this, () => this.stopCounting());
  }

  bind = modifier((element: HTMLElement) => {
    this.column = element;
    this.root = element;
    return () => {
      this.column = undefined;
      this.root = undefined;
    };
  });

  get entries() {
    return log.map((entry, index) =>
      typeof entry === 'string'
        ? { key: `m${index}-${this.generation}`, marker: entry }
        : {
            key: `p${index}-${this.generation}`,
            pour: new Pour(entry[0], entry[1], entry[2]),
          }
    );
  }

  /** the readout is ours to drive; `onViewportEnter` just says when */
  count = (pour: Pour) => {
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - started) / 620, 1);
      // ease out, so it settles into the number rather than stopping at it
      pour.shown = Math.round(pour.heat * (1 - (1 - t) ** 3));
      if (t < 1) {
        this.frames.add(requestAnimationFrame(tick));
      }
    };
    this.frames.add(requestAnimationFrame(tick));
  };

  private stopCounting() {
    this.frames.forEach((id) => cancelAnimationFrame(id));
    this.frames.clear();
  }

  replay = () => {
    this.stopCounting();
    this.column?.scrollTo({ top: 0 });
    this.generation += 1;
  };

  <template>
    <div class="ex">
      <div class="pours" {{this.bind}}>
        {{#each this.entries key="key" as |entry|}}
          {{#if entry.marker}}
            <div
              class="shift"
              {{motion
                initial=parked
                whileInView=passing
                viewport=(everyPass this.root)
                transition=(tuneMotion "reveal" sweep "sweep")
              }}
            >{{entry.marker}}</div>
          {{else if entry.pour}}
            <article
              class="pour {{entry.pour.tone}}"
              {{motion
                initial=resting
                whileInView=arrived
                viewport=(band this.root)
                transition=(tuneMotion "reveal" rise "rise")
                onViewportEnter=(fn this.count entry.pour)
              }}
            >
              <span class="pour-take">{{entry.pour.take}}</span>
              <b>{{entry.pour.label}}</b>
              <small>{{entry.pour.shown}}°</small>
              <i
                class="pour-bar"
                {{motion
                  initial=flat
                  whileInView=(bar entry.pour.fraction)
                  viewport=(band this.root)
                  transition=(tuneMotion "reveal" fill "fill")
                }}
              ></i>
            </article>
          {{/if}}
        {{/each}}
      </div>

      <p class="pours-legend">
        <span class="key-pour"></span>
        once — arrives and stays
        <span class="key-shift"></span>
        once:false — replays every pass
      </p>

      <button type="button" class="replay" {{on "click" this.replay}}>
        Replay
      </button>
    </div>
  </template>
}

/**
 * `amount` is how much of a row has to be inside the band before it counts as
 * arrived; `once` unhooks the observer after the first crossing.
 */
function band(root: Element | undefined) {
  // React passes a ref object here; Glimmer has the element, so wrap it in the
  // shape the viewport options expect
  return { amount: 0.6, once: true, root: { current: root ?? null } };
}

/** the same options without `once`, so the marker plays on every crossing */
function everyPass(root: Element | undefined) {
  return { amount: 0.6, once: false, root: { current: root ?? null } };
}

function bar(fraction: number) {
  return { scaleX: fraction };
}

// Declare the demo variables before the first interactive Choreo pass.
tuneMotion('reveal', sweep, 'sweep');
tuneMotion('reveal', rise, 'rise');
tuneMotion('reveal', fill, 'fill');
