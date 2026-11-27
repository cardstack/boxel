// Pretui — the pieces the showcase home and overview share: a link that opens
// a card in the stack, the kit's Spec index, a live count, and the top bar.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import {
  rri,
  searchEntryWireQueryFromQuery,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';
import type { ViewCardFn } from '@cardstack/base/card-api';
import { SPEC_REALM, SPEC_REF } from './showcase-data';

/**
 * A real link to a card. With `@viewCard` (inside the host) a click opens the
 * card in the stack; without it (prerendered HTML, a plain browser) the href
 * still works.
 */
export class CardLink extends Component<{
  Args: {
    href: string;
    viewCard?: ViewCardFn;
    current?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLAnchorElement;
}> {
  open = (event: Event) => {
    let viewCard = this.args.viewCard;
    if (!viewCard) return;
    let mouse = event as MouseEvent;
    if (
      mouse.metaKey ||
      mouse.ctrlKey ||
      mouse.shiftKey ||
      mouse.altKey ||
      mouse.button
    ) {
      return;
    }
    event.preventDefault();
    viewCard(rri(this.args.href));
  };
  <template>
    <a
      href={{@href}}
      aria-current={{if @current 'page'}}
      {{on 'click' this.open}}
      ...attributes
    >{{yield}}</a>
  </template>
}

/** The total of a search, yielded once it lands; nothing is rendered per row. */
export class SearchTotal extends Component<{
  Args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context?: any;
    query: SearchEntryWireQuery;
  };
  Blocks: { default: [number | undefined] };
}> {
  <template>
    {{#if @context.searchResultsComponent}}
      <@context.searchResultsComponent
        @query={{@query}}
        @mode='none'
        as |results|
      >
        {{yield results.meta.page.total}}
      </@context.searchResultsComponent>
    {{else}}
      {{yield undefined}}
    {{/if}}
  </template>
}

export interface SpecLike {
  id: string;
  componentName?: string;
  cardTitle?: string;
  category?: string;
  brief?: string;
}

export function specName(spec: SpecLike): string {
  return spec.componentName ?? spec.cardTitle ?? 'Component';
}

/** Every Spec in the kit, by name, category and brief — enough to list and filter. */
export class SpecCatalog {
  #byCategory = new Map<string, SpecLike[]>();
  constructor(
    readonly all: SpecLike[],
    readonly loading: boolean,
  ) {
    for (let spec of all) {
      let key = spec.category ?? '';
      let list = this.#byCategory.get(key) ?? [];
      list.push(spec);
      this.#byCategory.set(key, list);
    }
  }
  get total(): number | undefined {
    return this.loading && !this.all.length ? undefined : this.all.length;
  }
  inCategory = (name: string): SpecLike[] => this.#byCategory.get(name) ?? [];
  count = (name: string): number | undefined =>
    this.loading && !this.all.length ? undefined : this.inCategory(name).length;
  search = (text: string): SpecLike[] => {
    let terms = words(text);
    if (!terms.length) return [];
    let phrase = terms.join(' ');
    let every: { spec: SpecLike; score: number }[] = [];
    let some: { spec: SpecLike; score: number }[] = [];
    for (let spec of this.all) {
      let name = words(specName(spec));
      let prose = words(`${spec.cardTitle ?? ''} ${spec.brief ?? ''}`);
      let scores = terms.map((term): number =>
        name.includes(term)
          ? 3
          : name.some((word) => word.startsWith(term))
            ? 2
            : prose.some((word) => word.startsWith(term))
              ? 1
              : 0,
      );
      let score = scores.reduce((sum, s) => sum + s, 0);
      if (!score) continue;
      if (name.join(' ') === phrase) score += 10;
      (scores.every(Boolean) ? every : some).push({ spec, score });
    }
    // every word must match; only when nothing does, any word will.
    // Sort is stable, so equal scores keep the index order
    return (every.length ? every : some)
      .sort((a, b) => b.score - a.score)
      .map(({ spec }) => spec);
  };
}

export function hasSearchWords(text: string): boolean {
  return words(text).length > 0;
}

// "DatePicker" and "date picker" both become ["date", "picker"]
function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export const EMPTY_CATALOG = new SpecCatalog([], false);

// the sparse fieldset keeps each row to a few strings; full Specs carry their
// linked examples, which makes the whole kit several megabytes
const SPEC_FIELDS = ['cardTitle', 'componentName', 'category', 'brief'];

const SPEC_INDEX_QUERY: SearchEntryWireQuery = {
  ...searchEntryWireQueryFromQuery(
    {
      filter: { type: SPEC_REF },
      sort: [{ by: 'cardTitle', on: SPEC_REF, direction: 'asc' }],
      // the whole kit in one page; the server's default page is smaller
      page: { number: 0, size: 1000 },
    },
    { fields: SPEC_FIELDS.map((field) => `item.${field}`) },
  ),
  realms: [SPEC_REALM],
};

interface EntryLike {
  id: string;
  item?: { attributes?: Record<string, unknown> };
}

function catalogFrom(entries: EntryLike[], loading: boolean): SpecCatalog {
  let all = entries.map((entry) => {
    let attributes = entry.item?.attributes ?? {};
    let text = (key: string) =>
      typeof attributes[key] === 'string'
        ? (attributes[key] as string)
        : undefined;
    return {
      id: entry.id,
      componentName: text('componentName'),
      cardTitle: text('cardTitle'),
      category: text('category'),
      brief: text('brief'),
    };
  });
  return new SpecCatalog(all, loading);
}

/** Loads the kit's Spec index once and yields it to everything inside. */
export class SpecIndex extends Component<{
  Args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context?: any;
  };
  Blocks: { default: [SpecCatalog] };
}> {
  query = SPEC_INDEX_QUERY;
  catalogFrom = catalogFrom;
  <template>
    {{#if @context.searchResultsComponent}}
      <@context.searchResultsComponent
        @query={{this.query}}
        @mode='none'
        as |results|
      >
        {{yield (this.catalogFrom results.entries results.isLoading)}}
      </@context.searchResultsComponent>
    {{else}}
      {{yield EMPTY_CATALOG}}
    {{/if}}
  </template>
}

export class ShowcaseTopbar extends Component<{
  Args: {
    here: 'home' | 'docs';
    onHome: () => void;
    onDocs: () => void;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}> {
  get atHome() {
    return this.args.here === 'home';
  }
  <template>
    <header class='sc-top' ...attributes>
      <button
        type='button'
        class='sc-brand'
        data-test-showcase-home-link
        aria-current={{if this.atHome 'page'}}
        {{on 'click' @onHome}}
      >
        <span class='sc-mark' aria-hidden='true'>P</span>
        <span class='sc-word'>Pret UI</span>
      </button>
      <nav class='sc-nav' aria-label='Showcase'>
        <button
          type='button'
          class='sc-nav-link'
          data-test-showcase-docs-link
          aria-current={{if this.atHome false 'page'}}
          {{on 'click' @onDocs}}
        >Components</button>
      </nav>
      <div class='sc-top-end' data-test-showcase-scheme>{{yield}}</div>
    </header>
    <style scoped>
      .sc-top {
        position: sticky;
        top: 0;
        z-index: 5;
        display: flex;
        align-items: center;
        gap: 1.5rem;
        padding: 0.75rem 1.5rem;
        background: color-mix(in oklab, var(--background) 86%, transparent);
        backdrop-filter: blur(10px);
        border-bottom: 1px solid var(--border);
      }
      .sc-brand,
      .sc-nav-link {
        border: 0;
        background: transparent;
        font: inherit;
        cursor: pointer;
        padding: 0;
      }
      .sc-brand {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        color: var(--foreground);
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      .sc-mark {
        display: inline-grid;
        place-items: center;
        width: 1.75rem;
        height: 1.75rem;
        border-radius: var(--radius, 0.5rem);
        background: var(--primary);
        color: var(--primary-foreground);
        font-size: 0.875rem;
      }
      .sc-nav {
        display: flex;
        gap: 1rem;
      }
      .sc-nav-link {
        color: var(--muted-foreground);
        font-size: 0.875rem;
        font-weight: 500;
      }
      .sc-nav-link:hover,
      .sc-nav-link[aria-current='page'] {
        color: var(--foreground);
      }
      .sc-top-end {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
    </style>
  </template>
}
