// Pretui — the showcase docs view: a sidebar of every component by category,
// and the selected component's Spec page loaded in place on demand.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import { htmlSafe } from '@ember/template';
import { guidFor } from '@ember/object/internals';
import { getComponent } from '@cardstack/base/card-api';
import type { CardDef } from '@cardstack/base/card-api';
import { SearchInput } from './components/search-input';
import {
  CATEGORIES,
  categoryNamed,
  sameSpec,
  type ShowcaseCategory,
} from './showcase-data';
import { specName, type SpecCatalog, type SpecLike } from './showcase-chrome';

// brings the page head back into view when the reader moves to another
// component from the pager at the bottom
const toTop = modifier((element: HTMLElement, [_id]: [string | undefined]) => {
  if (element.getBoundingClientRect().top < 0) {
    element.scrollIntoView({ block: 'start' });
  }
});

/** One component's Spec page, loaded when it is selected. */
class SpecPane extends Component<{
  Args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context?: any;
    id: string;
    spec?: SpecLike;
  };
  Blocks: { default: [] };
}> {
  resource = this.args.context?.getCard?.(this, () => this.args.id);
  get card(): CardDef | undefined {
    let card = this.resource?.card as CardDef | undefined;
    // the resource can still hold the last component while the next one loads
    return card && sameSpec(card.id, this.args.id) ? card : undefined;
  }
  get failed(): boolean {
    return Boolean(this.resource?.cardError);
  }
  <template>
    {{#if this.card}}
      <div class='docs-spec-page'>
        {{#let (getComponent this.card) as |SpecPage|}}
          <SpecPage @format='isolated' />
        {{/let}}
      </div>
      {{yield}}
    {{else if this.failed}}
      <p class='docs-note'>This component's page could not be loaded.</p>
    {{else}}
      <div class='docs-skeleton' aria-busy='true' aria-live='polite'>
        <h1 class='docs-skel-title'>
          <span class='docs-skel-frame' aria-hidden='true'></span>
          <span>{{if @spec (specName @spec) 'Loading…'}}</span>
        </h1>
        <div class='docs-skel-stage'>
          <span class='docs-skel-block'></span>
          <span class='docs-skel-side'></span>
        </div>
        <span class='docs-skel-line'></span>
        <span class='docs-skel-line short'></span>
      </div>
    {{/if}}
    <style scoped>
      /* the docs draw their own crumb and colour scheme switch */
      .docs-spec-page :deep(.wb-topbar) {
        display: none;
      }
      /* the docs page is the frame; the card needs no boundary of its own */
      .docs-spec-page :deep(.boxel-card-container--boundaries) {
        border-radius: 0;
        box-shadow: none;
      }
      /* mirrors the Spec page's gutter and title, so the swap doesn't jump */
      .docs-skeleton {
        display: grid;
        gap: var(--boxel-sp, 1rem);
        padding: 0 var(--boxel-sp-lg, 1.333rem) 3rem;
        animation: docs-skel-in 0.2s ease both;
      }
      .docs-skel-title {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs, 0.5rem);
        margin: var(--boxel-sp-2xs, 0.375rem) 0
          calc(-1 * var(--boxel-sp-3xs, 0.25rem));
        font-family: var(--font-serif);
        font-size: var(--boxel-font-size-xl, 2rem);
        font-weight: 700;
        letter-spacing: var(--boxel-lsp-xs);
        line-height: 1.1;
        color: var(--foreground);
      }
      .docs-skel-frame {
        width: 3rem;
        height: 3rem;
        flex: none;
        border-radius: var(--boxel-border-radius-sm, 0.375rem);
        box-shadow: inset 0 0 0 1px var(--border);
        background: var(--background);
      }
      .docs-skel-stage {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
        gap: 1rem;
        margin: 0;
      }
      .docs-skel-block,
      .docs-skel-side,
      .docs-skel-line {
        display: block;
        border-radius: var(--radius, 0.5rem);
        background:
          linear-gradient(
              90deg,
              transparent,
              color-mix(in oklab, var(--foreground) 6%, transparent),
              transparent
            )
            0 0 / 200% 100%,
          var(--muted);
        animation: docs-shimmer 1.4s linear infinite;
      }
      .docs-skel-block {
        height: 18rem;
      }
      .docs-skel-side {
        height: 12rem;
      }
      .docs-skel-line {
        height: 0.75rem;
        width: 70%;
      }
      .docs-skel-line.short {
        width: 40%;
      }
      @keyframes docs-shimmer {
        to {
          background-position:
            -200% 0,
            0 0;
        }
      }
      @keyframes docs-skel-in {
        from {
          opacity: 0;
        }
      }
      .docs-note {
        padding: 4rem 2rem;
        text-align: center;
        color: var(--muted-foreground);
      }
      @media (prefers-reduced-motion: reduce) {
        .docs-skeleton,
        .docs-skel-block,
        .docs-skel-side,
        .docs-skel-line {
          animation: none;
        }
      }
    </style>
  </template>
}

interface DocsSignature {
  Args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context?: any;
    specs: SpecCatalog;
    /** the category the view opens on; absent opens the whole kit */
    category?: string;
    /** a Spec id to open straight away */
    selectedId?: string;
    onSelect: (id: string | undefined, category?: string) => void;
    onCategory: (category: string | undefined) => void;
  };
  Element: HTMLElement;
}

export class DocsView extends Component<DocsSignature> {
  searchId = `${guidFor(this)}-search`;
  @tracked search = '';
  @tracked opened = new Set<string>(
    this.args.category ? [this.args.category] : [],
  );

  categories = CATEGORIES;

  get active(): ShowcaseCategory | undefined {
    return categoryNamed(this.args.category);
  }
  get searching(): boolean {
    return this.search.trim().length > 0;
  }
  get matches(): SpecLike[] {
    return this.args.specs.search(this.search);
  }

  get selectedSpec(): SpecLike | undefined {
    let id = this.args.selectedId;
    return id ? this.args.specs.all.find((s) => sameSpec(s.id, id)) : undefined;
  }

  ghosts = Array.from({ length: 6 });
  initials = (spec: SpecLike) => {
    let caps = specName(spec).match(/[A-Z0-9]/g) ?? [];
    return (
      caps.slice(0, 2).join('') || specName(spec).slice(0, 2)
    ).toUpperCase();
  };
  monoHue = (spec: SpecLike) => {
    let name = specName(spec);
    let hue = 0;
    for (let i = 0; i < name.length; i++) {
      hue = (hue * 31 + name.charCodeAt(i)) % 360;
    }
    return htmlSafe(`--mono-hue: ${hue}`);
  };

  isOpen = (name: string) => this.opened.has(name) || this.searching;
  isSelected = (spec: SpecLike) => sameSpec(spec.id, this.args.selectedId);
  isActiveCategory = (name?: string) =>
    !this.args.selectedId && this.active?.name === name;
  nameOf = specName;

  toggle = (name: string) => {
    let next = new Set(this.opened);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    this.opened = next;
  };
  openCategory = (name: string | undefined) => {
    if (name && !this.opened.has(name)) {
      this.opened = new Set([...this.opened, name]);
    }
    this.args.onCategory(name);
  };
  select = (spec: SpecLike) => {
    if (spec.category && !this.opened.has(spec.category)) {
      this.opened = new Set([...this.opened, spec.category]);
    }
    this.args.onSelect(spec.id, spec.category);
  };
  setSearch = (value: string) => (this.search = value);

  // previous and next within the selected component's category
  neighbours = (specs: SpecLike[]) => {
    let i = specs.findIndex((s) => sameSpec(s.id, this.args.selectedId));
    return {
      prev: i > 0 ? specs[i - 1] : undefined,
      next: i >= 0 && i < specs.length - 1 ? specs[i + 1] : undefined,
    };
  };

  <template>
    <div class='docs' ...attributes>
      <nav class='docs-side' aria-label='Components'>
        <div class='docs-search'>
          <label class='docs-sr' for={{this.searchId}}>Search components</label>
          <SearchInput
            @controlId={{this.searchId}}
            @value={{this.search}}
            @placeholder='Search components…'
            @onInput={{this.setSearch}}
          />
        </div>

        {{#if this.searching}}
          <ul class='docs-items flat'>
            {{#each this.matches key='id' as |spec|}}
              <li><button
                  type='button'
                  class='docs-item'
                  aria-current={{if (this.isSelected spec) 'page'}}
                  {{on 'click' (fn this.select spec)}}
                >
                  <span>{{this.nameOf spec}}</span>
                  <span class='docs-item-cat'>{{spec.category}}</span>
                </button></li>
            {{else}}
              <li class='docs-none'>{{if
                  @specs.loading
                  'Searching…'
                  'No component matches.'
                }}</li>
            {{/each}}
          </ul>
        {{else}}
          <button
            type='button'
            class='docs-group-head docs-all'
            aria-current={{if (this.isActiveCategory undefined) 'page'}}
            {{on 'click' (fn this.openCategory undefined)}}
          >
            <span>Overview</span>
            <span class='docs-n'>{{@specs.total}}</span>
          </button>
          {{#each this.categories as |category|}}
            <div class='docs-group'>
              <button
                type='button'
                class='docs-group-head'
                aria-expanded={{if (this.isOpen category.name) 'true' 'false'}}
                {{on 'click' (fn this.toggle category.name)}}
              >
                <span class='docs-chev' aria-hidden='true'>›</span>
                <span class='docs-group-name'>{{category.name}}</span>
                <span class='docs-n'>{{@specs.count category.name}}</span>
              </button>
              {{#if (this.isOpen category.name)}}
                <ul class='docs-items'>
                  <li><button
                      type='button'
                      class='docs-item docs-item-intro'
                      aria-current={{if
                        (this.isActiveCategory category.name)
                        'page'
                      }}
                      {{on 'click' (fn this.openCategory category.name)}}
                    >About {{category.name}}</button></li>
                  {{#each (@specs.inCategory category.name) key='id' as |spec|}}
                    <li><button
                        type='button'
                        class='docs-item'
                        aria-current={{if (this.isSelected spec) 'page'}}
                        {{on 'click' (fn this.select spec)}}
                      >{{this.nameOf spec}}</button></li>
                  {{else}}
                    {{#if @specs.loading}}
                      <li class='docs-none'>Loading…</li>
                    {{/if}}
                  {{/each}}
                </ul>
              {{/if}}
            </div>
          {{/each}}
        {{/if}}
      </nav>

      <main class='docs-main'>
        {{#if @selectedId}}
          <div class='docs-spec' {{toTop @selectedId}}>
            <div class='docs-spec-head'>
              <nav aria-label='Breadcrumb'>
                <ol class='docs-crumb'>
                  <li><button
                      type='button'
                      class='docs-crumb-link'
                      {{on 'click' (fn this.openCategory undefined)}}
                    >Components</button></li>
                  {{#if this.active}}
                    <li><button
                        type='button'
                        class='docs-crumb-link'
                        {{on 'click' (fn this.openCategory this.active.name)}}
                      >{{this.active.name}}</button></li>
                  {{/if}}
                  <li class='docs-crumb-here' aria-current='page'>{{if
                      this.selectedSpec
                      (this.nameOf this.selectedSpec)
                      'Component'
                    }}</li>
                </ol>
              </nav>
            </div>
            <SpecPane
              @context={{@context}}
              @id={{@selectedId}}
              @spec={{this.selectedSpec}}
            >
              {{#if this.active}}
                {{#let
                  (this.neighbours (@specs.inCategory this.active.name))
                  as |n|
                }}
                  <div class='docs-pager'>
                    {{#if n.prev}}
                      <button
                        type='button'
                        class='docs-page prev'
                        {{on 'click' (fn this.select n.prev)}}
                      >
                        <span
                          class='docs-page-arrow'
                          aria-hidden='true'
                        >←</span>
                        <span class='docs-page-text'>
                          <small>Previous</small>
                          <span class='docs-page-name'>{{this.nameOf
                              n.prev
                            }}</span>
                        </span>
                      </button>
                    {{/if}}
                    {{#if n.next}}
                      <button
                        type='button'
                        class='docs-page next'
                        {{on 'click' (fn this.select n.next)}}
                      >
                        <span class='docs-page-text'>
                          <small>Next</small>
                          <span class='docs-page-name'>{{this.nameOf
                              n.next
                            }}</span>
                        </span>
                        <span
                          class='docs-page-arrow'
                          aria-hidden='true'
                        >→</span>
                      </button>
                    {{/if}}
                  </div>
                {{/let}}
              {{/if}}
            </SpecPane>
          </div>
        {{else if this.active}}
          <div class='docs-landing'>
            <header class='docs-cat-head'>
              <span class='docs-eyebrow'>Category</span>
              <h1>{{this.active.name}}</h1>
              <p class='docs-lede'>{{this.active.blurb}}</p>
            </header>
            <ul class='docs-grid'>
              {{#each (@specs.inCategory this.active.name) key='id' as |spec|}}
                <li><button
                    type='button'
                    class='docs-comp'
                    {{on 'click' (fn this.select spec)}}
                  >
                    <span class='docs-comp-top'>
                      <span
                        class='docs-mono'
                        style={{this.monoHue spec}}
                        aria-hidden='true'
                      >{{this.initials spec}}</span>
                    </span>
                    <span class='docs-comp-name'>{{this.nameOf spec}}</span>
                    <span class='docs-comp-brief'>{{spec.brief}}</span>
                  </button></li>
              {{else}}
                {{#if @specs.loading}}
                  {{#each this.ghosts}}
                    <li class='docs-comp ghost' aria-hidden='true'></li>
                  {{/each}}
                {{/if}}
              {{/each}}
            </ul>
          </div>
        {{else}}
          <div class='docs-landing'>
            <header class='docs-cat-head'>
              <h1>Components</h1>
              <p class='docs-lede'>Every Pret UI component, by category. Pick
                one to see it live, with its arguments, examples and code.</p>
            </header>
            <ul class='docs-cats'>
              {{#each this.categories as |category|}}
                <li><button
                    type='button'
                    class='docs-catcard'
                    {{on 'click' (fn this.openCategory category.name)}}
                  >
                    <span class='docs-catcard-head'>
                      <span class='docs-comp-name'>{{category.name}}</span>
                      <span class='docs-n'>{{@specs.count category.name}}</span>
                    </span>
                    <span class='docs-comp-brief'>{{category.blurb}}</span>
                  </button></li>
              {{/each}}
            </ul>
          </div>
        {{/if}}
      </main>
    </div>
    <style scoped>
      .docs {
        display: grid;
        grid-template-columns: 16rem minmax(0, 1fr);
        align-items: start;
        min-height: 100%;
      }
      .docs-side {
        position: sticky;
        top: 3.5rem;
        display: grid;
        align-content: start;
        gap: 0.125rem;
        max-height: calc(100vh - 3.5rem);
        overflow-y: auto;
        padding: 1rem 0.75rem 2rem;
        border-right: 1px solid var(--border);
      }
      .docs-search {
        margin-bottom: 0.75rem;
      }
      .docs-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      .docs-group-head {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        width: 100%;
        padding: 0.375rem 0.5rem;
        border: 0;
        border-radius: var(--radius, 0.375rem);
        background: transparent;
        color: var(--foreground);
        font: inherit;
        font-size: 0.8125rem;
        font-weight: 600;
        text-align: left;
        cursor: pointer;
      }
      .docs-group-head:hover {
        background: var(--muted);
      }
      .docs-all[aria-current='page'] {
        background: color-mix(in oklab, var(--primary) 12%, transparent);
      }
      .docs-group-name {
        flex: 1;
      }
      .docs-chev {
        display: inline-block;
        width: 0.75rem;
        color: var(--muted-foreground);
        transition: transform 0.15s ease;
      }
      .docs-group-head[aria-expanded='true'] .docs-chev {
        transform: rotate(90deg);
      }
      .docs-n {
        font-size: 0.6875rem;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
      }
      .docs-items {
        list-style: none;
        margin: 0 0 0.375rem;
        padding: 0 0 0 1.125rem;
        display: grid;
      }
      .docs-items.flat {
        padding: 0;
      }
      .docs-item {
        display: flex;
        justify-content: space-between;
        gap: 0.5rem;
        width: 100%;
        padding: 0.3125rem 0.625rem;
        border: 0;
        border-left: 1px solid var(--border);
        background: transparent;
        color: var(--muted-foreground);
        font: inherit;
        font-size: 0.8125rem;
        text-align: left;
        cursor: pointer;
      }
      .docs-items.flat .docs-item {
        border-left: 0;
        border-radius: var(--radius, 0.375rem);
      }
      .docs-item:hover {
        color: var(--foreground);
        border-left-color: var(--foreground);
      }
      .docs-item[aria-current='page'] {
        color: var(--foreground);
        font-weight: 600;
        border-left: 2px solid var(--primary);
        background: color-mix(in oklab, var(--primary) 8%, transparent);
      }
      .docs-item-cat {
        font-size: 0.6875rem;
        color: var(--muted-foreground);
      }
      .docs-none {
        padding: 0.375rem 0.625rem;
        font-size: 0.8125rem;
        color: var(--muted-foreground);
      }
      .docs-main {
        min-width: 0;
      }
      .docs-spec {
        scroll-margin-top: 3.5rem;
      }
      .docs-spec-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
        padding: 1.25rem var(--boxel-sp-lg, 1.333rem) 0.25rem;
      }
      .docs-crumb {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.25rem;
        margin: 0;
        padding: 0;
        list-style: none;
        font-size: 0.8125rem;
        color: var(--muted-foreground);
      }
      .docs-crumb > li + li::before {
        content: '/';
        margin-right: 0.25rem;
        opacity: 0.5;
      }
      .docs-crumb-link {
        padding: 0.125rem 0.375rem;
        border: 0;
        border-radius: var(--radius, 0.375rem);
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .docs-crumb-link:hover {
        background: var(--muted);
        color: var(--foreground);
      }
      .docs-crumb-here::before {
        margin-right: 0.625rem !important;
      }
      .docs-crumb-here {
        padding: 0 0.375rem 0 0;
        color: var(--foreground);
        font-weight: 600;
      }
      .docs-landing {
        display: grid;
        gap: 1.5rem;
        padding: 2rem 2.5rem 3rem;
        max-width: 72rem;
      }
      .docs-cat-head {
        display: grid;
        gap: 0.625rem;
        padding-bottom: 1.5rem;
        border-bottom: 1px solid var(--border);
      }
      .docs-eyebrow {
        font-size: 0.6875rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--primary);
      }
      .docs-landing h1 {
        margin: 0;
        font-size: 2.5rem;
        line-height: 1.1;
        letter-spacing: -0.03em;
      }
      .docs-lede {
        margin: 0;
        max-width: 40rem;
        color: var(--muted-foreground);
        font-size: 1rem;
        line-height: 1.55;
      }
      .docs-grid,
      .docs-cats {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
        gap: 0.875rem;
      }
      .docs-comp,
      .docs-catcard {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.375rem;
        width: 100%;
        height: 100%;
        padding: 1rem;
        border: 1px solid var(--border);
        border-radius: calc(var(--radius, 0.5rem) + 0.25rem);
        background: var(--card, var(--background));
        color: var(--foreground);
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition:
          border-color 0.15s ease,
          box-shadow 0.15s ease,
          transform 0.15s ease;
      }
      .docs-comp:hover,
      .docs-catcard:hover {
        border-color: color-mix(in oklab, var(--primary) 55%, var(--border));
        box-shadow: 0 6px 20px -12px
          color-mix(in oklab, var(--foreground) 40%, transparent);
        transform: translateY(-1px);
      }
      .docs-comp:focus-visible,
      .docs-catcard:focus-visible {
        outline: 2px solid var(--ring, var(--primary));
        outline-offset: 2px;
      }
      .docs-comp.ghost {
        min-height: 9.5rem;
        background: var(--muted);
        cursor: default;
      }
      .docs-comp-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        margin-bottom: 0.375rem;
      }
      .docs-mono {
        display: grid;
        place-items: center;
        width: 2.25rem;
        height: 2.25rem;
        border-radius: var(--radius, 0.5rem);
        background: oklch(0.93 0.05 var(--mono-hue));
        color: oklch(0.4 0.12 var(--mono-hue));
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.02em;
      }
      .docs-comp-name {
        font-weight: 600;
        font-size: 0.9375rem;
      }
      .docs-comp-brief {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
        font-size: 0.8125rem;
        line-height: 1.45;
        color: var(--muted-foreground);
      }
      .docs-catcard-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        width: 100%;
      }
      .docs-pager {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
        margin: 1rem var(--boxel-sp-lg, 1.333rem) 3rem;
        padding-top: 1.5rem;
        border-top: 1px solid var(--border);
      }
      .docs-page {
        display: flex;
        align-items: center;
        gap: 0.875rem;
        min-width: 0;
        padding: 0.875rem 1.125rem;
        border: 1px solid var(--border);
        border-radius: calc(var(--radius, 0.5rem) + 0.25rem);
        background: var(--card, var(--background));
        color: var(--foreground);
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition:
          border-color 0.15s ease,
          box-shadow 0.15s ease;
      }
      .docs-page.next {
        grid-column: 2;
        justify-content: flex-end;
        text-align: right;
      }
      .docs-page-text {
        display: grid;
        gap: 0.125rem;
        min-width: 0;
      }
      .docs-page small {
        font-size: 0.75rem;
        color: var(--muted-foreground);
      }
      .docs-page-name {
        overflow: hidden;
        font-size: 1rem;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .docs-page-arrow {
        flex: none;
        font-size: 1.125rem;
        color: var(--muted-foreground);
        transition:
          transform 0.15s ease,
          color 0.15s ease;
      }
      .docs-page:hover {
        border-color: color-mix(in oklab, var(--primary) 55%, var(--border));
        box-shadow: 0 6px 20px -12px
          color-mix(in oklab, var(--foreground) 40%, transparent);
      }
      .docs-page:hover .docs-page-arrow {
        color: var(--foreground);
      }
      .docs-page.prev:hover .docs-page-arrow {
        transform: translateX(-3px);
      }
      .docs-page.next:hover .docs-page-arrow {
        transform: translateX(3px);
      }
      .docs-page:focus-visible {
        outline: 2px solid var(--ring, var(--primary));
        outline-offset: 2px;
      }
      @container (max-width: 48rem) {
        .docs {
          grid-template-columns: minmax(0, 1fr);
        }
        .docs-side {
          position: static;
          max-height: 16rem;
          border-right: 0;
          border-bottom: 1px solid var(--border);
        }
        .docs-landing {
          padding: 1.5rem 1rem 2.5rem;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .docs-comp,
        .docs-catcard,
        .docs-page-arrow,
        .docs-chev {
          animation: none;
          transition: none;
        }
      }
    </style>
  </template>
}
