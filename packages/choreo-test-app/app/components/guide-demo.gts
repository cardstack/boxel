import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import lessons from 'test-app/content/demo-lessons.json';
import { findDemo } from 'test-app/lib/catalog';
import type { Guide } from 'test-app/lib/guides';

interface Signature {
  Args: { demo: NonNullable<Guide['demo']> };
}
export class GuideDemo extends Component<Signature> {
  @service declare router: RouterService;
  @tracked active = true;
  get lesson() {
    return lessons.find((lesson) => lesson.id === this.args.demo.id);
  }
  get example() {
    return findDemo(this.args.demo.id);
  }
  get url() {
    return this.router.urlFor('demo-lab', this.args.demo.id, {
      queryParams: { embedded: true },
    });
  }
  toggle = () => {
    this.active = !this.active;
  };
  <template>
    <section class="guide-demo" aria-label={{@demo.title}}>
      <header><span class="guide-eyebrow">LIVE EXAMPLE</span><button
          type="button"
          {{on "click" this.toggle}}
        >{{if this.active "Close example" "Load example"}}
          {{if this.active "×" "↗"}}</button></header>
      {{#if this.active}}<iframe
          src={{this.url}}
          title={{@demo.title}}
          class="guide-demo-frame"
          allow="autoplay; fullscreen"
        ></iframe>{{else}}<button
          type="button"
          class="guide-demo-launch"
          {{on "click" this.toggle}}
        ><span class="guide-demo-play" aria-hidden="true">▶</span><strong
          >{{@demo.title}}</strong><span>Open the real demo with live controls</span></button>{{/if}}
      <p>{{@demo.instruction}}
        <LinkTo @route="demo-lab" @model={{@demo.id}}>Open the playground ↗</LinkTo></p>
      {{#if this.lesson}}{{#let this.lesson as |lesson|}}
          <div class="guide-prose demo-lesson" data-demo-lesson={{lesson.id}}>
            <h3>{{lesson.concept}}</h3>
            <p>{{lesson.why}}</p>
            <p><strong>Try it.</strong> {{lesson.experiment}}</p>
            <p><strong>Watch out.</strong> {{lesson.pitfall}}</p>
            <p><strong>Build on it.</strong> {{lesson.combine}}</p>
            <p><strong>APIs in this example:</strong>
              {{#each this.example.apis as |api|}} <code>{{api}}</code>{{/each}}
            </p>
            <details><summary>Example code</summary><pre><code
                >{{this.example.sample}}</code></pre></details>
            <LinkTo @route="docs.topic" @model={{lesson.guide}}>Read the concept
              guide →</LinkTo>
          </div>
        {{/let}}{{/if}}
    </section>
  </template>
}
