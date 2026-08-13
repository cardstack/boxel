import GlimmerComponent from '@glimmer/component';
import PlusIcon from '@cardstack/boxel-icons/plus';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn, get } from '@ember/helper';
import { consume } from 'ember-provide-consume-context';
import { debounce } from 'lodash-es';
import { eq } from '@cardstack/boxel-ui/helpers';
import {
  BoxelInput,
  Button,
  ViewSelector,
} from '@cardstack/boxel-ui/components';
import TableIcon from '@cardstack/boxel-icons/table';
import {
  identifyCard,
  searchEntryWireQueryFromQuery,
  CardCrudFunctionsContextName,
  type CardCrudFunctions,
  type Query,
  type Filter,
  type CodeRef,
  type SearchEntryWireQuery,
  type getCards,
} from '@cardstack/runtime-common';
import type { ViewItem } from '@cardstack/boxel-ui/components';
import {
  Grid3x3 as GridIcon,
  Rows4 as StripIcon,
} from '@cardstack/boxel-ui/icons';
import type { CardContext, CardDef } from '@cardstack/base/card-api';

import { DataTable, type DataColumn } from './data-table';

type View = 'grid' | 'strip' | 'table';

interface Signature {
  Args: {
    /** The card type this panel lists. A class, not a display name — see below. */
    cardClass: typeof CardDef;
    context?: CardContext;
    realms: string[];
    /** Table columns. Keys are read straight off the resolved instance. */
    columns: DataColumn[];
    /** What the panel is called, for the table caption and the empty state. */
    label: string;
    searchPlaceholder?: string;
    newLabel?: string;
  };
  Element: HTMLElement;
}

/**
 * One catalogue panel: the same set of cards as a tile grid or as a table,
 * with one search box over both.
 *
 * Three decisions worth stating, because each replaces something that was
 * wrong in the version before it:
 *
 *  1. **The type filter is a CodeRef, not `_cardType`.** Matching on the
 *     display name is an exact string match, so it silently drops subclasses —
 *     that is how Incident and ServiceRequest went missing from the ticket
 *     queue. `identifyCard` derives the ref from the class, so a subclass is
 *     included by construction.
 *
 *  2. **Grid tiles come from `@context.searchResultsComponent`.** That gets
 *     prerendered fitted HTML and the operator-mode overlay — hover highlight
 *     and click-to-open — with no per-tile wiring. The cost is that a
 *     prerendered tile cannot resolve `linksTo`, which is why every card in
 *     this app carries denormalized name fields.
 *
 *  3. **Both views read ONE query object.** The skill's shape for this is a
 *     wire query for the grid and a hand-written client-side mirror for the
 *     table, with a comment explaining that the two must agree. Here they
 *     cannot disagree: `query` is built once and the grid passes it through
 *     `searchEntryWireQueryFromQuery` while the table hands the same thing to
 *     `getCards`. Toggling grid ↔ table changes how rows are drawn and never
 *     which rows are present — which is the rule the mirror exists to keep,
 *     obtained by construction rather than by discipline.
 */
export class CollectionPanel extends GlimmerComponent<Signature> {
  @consume(CardCrudFunctionsContextName)
  declare cardCrudFunctions: CardCrudFunctions | undefined;

  @tracked view: View = 'grid';
  @tracked search = '';
  @tracked sortKey: string | undefined;
  @tracked sortDescending = false;

