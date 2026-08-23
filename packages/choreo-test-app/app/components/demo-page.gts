import { LinkTo } from '@ember/routing';
import Component from '@glimmer/component';
import { pageTitle } from 'ember-page-title';
import { SpeedPicker } from 'test-app/components/speed-picker';
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
      <article class="demo-head">
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
      {{#if @model.slowmo}}
        <SpeedPicker />
      {{/if}}
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
