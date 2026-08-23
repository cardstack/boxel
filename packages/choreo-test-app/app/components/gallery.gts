import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { LayoutGroup, motion, Presence } from 'glimmer-motion';
import { catalog, groups } from 'test-app/lib/catalog';
import { highlightSample } from 'test-app/lib/highlight';

const filters = ['All', ...groups] as const;
type Filter = (typeof filters)[number];

const NO_PANEL: { id: string }[] = [];
const demoKey = (demo: { id: string }) => demo.id;

/** a card that was not in the old list arrives; one that survives just moves */
const cardIn = { opacity: 0, scale: 0.96 };
const cardHere = { opacity: 1, scale: 1 };
const cardOut = { opacity: 0, scale: 0.96 };
const cardSpring = {
  bounce: 0.12,
  type: 'spring',
  visualDuration: 0.42,
} as const;
const panelKey = (item: { id: string }) => item.id;
const panelIn = { opacity: 0, y: -10 };
const panelHere = { opacity: 1, y: 0 };
const panelOut = { opacity: 0, y: -6 };
const panelSpring = {
  bounce: 0.14,
  type: 'spring',
  visualDuration: 0.34,
} as const;

const SAMPLE = `{{! Filtering this list is a layout animation, not a page transition.

    A View Transition would be the obvious reach — and the wrong one here.
    It works by snapshotting the page into bitmaps and crossfading them, and
    every card in this grid is a live demo: two dozen running animations would
    freeze into images for the length of the switch, the fixed grain overlay
    would be captured into the snapshot AND painted live over the top of it,
    and the page's own root layer would blank out underneath.

    layout=true moves the real elements. The demos keep running while their
    cards fly to new seats. }}
<LayoutGroup>
  <div class='grid'>
    <Presence
      @items={{this.demos}}
      @key={{demoKey}}
      @mode='sync'           {{! popLayout is the one to want here, and the
                                 one that cannot be used yet: see open-bugs }}
      {{! no initial=false here: the presence context is inherited, so
          blocking the first entrance would block it for every motion node
          inside every card as well }}
      as |demo h|
    >
      <article
        class='card'
        {{motion
          presence=h
          layout=true        {{! measure before, measure after, animate the difference }}
          initial=cardIn
          animate=cardHere
          exit=cardOut
          transition=cardSpring
        }}
      >…</article>
    </Presence>
  </div>
</LayoutGroup>

// and the filter itself is just state
select = (filter) => {
  this.filter = filter;
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
    this.filter = filter;
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
          How this filters
        </button>
      </div>

      <Presence @items={{this.panel}} @key={{panelKey}} as |_panel h|>
        <section
          class="filter-code"
          aria-label="Filter code"
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

    {{! The filter is this library's own job, not the browser's. Every card is
        a live demo; a View Transition would snapshot all of them into bitmaps
        and crossfade the result. layout=true moves the real elements instead,
        so the demos keep running the whole way across. }}
    <LayoutGroup>
      <div class="grid">
        <Presence
          @items={{this.demos}}
          @key={{demoKey}}
          {{! sync, not popLayout: a popLayout leaver here never reports its
              exit complete, so the card stays in the DOM at opacity 0 and
              coming back leaves it stuck there. See docs/open-bugs.md. }}
          {{! No initial=false handle here, however tempting: the presence
              context is INHERITED, so blocking the first entrance blocks it
              for every motion node inside every demo as well — the pour log
              arrives already scrolled, and a looping keyframe animation is
              seeded at its last frame instead of running. The cards fading in
              once on load is the cheaper price. }}
          as |demo h|
        >
          <article
            class="card"
            {{motion
              presence=h
              layout=true
              initial=cardIn
              animate=cardHere
              exit=cardOut
              transition=cardSpring
            }}
          >
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
        </Presence>
      </div>
    </LayoutGroup>
  </template>
}

function eq(left: Filter, right: Filter) {
  return left === right;
}