  private tableQuery: ReturnType<getCards> | undefined;

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner as never, args as never);
    // Live: a card created in another tab appears here without a reload, and
    // nothing has to be appended to a list to make that happen.
    this.tableQuery = this.args.context?.getCards(
      this,
      () => this.query,
      () => this.args.realms,
      { isLive: true },
    );
  }

  private setSearchNow = debounce((value: string) => {
    this.search = value;
  }, 250);

  // Debounce the tracked assignment, not the input's value — the box must feel
  // immediate; it is the query that waits.
  setSearch = (value: string) => {
    this.setSearchNow(value);
  };

  viewOptions: ViewItem[] = [
    { id: 'grid', icon: GridIcon },
    { id: 'strip', icon: StripIcon },
    { id: 'table', icon: TableIcon },
  ];

  setView = (view: string) => {
    this.view = view as View;
  };

  clear = (_event?: Event) => {
    // Cancel first: a Clear pressed inside the 250ms window would otherwise
    // let the trailing invocation put the term straight back.
    this.setSearchNow.cancel();
    this.search = '';
  };

  willDestroy() {
    super.willDestroy();
    this.setSearchNow.cancel();
  }

  get ref(): CodeRef | undefined {
    return identifyCard(this.args.cardClass);
  }

  // No text → a plain type filter. Text → the type AND (full-document
  // `matches` OR title `contains`). Both halves of the `any` are needed:
  // `matches` finds a term buried in a description but can miss the title the
  // reader obviously meant; `contains` on cardTitle guarantees that case.
  private get filter(): Filter | undefined {
    let ref = this.ref;
    if (!ref) {
      return undefined;
    }
    let text = this.search.trim();
    if (!text) {
      return { type: ref };
    }
    return {
      every: [
        { type: ref },
        { any: [{ matches: text }, { contains: { cardTitle: text } }] },
      ],
    };
  }

  get query(): Query | undefined {
    let filter = this.filter;
    let ref = this.ref;
    // Returning undefined while the ref or the realms are unresolved renders
    // nothing, rather than querying every realm for every type.
    if (!filter || !ref || !this.args.realms.length) {
      return undefined;
    }
    // `sort` without `on` returns an EMPTY result rather than an unsorted one.
    return { filter, sort: [{ by: 'title', on: ref, direction: 'asc' }] };
  }

  get wireQuery(): SearchEntryWireQuery | undefined {
    let query = this.query;
    if (!query) {
      return undefined;
    }
    return {
      ...searchEntryWireQueryFromQuery(query),
      realms: this.args.realms,
    };
  }

  get rows(): CardDef[] {
    // Filter the dead slots: a deleted target leaves its slot in place, so a
    // raw iteration renders an empty row and a raw `.length` counts a card
    // that no longer exists.
    let instances = ((this.tableQuery?.instances ?? []) as CardDef[]).filter(
      Boolean,
    );
    let key = this.sortKey;
    if (!key) {
      return instances;
    }
    let direction = this.sortDescending ? -1 : 1;
    return [...instances].sort((a, b) => {
      let left = String((a as any)[key!] ?? '');
      let right = String((b as any)[key!] ?? '');
      return left.localeCompare(right) * direction;
    });
  }

  get isLoading(): boolean {
    return Boolean(this.tableQuery?.isLoading);
  }

  // Same rule as the queue: a live query reports isLoading on every
  // revalidation, and any save in the realm triggers one. Dim the rows,
  // never replace them.
  get isRefreshing(): boolean {
    return this.isLoading && this.rows.length > 0;
  }

  /**
   * A failed query is not an empty collection.
   *
   * Without this branch a realm that could not be reached rendered
   * "No commitments yet" — the panel reported a fact about the data when what
   * had actually happened was a failure, and an administrator would go and
   * create a policy that already existed.
   */
  /**
   * A rejected write is reported here too, not only a failing query.
   *
   * `create` used to await with only a `finally`, so a realm that refused the
   * write stopped the spinner, produced no card, said nothing, and let the
   * rejection escape unhandled.
   */
  @tracked private createProblem: string | undefined;

  get problem(): string | undefined {
    if (this.createProblem) {
      return this.createProblem;
    }
    let errors = (this.tableQuery as any)?.errors as
      | { message?: string }[]
      | undefined;
    if (!errors?.length) {
      return undefined;
    }
    return errors[0]?.message ?? 'The query could not run.';
  }

  get emptyMessage(): string {
    return this.search.trim()
      ? `Nothing in ${this.args.label} matches “${this.search.trim()}”.`
      : `No ${this.args.label.toLowerCase()} yet.`;
  }

  sortBy = (key: string) => {
    if (this.sortKey === key) {
      this.sortDescending = !this.sortDescending;
      return;
    }
    this.sortKey = key;
    this.sortDescending = false;
  };

  openRow = (row: CardDef) => {
    if (row?.id) {
      this.cardCrudFunctions?.viewCard?.(new URL(row.id));
    }
  };

  @tracked creating = false;

  /**
   * Every type the app displays can be created from inside the app.
   *
   * Six panels listed queues, categories, agents, contacts, policies and
   * schedules and offered no way to add one — an administrator had to leave
   * for the file tree. The panel knows its own type, so the button is the
   * same one line everywhere.
   */
  create = async (_event?: Event) => {
    let make = this.cardCrudFunctions?.createCard;
    let ref = this.ref;
    let realm = this.args.realms[0];
    if (!make || !ref || !realm) {
      return;
    }
    this.creating = true;
    this.createProblem = undefined;
    try {
      await make(ref, new URL(realm), { realmURL: new URL(realm) });
    } catch (error: any) {
      this.createProblem = error?.message ?? String(error);
    } finally {
      this.creating = false;
    }
  };

  openEntry = (id: string, _event?: Event) => {
    if (id) {
      this.cardCrudFunctions?.viewCard?.(new URL(id));
    }
  };

  <template>
    <section class='cp' aria-label={{@label}} ...attributes>
      <div class='cp-bar'>
        <label class='sr-only' for='cp-search-{{@label}}'>Search
          {{@label}}</label>
        <BoxelInput
          id='cp-search-{{@label}}'
          class='cp-search'
          @type='search'
          @value={{this.search}}
          @onInput={{this.setSearch}}
          @placeholder={{if @searchPlaceholder @searchPlaceholder 'Search…'}}
        />
        {{#if this.search}}
          <Button
            @kind='secondary'
            @size='extra-small'
            {{on 'click' this.clear}}
          >Clear</Button>
        {{/if}}
        <span class='cp-grow'></span>
        {{#if this.cardCrudFunctions.createCard}}
          {{! The one thing this bar is FOR. It was grey-on-grey and sitting
              flush against the view switcher, so the only action in the
              toolbar looked like a third view option. Filled, iconed, and
              separated: "add" is a different kind of verb from "look at
              differently". }}
          <Button
            class='cp-new'
            @kind='primary'
            @size='extra-small'
            @loading={{this.creating}}
            {{on 'click' this.create}}
          >
            {{#unless this.creating}}
              <PlusIcon width='14' height='14' aria-hidden='true' />
            {{/unless}}
            New
            {{@newLabel}}
          </Button>
        {{/if}}
        {{! boxel-ui's ViewSelector, not a hand-rolled IconButton group. The
            hand-rolled one was copied from the talent tracker without checking
            whether the library already had it — it does, and its version is
            built on RadioInput, which is the correct semantics for "one of
            three" where a row of aria-pressed buttons only approximates it.
            The `table` option is passed in because VIEW_OPTIONS ships
            card/strip/grid and this panel has no card view. }}
        <ViewSelector
          @items={{this.viewOptions}}
          @selectedId={{this.view}}
          @onChange={{this.setView}}
        />
      </div>

      {{#if this.problem}}
        <div class='cp-bad' role='alert'>
          <b>{{@label}} could not load.</b>
          <p>{{this.problem}}</p>
        </div>

      {{else if (eq this.view 'table')}}
        <DataTable
          class={{if this.isRefreshing 'cp-busy'}}
          @columns={{@columns}}
          @rows={{this.rows}}
          @rowKey='id'
          @sortKey={{this.sortKey}}
          @sortDescending={{this.sortDescending}}
          @onSort={{this.sortBy}}
          @onSelectRow={{this.openRow}}
          @caption={{@label}}
          @emptyMessage={{this.emptyMessage}}
        >
          <:cell as |row column|>
            {{get row column.key}}
          </:cell>
        </DataTable>

      {{else if @context.searchResultsComponent}}
        {{#let (component @context.searchResultsComponent) as |Search|}}
          {{! @mode='none' keeps every tile inert. It is not lazy loading —
              'hover' would fetch one card per hover, which a catalogue people
              scan is exactly the wrong place for. }}
          <Search @query={{this.wireQuery}} @mode='none' as |results|>
            <div class='cp-grid {{if (eq this.view "strip") "cp-strip"}}'>
              {{#each results.entries key='id' as |entry|}}
                <div
                  class='cp-tile {{if (eq this.view "strip") "cp-tile-strip"}}'
                  role={{if this.cardCrudFunctions.viewCard 'button'}}
                  tabindex={{if this.cardCrudFunctions.viewCard '0'}}
                  {{on 'click' (fn this.openEntry entry.id)}}
                >
                  <entry.component />
                </div>
              {{else}}
                {{#if results.isLoading}}
                  <p class='cp-note' role='status'>Loading…</p>
                {{else}}
                  <p class='cp-note'>{{this.emptyMessage}}</p>
                {{/if}}
              {{/each}}
            </div>
          </Search>
        {{/let}}

      {{else}}
        <p class='cp-note'>This view has no card context, so the grid cannot
          render. The table above works without one.</p>
      {{/if}}
    </section>

    <style scoped>
      .cp {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        min-width: 0;
        font-family: var(--font-sans, var(--boxel-font-family));
        color: var(--foreground, var(--boxel-dark));
      }
      .cp-bar {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        flex-wrap: wrap;
      }
      .cp-search {
        flex: 1;
        min-width: 12rem;
        max-width: 24rem;
      }
      .cp-grow {
        flex: 1;
      }
      .cp-new {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-5xs, 4px);
        --boxel-button-primary-background: var(--primary, var(--boxel-dark));
        --boxel-button-primary-foreground: var(
          --primary-foreground,
          var(--boxel-light)
        );
        white-space: nowrap;
      }
      /* The action and the view switcher are different kinds of thing; a hair
         of space and a rule stop them reading as one control group. */
      .cp-new + :global(.view-options-group) {
        margin-inline-start: var(--boxel-sp-xxs);
        padding-inline-start: var(--boxel-sp-xxs);
        border-inline-start: 1px solid var(--border, var(--boxel-200));
      }
      .cp-busy {
        opacity: 0.72;
      }
      .cp-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
        gap: var(--boxel-sp-xs);
      }
      /* The host's fitted container lives inside this box, so the tile sets a
         height and lets the card decide what fits in it. */
      .cp-tile {
        height: 10.5rem;
        min-width: 0;
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-sm, 6px);
        overflow: hidden;
        background: var(--card, var(--boxel-light));
        cursor: pointer;
        transition: border-color 0.1s ease-out;
      }
      /* List view is the same tiles at one per row and half the height. The
         fitted templates already switch to a two-column layout when they are
         wide and short, so nothing here has to tell them how to draw it. */
      .cp-strip {
        grid-template-columns: 1fr;
      }
      .cp-tile-strip {
        height: 4.5rem;
      }
      .cp-tile:hover {
        border-color: var(--primary, var(--boxel-highlight));
      }
      .cp-tile:focus-visible {
        outline: 2px solid var(--primary, var(--boxel-highlight));
        outline-offset: 2px;
      }
      .cp-bad {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--boxel-sp-4xs);
        padding: var(--boxel-sp) var(--boxel-sp-sm);
        border: 1px solid var(--border, var(--boxel-200));
        border-left: 3px solid var(--boxel-danger);
        border-radius: var(--boxel-border-radius-sm, 4px);
        background: var(--card, var(--boxel-light));
      }
      .cp-bad b {
        color: color-mix(
          in oklch,
          var(--boxel-danger) 45%,
          var(--foreground, var(--boxel-dark))
        );
      }
      .cp-bad p {
        margin: 0;
        max-width: 60ch;
        font-size: var(--boxel-font-size-sm);
        line-height: 1.6;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .cp-note {
        margin: 0;
        padding: var(--boxel-sp-sm) 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground, var(--boxel-450));
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }

      /* Motion here is confirmation, never decoration — a hover tint, a
         pressed nudge. Someone who has asked the OS to stop animating gets
         the same interface with the confirmation delivered instantly. */
      @media (prefers-reduced-motion: reduce) {
        * {
          transition: none !important;
          animation: none !important;
        }
      }
    </style>
  </template>
}

export default CollectionPanel;
