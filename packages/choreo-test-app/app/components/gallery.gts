import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { catalog, groups } from 'test-app/lib/catalog';

const filters = ['All', ...groups] as const;
type Filter = (typeof filters)[number];

export class Gallery extends Component {
  @tracked filter: Filter = 'All';

  get demos() {
    if (this.filter === 'All') {
      return catalog;
    }
    return catalog.filter((demo) => demo.group === this.filter);
  }

  select = (filter: Filter) => {
    this.filter = filter;
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
      <div class="filters">
        {{#each filters as |filter|}}
          <button
            type="button"
            class={{if (eq filter this.filter) "chip is-on" "chip"}}
            {{on "click" (fn this.select filter)}}
          >{{filter}}</button>
        {{/each}}
      </div>
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
