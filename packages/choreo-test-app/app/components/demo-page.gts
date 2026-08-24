import { LinkTo } from '@ember/routing';
import Component from '@glimmer/component';
import { pageTitle } from 'ember-page-title';
import { type DemoEntry, neighbors } from 'test-app/lib/catalog';
import { highlightSample } from 'test-app/lib/highlight';

export class DemoPage extends Component<{
  Args: { model?: DemoEntry };
}> {
  get near() {
    return this.args.model ? neighbors(this.args.model.id) : {};
  }

  get sample() {
    return this.args.model ? highlightSample(this.args.model.sample) : '';
  }

  <template>
    {{#if @model}}
      {{pageTitle @model.title}}
      {{! "How this works" is chrome, not page: it lives beside the control
          that opens it, so a route change cannot reveal or take it away }}
      <article class="demo-head" data-demo={{@model.id}}>
        {{! the pager is at the foot of the page, past the code — which is a
            long way to scroll to say "next". The same link, where you are
            already looking. }}
        <div class="demo-nav">
          <LinkTo @route="index" class="back">All examples</LinkTo>
          {{#if this.near.next}}
            <LinkTo
              @route="demo"
              @model={{this.near.next.id}}
              class="back next-demo"
            >
              Next
              <b>{{this.near.next.title}}</b>
              →
            </LinkTo>
          {{/if}}
        </div>
        <p class="kicker">
          {{@model.group}}
          {{#if @model.notes}}
            <span class="kicker-badge">Deep Dive</span>
          {{/if}}
        </p>
        <h1>{{@model.title}}</h1>
        <p class="lede">{{@model.lede}}</p>
        <div class="apis">
          {{#each @model.apis as |api|}}
            <code class="api">{{api}}</code>
          {{/each}}
        </div>
      </article>
      {{! The arrows are SIBLINGS of the stage, not children of it.

          `.stage-wrap` is one half of the shared element that flies out of
          the gallery card, so whatever is inside it travels inside that
          snapshot. Chrome for stepping through demos is not part of the demo:
          it stays where it is, in the page's own layer, and only sits over
          the stage's edges. }}
      <div class="stage-row">
        <div class="stage-wrap">
          {{#let @model.Example as |Example|}}
            <Example />
          {{/let}}
        </div>
      </div>
      <section class="sample" aria-label="Code">
        <p class="sample-label">Glimmer</p>
        <pre><code>{{this.sample}}</code></pre>
      </section>
      {{! How to use it, then how it works — in that order, because nobody
          needs the second one to get started. Most demos are one idea and the
          sample says it; the ones that are not bring their own long half. }}
      {{#if @model.notes}}
        {{#let @model.notes as |Notes|}}
          <Notes />
        {{/let}}
      {{/if}}
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
