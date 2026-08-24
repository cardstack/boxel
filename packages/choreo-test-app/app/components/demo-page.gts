import { LinkTo } from '@ember/routing';
import Component from '@glimmer/component';
import { pageTitle } from 'ember-page-title';
import { type DemoEntry, neighbors } from 'test-app/lib/catalog';
import { highlightSample } from 'test-app/lib/highlight';
import { settings } from 'test-app/lib/tempo';

const TRANSITION_SAMPLE = `// Getting here was a shared-element transition — Magic Move, in Keynote's
// terms. Three kinds of thing, and telling them apart is the whole trick.
import { animateView } from 'glimmer-motion';

animateView(async () => {
  await transition.retry();      // the route swaps INSIDE the snapshot
  window.scrollTo(0, 0);         // and so does the scroll, so the second
})                               // capture is taken where the page will sit

  // MOVES — the same object in both scenes. .add(old, new) pairs two
  // DIFFERENT elements under one name, so they become one layer that travels.
  .add(cardStageSelector, '.stage-wrap')
  .class('gm-move gm-stage')
  .crop(false)                   // cover would clip whatever changes aspect
  .group(false)                  // and nesting would clip it to the card
  .layout({ duration: 0.42 })
  .new({ opacity: [0, 1] }, { duration: 0.14 })   // solid early…
  .old({ opacity: [1, 0] }, { duration: 0.26 })   // …so the pair never dips

  // LEAVES — only in the old scene. It goes first, to make room.
  .add('.grid').exit({ opacity: [1, 0] }, { duration: 0.14 })

  // ARRIVES — only in the new scene. It waits for the move to be nearly home.
  .add('.sample').enter({ opacity: [0, 1], y: [12, 0] }, { delay: 0.26 });

/* Both renderings are then stretched into the SAME box and crossed inside it,
   because glyphs cannot morph into other glyphs, and a small stage cannot
   morph into a bigger one — but one box can hold both while it grows: */
::view-transition-old(.gm-move),
::view-transition-new(.gm-move) { width: 100%; height: 100%; object-fit: fill; }

/* And the grain steps aside for the duration. A noise field is the one thing
   on the page a compositor cannot carry — it does not scale or blend, it just
   changes — so it leaves before the morph and returns after it. */
html.is-crossing::before { opacity: 0; }`;

export class DemoPage extends Component<{
  Args: { model?: DemoEntry };
}> {
  /** opened from "How this works…" in the top bar, and nowhere else */
  get showTransition() {
    return settings.showCode;
  }

  get transitionSample() {
    return highlightSample(TRANSITION_SAMPLE);
  }

  get near() {
    return this.args.model ? neighbors(this.args.model.id) : {};
  }

  get sample() {
    return this.args.model ? highlightSample(this.args.model.sample) : '';
  }

  <template>
    {{#if @model}}
      {{pageTitle @model.title}}
      {{#if this.showTransition}}
        <section class="sample is-transition" aria-label="Transition code">
          <p class="sample-label">routes/application.ts</p>
          <pre><code>{{this.transitionSample}}</code></pre>
        </section>
      {{/if}}

      <article class="demo-head" data-demo={{@model.id}}>
        <LinkTo @route="index" class="back">All examples</LinkTo>
        <p class="kicker">{{@model.group}}</p>
        <h1>{{@model.title}}</h1>
        <p class="lede">{{@model.lede}}</p>
        <div class="apis">
          {{#each @model.apis as |api|}}
            <code class="api">{{api}}</code>
          {{/each}}
        </div>
      </article>
      <div class="stage-wrap">
        {{#let @model.Example as |Example|}}
          <Example />
        {{/let}}
      </div>
      <section class="sample" aria-label="Code">
        <p class="sample-label">Glimmer</p>
        <pre><code>{{this.sample}}</code></pre>
      </section>
      <nav class="pager">
        {{#if this.near.prev}}
          <LinkTo @route="demo" @model={{this.near.prev.id}}>
            ←
            {{this.near.prev.title}}
          </LinkTo>
        {{else}}
          <span></span>
        {{/if}}
        {{#if this.near.next}}
          <LinkTo @route="demo" @model={{this.near.next.id}}>
            {{this.near.next.title}}
            →
          </LinkTo>
        {{/if}}
      </nav>
    {{/if}}
  </template>
}
