import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { animateView, motion, Presence } from 'glimmer-motion';
import { catalog, groups } from 'test-app/lib/catalog';
import { highlightSample } from 'test-app/lib/highlight';

const filters = ['All', ...groups] as const;
type Filter = (typeof filters)[number];

/**
 * Put the page back once the pseudo-elements are done with it.
 *
 * Only the view-transition animations count. This gallery is two dozen live
 * demos, most of them looping forever, so waiting on everything the document
 * is animating waits for something that never finishes — and the body would
 * stay out of the root capture, which is what a route change needs it for.
 */
function settle() {
  const done = () => document.documentElement.classList.remove('is-switching');
  const running = document.documentElement
    .getAnimations({ subtree: true })
    .filter((animation) =>
      String(
        (animation.effect as KeyframeEffect | null)?.pseudoElement ?? ''
      ).startsWith('::view-transition')
    )
    .map((animation) => animation.finished.catch(() => undefined));
  if (running.length === 0) {
    done();
    return;
  }
  void Promise.allSettled(running).then(done);
  // and a backstop: a skipped or interrupted transition may resolve nothing
  setTimeout(done, 900);
}

const NO_PANEL: { id: string }[] = [];
const panelKey = (item: { id: string }) => item.id;
const panelIn = { opacity: 0, y: -10 };
const panelHere = { opacity: 1, y: 0 };
const panelOut = { opacity: 0, y: -6 };
const panelSpring = {
  bounce: 0.14,
  type: 'spring',
  visualDuration: 0.34,
} as const;

const SAMPLE = `// Filtering this list IS a view transition: the browser snapshots the page,
// the state changes, and the two snapshots are animated between. Cards that
// survive the filter travel to their new seats; the rest enter and exit.
import { animateView } from 'glimmer-motion';

select = (filter) => {
  if (filter === this.filter) return;

  // .add() resolves the selector and writes a view-transition-name onto each
  // element — then takes it off again afterwards. Hand-written names are the
  // thing to get wrong: one per card and the browser snapshots two dozen live
  // demos; none at all and the only named layer left is the page itself.
  animateView(() => {
    this.filter = filter;          // the update runs inside the snapshot
  })
    .add('.card')
    .class('demo-card')            // how CSS reaches the generated layers
    .layout({ duration: 0.36, ease: [0.22, 1, 0.36, 1] })
    .enter({ opacity: [0, 1], scale: [0.97, 1] })
    .exit({ opacity: [1, 0], scale: [1, 0.97] });
};`;

export class Gallery extends Component {
  @tracked filter: Filter = 'All';
  @tracked code = false;

  get demos() {
    if (this.filter === 'All') {
      return catalog;
    }
    return catalog.filter((demo) => demo.group === this.filter);
  }

  get panel() {
    return this.code ? [{ id: 'filter-code' }] : NO_PANEL;
  }

  get sample() {
    return highlightSample(SAMPLE);
  }

  select = (filter: Filter) => {
    if (filter === this.filter) {
      return;
    }
    // The app names <body> as the root layer, hides its snapshots and paints
    // an opaque backdrop over the transition, so a route change replaces the
    // page wholesale (routes/application.ts, and the ::view-transition rules).
    // Nothing is being replaced here — only the list is changing — so this
    // class takes the body out of the capture AND takes the backdrop away,
    // leaving the cards as the only layers, over a page that stays live.
    document.documentElement.classList.add('is-switching');
    void animateView(() => {
      this.filter = filter;
    })
      .add('.card')
      .class('demo-card')
      .layout({ duration: 0.36, ease: [0.22, 1, 0.36, 1] })
      .enter({ opacity: [0, 1], scale: [0.97, 1] })
      .exit({ opacity: [1, 0], scale: [1, 0.97] })
      .then(settle, settle);
  };

  toggleCode = () => {
    this.code = !this.code;
  };

  <template>
    <section class="hero">
      {{! the repo is Choreo; the thing you install is still glimmer-motion,
          so the eyebrow is the package name and nothing else }}
      <p class="kicker">npm: glimmer-motion</p>
      <h1>Motion,<br /><em>Choreo-graphed.</em></h1>
      <p class="lede">
        The
        <a href="https://motion.dev">Motion</a>
        engine for Ember — and a timeline for the scene.
      </p>
      {{! the row is itself the demo: switching the list is a View Transition,
          and the tell sits at the end of the row until you go looking }}
      <div class="filter-row">
        <div class="filters">
          {{#each filters as |filter|}}
            <button
              type="button"
              class={{if (eq filter this.filter) "chip is-on" "chip"}}
              {{on "click" (fn this.select filter)}}
            >{{filter}}</button>
          {{/each}}
        </div>
        <button
          type="button"
          class={{if this.code "filter-tell is-on" "filter-tell"}}
          aria-expanded={{if this.code "true" "false"}}
          {{on "click" this.toggleCode}}
        >
          <span class="filter-tell-mark" aria-hidden="true">&lt;/&gt;</span>
          View transition
        </button>
      </div>

      <Presence @items={{this.panel}} @key={{panelKey}} as |_panel h|>
        <section
          class="filter-code"
          aria-label="View transition code"
          {{motion
            presence=h
            initial=panelIn
            animate=panelHere
            exit=panelOut
            transition=panelSpring
          }}
        >
          <p class="sample-label">Glimmer</p>
          <pre><code>{{this.sample}}</code></pre>
        </section>
      </Presence>
    </section>

    <div class="grid">
      {{#each this.demos as |demo|}}
        <article class="card">
          <div class="card-stage">
            {{#let demo.Example as |Example|}}
              <Example />
            {{/let}}
          </div>
          <LinkTo @route="demo" @model={{demo.id}} class="card-meta">
            <span class="card-group">{{demo.group}}</span>
            <span class="card-title">{{demo.title}}</span>
            <span class="card-lede">{{demo.lede}}</span>
          </LinkTo>
        </article>
      {{/each}}
    </div>
  </template>
}

function eq(left: Filter, right: Filter) {
  return left === right;
}
