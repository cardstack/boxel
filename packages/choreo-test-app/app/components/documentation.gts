import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { pageTitle } from 'ember-page-title';
import { motion } from 'glimmer-motion';
import { Marked } from 'marked';
import { GuideDemo } from 'test-app/components/guide-demo';
import { RecordableScene } from 'test-app/components/tutorials/recordable-scene';
import { SpatialCard } from 'test-app/components/tutorials/spatial-card';
import { TaskBoard } from 'test-app/components/tutorials/task-board';
import { type Guide, guides, guideSections } from 'test-app/lib/guides';
import { highlightSample } from 'test-app/lib/highlight';

interface Signature {
  Args: { guide?: Guide; isTopic?: boolean };
}
const tutorial = (slug: string) =>
  ({
    'core-first-app': TaskBoard,
    'spatial-first-scene': SpatialCard,
    'film-first-export': RecordableScene,
  })[slug as 'core-first-app'];
const escape = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const headingId = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export class Documentation extends Component<Signature> {
  @service declare router: RouterService;
  @tracked query = '';
  @tracked menuOpen = false;

  get sections() {
    const query = this.query.trim().toLowerCase();
    return guideSections.map((section) => ({
      ...section,
      open:
        Boolean(query) || section.id === (this.args.guide?.section ?? 'core'),
      pages: guides.filter(
        (guide) =>
          guide.section === section.id &&
          (!query ||
            `${guide.title} ${guide.summary} ${guide.source}`
              .toLowerCase()
              .includes(query))
      ),
    }));
  }
  get resultCount() {
    return this.sections.reduce(
      (count, section) => count + section.pages.length,
      0
    );
  }
  get currentSection() {
    return guideSections.find(
      (section) => section.id === this.args.guide?.section
    );
  }
  get previous() {
    return guides[
      guides.findIndex((guide) => guide.slug === this.args.guide?.slug) - 1
    ];
  }
  get next() {
    return guides[
      guides.findIndex((guide) => guide.slug === this.args.guide?.slug) + 1
    ];
  }
  get headings() {
    return [...(this.args.guide?.source ?? '').matchAll(/^## (.+)$/gm)].map(
      (match) => ({ title: match[1]!, id: headingId(match[1]!) })
    );
  }
  get editURL() {
    return `https://github.com/cardstack/choreo/blob/main/test-app/app/content/guides/${this.args.guide?.slug}.md`;
  }
  get openingEnd() {
    const source = this.args.guide?.source ?? '';
    const goals = source.indexOf('\n## Learning Goals');
    const end =
      goals >= 0 ? source.indexOf('\n## ', goals + 1) : source.search(/^## /m);
    return end < 0 ? source.length : end;
  }
  get preamble() {
    return this.renderMarkdown(
      (this.args.guide?.source ?? '').slice(0, this.openingEnd)
    );
  }
  get body() {
    return this.renderMarkdown(
      (this.args.guide?.source ?? '').slice(this.openingEnd)
    );
  }
  private renderMarkdown(source: string) {
    const urlFor = (href: string) => {
      if (href.startsWith('/docs/')) {
        return this.router.urlFor('docs.topic', href.slice(6));
      }
      if (href === '/_widgets') {
        return this.router.urlFor('widget-room');
      }
      if (href === '/towers' || href === '/sagrada') {
        return this.router.urlFor(href.slice(1));
      }
      if (href.startsWith('/') && !href.startsWith('//')) {
        return this.router.urlFor('demo', href.slice(1));
      }
      return /^(https:\/\/|#)/.test(href) ? href : '#';
    };
    const parser = new Marked({
      renderer: {
        html({ text }) {
          return escape(text);
        },
        heading({ depth, text }) {
          if (depth === 1) {
            return '';
          }
          return `<h${depth} id="${headingId(text)}" tabindex="-1">${escape(text)}</h${depth}>`;
        },
        code({ text, lang }) {
          const title =
            lang?.match(/title="([^"]+)"/)?.[1] ??
            lang?.split(' ')[0] ??
            'Example';
          return `<figure class="guide-code"><figcaption>${escape(title)}</figcaption><pre tabindex="0"><code>${highlightSample(text).toString()}</code></pre></figure>`;
        },
        link({ href, tokens }) {
          return `<a href="${escape(urlFor(href))}">${this.parser.parseInline(tokens)}</a>`;
        },
      },
    });
    // Only repository-authored Markdown is rendered; raw HTML is escaped above.
    return htmlSafe(parser.parse(source, { async: false }));
  }
  search = (event: Event) => {
    this.query = (event.target as HTMLInputElement).value;
  };
  closeMenu = (event: Event) => {
    if ((event.target as Element).closest('a')) {
      this.menuOpen = false;
    }
  };
  toggleMenu = () => {
    this.menuOpen = !this.menuOpen;
  };
  jump = (id: string) => {
    const heading = document.getElementById(id);
    heading?.scrollIntoView({ block: 'start' });
    heading?.focus({ preventScroll: true });
  };
  arrive = modifier((_element: HTMLElement, [_slug]: [string | undefined]) => {
    // Runs on guide changes, not on search input; keyboard focus follows navigation.
    window.scrollTo({ top: 0 });
    if (_slug) {
      document.getElementById('guide-title')?.focus({ preventScroll: true });
    }
  });

  <template>
    {{pageTitle (if @guide @guide.title "Guides")}}
    <div
      class="documentation"
      data-test-documentation
      {{this.arrive @guide.slug}}
    >
      <button
        type="button"
        class="guide-menu-toggle"
        aria-expanded={{this.menuOpen}}
        aria-controls="guide-sidebar"
        {{on "click" this.toggleMenu}}
      >Browse the guides <span aria-hidden="true">☰</span></button>
      <aside
        id="guide-sidebar"
        aria-label="Guides"
        class="guide-sidebar {{if this.menuOpen 'is-open'}}"
      >
        <LinkTo @route="docs.index" class="guide-home">Choreo Guides
          <span>↗</span></LinkTo>
        <label class="guide-search"><span>Search the guides</span><input
            type="search"
            placeholder="Find a concept…"
            value={{this.query}}
            {{on "input" this.search}}
          /></label>
        {{#if this.query}}<p
            class="guide-results"
            role="status"
          >{{this.resultCount}} guides found</p>{{/if}}
        <LinkTo
          @route="docs.topic"
          @model="core-api-inventory"
          class="guide-inventory-link"
        >API &amp; concept inventory ↗</LinkTo>
        {{! a click on any link in the sections closes the phone menu; the links
            themselves are the interactive elements }}
        <nav
          {{! template-lint-disable no-invalid-interactive }}
          aria-label="Guide sections"
          {{on "click" this.closeMenu}}
        >
          {{#each this.sections as |section|}}
            {{#if section.pages.length}}
              <details class="guide-nav-section" open={{section.open}}>
                <summary><span>{{section.number}}</span>
                  {{section.title}}</summary>
                {{#each section.pages as |guide|}}<LinkTo
                    @route="docs.topic"
                    @model={{guide.slug}}
                  >{{guide.title}}</LinkTo>{{/each}}
              </details>
            {{/if}}
          {{/each}}
        </nav>
        <div class="guide-sidebar-foot"><LinkTo @route="widget-room">Explore the
            3D gallery ↗</LinkTo><a
            href="https://github.com/cardstack/choreo/tree/main/.claude/skills/choreo-create"
          >Build with an agent ↗</a></div>
      </aside>
      <div class="guide-main">
        {{#if @guide}}
          {{#each (array @guide) key="slug" as |page|}}
            <article
              class="guide-article"
              {{motion id=page.slug role="guide-page"}}
            >
              <div class="guide-eyebrow">{{this.currentSection.number}}
                /
                {{this.currentSection.title}}</div>
              <h1 id="guide-title" tabindex="-1">{{@guide.title}}</h1>
              <p class="guide-deck">{{@guide.summary}}</p>
              <div class="guide-prose guide-preamble">{{this.preamble}}</div>
              {{#let (tutorial @guide.slug) as |Study|}}{{#if Study}}<Study
                  />{{/if}}{{/let}}
              {{#if @guide.demo}}
                {{#each (array @guide) key="slug" as |page|}}{{#if
                    page.demo
                  }}<GuideDemo @demo={{page.demo}} />{{/if}}{{/each}}
              {{/if}}
              <div class="guide-prose">{{this.body}}</div>
              <nav class="guide-pagination" aria-label="Continue reading">
                {{#if this.previous}}<LinkTo
                    @route="docs.topic"
                    @model={{this.previous.slug}}
                  ><span>← Previous</span>{{this.previous.title}}</LinkTo>{{else}}<span
                  ></span>{{/if}}
                {{#if this.next}}<LinkTo
                    @route="docs.topic"
                    @model={{this.next.slug}}
                  ><span>Next →</span>{{this.next.title}}</LinkTo>{{/if}}
              </nav>
              <a class="guide-source" href={{this.editURL}}>View this guide’s
                source ↗</a>
            </article>
          {{/each}}
        {{else if @isTopic}}
          <article class="guide-article"><p class="guide-eyebrow">Choreo Guides</p><h1
            >Guide not found</h1><p>This guide may have moved. Choose a topic
              from the sidebar or return to the guide overview.</p><LinkTo
              @route="docs.index"
            >Browse all guides →</LinkTo></article>
        {{else}}
          <article class="guide-overview">
            <p class="guide-eyebrow">THE CHOREO GUIDES</p>
            <h1>Make interfaces move.<br /><em>Give motion meaning.</em></h1>
            <p class="guide-intro">Start with one element. Coordinate an
              interaction. Bring it into space. Then direct a film. Explore four
              connected areas of the same motion system, with real demos you can
              tune. Explore 76 guides covering the public API and the concepts
              behind it.</p>
            <div class="guide-overview-actions"><LinkTo
                @route="docs.topic"
                @model="core-start"
                class="guide-primary"
              >Start learning <span>→</span></LinkTo><LinkTo
                @route="widget-room"
              >Take the 3D tour ↗</LinkTo></div>
            <div class="guide-paths">
              {{#each guideSections as |section|}}
                <LinkTo
                  @route="docs.topic"
                  @model={{section.start}}
                  class="guide-path"
                >
                  <div class="guide-path-top"><span
                    >{{section.number}}</span><span
                      aria-hidden="true"
                    >↗</span></div>
                  <div
                    class="guide-path-diagram is-{{section.id}}"
                    aria-hidden="true"
                  ><i></i><i></i><i></i><b></b></div>
                  <h2>{{section.title}}</h2><p>{{section.summary}}</p><small
                  >{{section.tags}}</small>
                </LinkTo>
              {{/each}}
            </div>
            <section class="guide-learning-note"><span
                class="guide-eyebrow"
              >LEARN BY CHANGING THINGS</span><h2>The examples are the
                application.</h2><p>Open a live demo in a guide, adjust its
                controls, and watch what changes. Follow the code back to the
                component, then combine the patterns in your own project.</p><LinkTo
                @route="index"
              >Browse every demo →</LinkTo></section>
          </article>
        {{/if}}
      </div>
      {{#if @guide}}
        <aside class="guide-toc" aria-label="On this page"><p>On this page</p>{{#each
            this.headings
            as |heading|
          }}<button
              type="button"
              {{on "click" (fn this.jump heading.id)}}
            >{{heading.title}}</button>{{/each}}<div class="guide-toc-note">Read
            it.<br />Try it.<br /><em>Make it yours.</em></div></aside>
      {{/if}}
    </div>
  </template>
}
