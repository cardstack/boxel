# app-card-home-with-search — Every card family needs a home

**What this gives you:** A `Home` CardDef (typically named after the brand)
that sits at the top of a card family and uses
`@context.searchResultsComponent` to dynamically list every Meet / Listing /
Project / etc. in the realm. `prefersWideFormat = true` so it opens
edge-to-edge. The user lands on it, sees the realm at a glance, drills in
from there.

**When to use:** Whenever you build a card _family_ — 2+ related CardDefs
(Meet + Swimmer + Club, Project + Task + Person, Show + Listing + Venue,
etc.). Building a single utility card? Skip this pattern. Building anything
where the user will accumulate instances over time? Build the home.

**Why it matters:**

- **Discoverability.** A realm with 5 CardDefs and no home shows users an
  `index.json` `CardsGrid` of mixed cards in adoption order. A home puts the
  brand voice up front and arranges the suite the way the designer intended.
- **Editorial framing.** The home is where you set the typography pairing,
  the eyebrow voice, the color story. Children inherit through the theme
  cascade.
- **Live by construction.** `@context.searchResultsComponent` re-runs as the
  realm changes — new instances appear automatically, no manual
  relationship-wiring on the home.

**Recipe shape:**

```gts
// surge.gts (or whatever the brand demands)
import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import TextAreaField from 'https://cardstack.com/base/text-area';
import {
  codeRef,
  realmURL,
  searchEntryWireQueryFromQuery,
  type Query,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';
import BoltIcon from '@cardstack/boxel-icons/bolt';
import { Meet } from './meet';

// @ts-expect-error import.meta is supported by the Boxel host
const here: string = import.meta.url;

export class Surge extends CardDef {
  static displayName = 'Surge';
  static icon = BoltIcon;
  static prefersWideFormat = true; // ← edge-to-edge home

  @field welcome = contains(StringField);
  @field tagline = contains(TextAreaField);
  @field headlineMeet = linksTo(() => Meet); // optional spotlight pin

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Surge) {
      return this.cardInfo?.name?.trim()?.length
        ? this.cardInfo.name
        : (this.welcome ?? 'SURGE');
    },
  });

  static isolated = class Isolated extends Component<typeof Surge> {
    // codeRef(here, relPath, ExportName) returns { module, name } — the canonical CodeRef
    get meetRef() {
      return codeRef(here, './meet', 'Meet');
    }
    get swimmerRef() {
      return codeRef(here, './swimmer', 'Swimmer');
    }
    get realms(): string[] {
      const url = this.args.model?.[realmURL];
      return url ? [url.href] : [];
    }
    // filter: { type: ref } — match ALL cards of a type.
    //   `on` would be wrong: `on` is a SCOPE inside a predicate, not a filter.
    // Custom-field sorts require `on: ref` — only lastModified, createdAt, cardURL work without it.
    get meetsQuery(): Query {
      const ref = this.meetRef;
      return {
        filter: { type: ref },
        sort: [{ by: 'dates.start', on: ref, direction: 'desc' }],
      };
    }
    get swimmersQuery(): Query {
      const ref = this.swimmerRef;
      return {
        filter: { type: ref },
        sort: [{ by: 'lastName', on: ref, direction: 'asc' }],
      };
    }

    // Each section wraps its Query in searchEntryWireQueryFromQuery, then
    // attaches `realms` + the fitted display format via filter.eq.htmlQuery.
    // This is what <@context.searchResultsComponent> consumes.
    get meetsWireQuery(): SearchEntryWireQuery {
      const q = searchEntryWireQueryFromQuery(this.meetsQuery);
      return {
        ...q,
        realms: this.realms,
        filter: {
          ...q.filter,
          eq: { ...q.filter?.eq, htmlQuery: { eq: { format: 'fitted' } } },
        },
      };
    }
    get swimmersWireQuery(): SearchEntryWireQuery {
      const q = searchEntryWireQueryFromQuery(this.swimmersQuery);
      return {
        ...q,
        realms: this.realms,
        filter: {
          ...q.filter,
          eq: { ...q.filter?.eq, htmlQuery: { eq: { format: 'fitted' } } },
        },
      };
    }

    <template>
      <article class='sg'>
        <header class='sg-mast'>
          <h1 class='sg-wordmark'>{{if
              @model.welcome
              @model.welcome
              'SURGE'
            }}</h1>
          {{#if @model.tagline}}<p
              class='sg-tagline'
            >{{@model.tagline}}</p>{{/if}}
        </header>

        {{! Singular spotlight — no plural-field wrapper, simple :deep override }}
        {{#if @model.headlineMeet}}
          <section class='sg-featured'>
            <@fields.headlineMeet @format='embedded' />
          </section>
        {{/if}}

        {{! Dynamic section: every Meet in the realm, fitted, live }}
        <section class='sg-section'>
          <h2 class='sg-section-title'>The calendar</h2>
          <ul class='sg-meets'>
            <@context.searchResultsComponent
              @query={{this.meetsWireQuery}}
              @mode='hover'
              as |results|
            >
              {{#if results.isLoading}}
                <li class='sg-loading'>Loading…</li>
              {{/if}}
              {{#each results.entries key='id' as |entry|}}
                <li class='sg-meets-cell'>
                  <entry.component class='sg-card' />
                </li>
              {{else}}
                <li class='sg-empty'>No meets yet.</li>
              {{/each}}
            </@context.searchResultsComponent>
          </ul>
        </section>

        {{! Add one @context.searchResultsComponent section per CardDef in the family }}
      </article>

      <style scoped>
        /* Outer chrome — leave radius / border / shadow / opaque bg to the host */
        .sg {
          background: var(--paper, #f5f8fa);
          color: var(--ink, #0b1320);
          font-family: var(--font-body, system-ui, sans-serif);
          min-height: 100%;
        }
        .sg-meets {
          list-style: none;
          padding: 0;
          margin: 0;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 14px;
        }
        .sg-meets-cell {
          min-height: 200px;
        }
        /* Chrome override on the prerendered cards */
        .sg-section :deep(.boxel-card-container) {
          border-radius: 0;
          background: var(--card, #ffffff);
        }
        .sg-section :deep(.boxel-card-container--boundaries) {
          box-shadow: 0 0 0 1px var(--ink, #0b1320);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Surge> {
    /* brand card */
  };
  static fitted = class Fitted extends Component<typeof Surge> {
    /* mini wordmark */
  };
}
```

```json
// Surge/home.json — the canonical home instance
{
  "data": {
    "type": "card",
    "attributes": {
      "welcome": "SURGE",
      "tagline": "The youth swim meet platform.",
      "cardInfo": { "name": "SURGE — Home", "summary": "Realm home." }
    },
    "relationships": {
      "headlineMeet": {
        "links": { "self": "../Meet/mid-atlantic-senior-sectionals-2026" }
      },
      "cardInfo.theme": { "links": { "self": "../Theme/surge" } }
    },
    "meta": { "adoptsFrom": { "module": "../surge", "name": "Surge" } }
  }
}
```

**`@context.searchResultsComponent` is live by construction — mind the cost
on multi-section homes.**

Each `@context.searchResultsComponent` section subscribes its query to realm
change events. Every time ANY card in the realm is created, edited, or
deleted, the matching sections re-fetch and re-render. For a Home with 4
result-list sections, editing a single Swimmer somewhere else in the realm
can fire re-fetches across every section whose query might be affected —
even though only one section's data actually changed. With the host's
autosave on each keystroke, this can make unrelated edit forms feel sluggish
because the Home tab is consuming CPU on every reindex.

There is no snapshot/live toggle to reach for — the surface is live by
default. The lever you _do_ have is `@mode`: `'hover'` (default) hydrates
each result so it can respond to hover; `'none'` renders the prerendered
HTML with no per-result interactivity, which is cheaper for dense read-only
sections.

```gts
{{!-- ✅ Default: hover-hydrated results. --}}
<@context.searchResultsComponent @query={{this.q}} as |results|>
  {{#each results.entries key='id' as |entry|}}<entry.component />{{/each}}
</@context.searchResultsComponent>

{{!-- ✅ Cheaper for dense, read-only sections — no per-result hover hydration. --}}
<@context.searchResultsComponent @query={{this.q}} @mode='none' as |results|>
  {{#each results.entries key='id' as |entry|}}<entry.component />{{/each}}
</@context.searchResultsComponent>
```

Keep the number of live sections on a single Home modest, and prefer
`@mode='none'` for sections the user only reads.

**Why `@context.searchResultsComponent` (display) instead of `getCards`
(instances):**

| Use case                                                          | Pick                                         |
| ----------------------------------------------------------------- | -------------------------------------------- |
| Showing the cards as themselves (fitted/embedded HTML)            | `@context.searchResultsComponent`            |
| Reading model values to compute aggregates (counts, sums, charts) | `getCards`                                   |
| Both — list and aggregate                                         | `getCards`, then render with `<@fields ...>` |

The home almost always wants the first. The host pre-renders each result on
the realm side, so the home doesn't pay the cost of loading every model into
memory. For a realm with hundreds of instances, this is the difference
between snappy and unusable.

**Critical — apply the chrome contract:**

The home's outermost element (`.sg` in the example) MUST leave decoration to
the host's CardContainer. No `border-radius`, no `border`, no `box-shadow`,
no opaque `background` (`var(--paper)` is fine — the paper is the brand
surface, not chrome), no `overflow`. Brand-specific outer treatment goes on
the Theme card as `--radius`, `--background`, `--border`. See the
`boxel-delegated-render-control` skill.

**Critical — no plural-field wrapper for search-results output:**

`@context.searchResultsComponent` does NOT wrap its yielded entries in
`.plural-field / .containsMany-field / .linksToMany-field` — that wrapper
only appears for `<@fields.plural @format='...' />` direct rendering. With
the search-results surface, you own the `<ul>` / `<li>` shell yourself, so
`display: grid` on the `<ul>` works without any `display: contents` tricks.
The chrome `:deep()` overrides still apply because each result renders
inside its own `.boxel-card-container`.

**The three query traps:**

1. **`filter: { type: ref }` to select all cards of a type.** Never
   `filter: { on: ref }` — `on` is a scope for predicates, not a filter on
   its own. Writing `{ on: ref }` with no predicate returns zero rows.
2. **Custom-field sorts require `on: ref`.** Only `lastModified`,
   `createdAt`, and `cardURL` are valid sort keys without `on` (the
   `generalSortFields` list). Sorting on `lastName`, `dates.start`, anything
   custom — the sort expression MUST include `on: ref`.
3. **Use `codeRef(here, path, name)`, not raw URL construction.** And import
   `realmURL` as a Symbol from `@cardstack/runtime-common` — don't write
   `Symbol.for('realmURL')` (it produces a different Symbol that doesn't
   match what the host injected).

Query type definitions live at `packages/runtime-common/query.ts` in the
Boxel monorepo.

**Other gotchas:**

- `import.meta.url` works in `.gts` at runtime but TS complains — declare
  `const here: string = import.meta.url;` once at top with
  `@ts-expect-error` on the line above.
- Compound sort paths like `dates.start` work for fields-of-fields
  (`DateRangeField.start`).
- The home loads when `model.id` is undefined briefly — the realmURL getter
  handles this by returning `[]` instead of throwing, and
  `@context.searchResultsComponent` reports `results.isLoading` until realms
  is non-empty.
- If you want to open this card by default when someone visits the realm
  root, rely on `index.json`'s `CardsGrid` showing this as the first card
  (with a thumbnail + clear title).

## Host-mode click-through — MANDATORY for any app card that publishes

In the published Host mode, cards rendered from
`@context.searchResultsComponent` entries do NOT click through to their
isolated view by default. The host's in-app click-to-open machinery
(`@context.cardComponentModifier`) doesn't run on the published static site.
Visitors see beautifully rendered fitted tiles that do nothing on click.

**Fix: wrap each rendered card in an `<a href={{entry.id}}>` overlay.** The
overlay pattern keeps the underlying card render natural (no height-100%
chain through component chrome) and just adds a transparent click target on
top:

```gts
<@context.searchResultsComponent @query={{this.q}} as |results|>
  {{#each results.entries key='id' as |entry|}}
    <li class='project-cell'>
      <entry.component class='project-card-inner' />
      <a class='card-link' href={{entry.id}} aria-label='Open card'></a>
    </li>
  {{/each}}
</@context.searchResultsComponent>
```

CSS:

```css
.project-cell {
  position: relative;
  transition:
    transform 120ms ease,
    box-shadow 120ms ease;
}
.project-cell:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.1);
}
.card-link {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: block;
  text-decoration: none;
  color: transparent;
  cursor: pointer;
  border-radius: 2px;
}
.card-link:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
}
```

### Why overlay, not wrap

The first instinct is to wrap the card: `<a><entry.component /></a>`. That
breaks fitted cards because the anchor needs
`display: block; height: 100%; width: 100%;` and the height-100% chain has
to propagate through the component's outer chrome (`boxel-card-container`).
The chain breaks silently and the rendered card collapses to zero height.
Use the overlay pattern.

### The mode matrix

| Mode                         | What enables click                                            | Mechanism                                       |
| ---------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| **Interact / Code** (in-app) | `{{@context.cardComponentModifier ...}}` on a `CardContainer` | Pushes the card onto the Boxel app's card stack |
| **Host** (published site)    | `<a href={{entry.id}}>` overlay                               | Plain browser navigation to the card's URL      |

Complementary, not redundant. An app card that publishes AND is browsable
in-app can stack both: the overlay anchor for Host clicks, the modifier on
the inner CardContainer for in-app push. The anchor is inert in Interact
mode (no navigation pane); the modifier is inert in Host (no Boxel app
running).

### Verification

In Host mode, open dev tools, inspect a rendered tile. Look for an
`<a href="https://.../<Type>/<slug>">` ancestor of the card's root element.
If the only ancestors are `<li>` / `<div>`, the tile won't navigate. The
`cards-grid` example in `boxel-catalog` (`components/grid.gts`) does NOT
include this wrap — it's designed for Interact mode only. Don't copy from
there directly for published-site app cards.

## Advanced live-surface notes (from dashboard work)

- **Counts without hydration:** KPI/funnel numbers via `page: { size: 1 }`
  on the wire query + `results.meta.page.total` — one row of HTML, full
  count.
- **`@cached` the wire-query getters** so SearchResults keeps ONE live
  subscription per section instead of resubscribing on every re-render.
- **`@mode='none'`** keeps results on prerendered HTML (no hover
  hydration) — right for dashboards; `@mode='hover'` for browsable grids.
- **Tile clicks in monitor-style cards:** use
  `this.args.viewCard(url, 'isolated', { openCardInRightMostStack: true })`
  — never `<a href>` (full-page navigation drops the surface).
- **Churn warning:** live sections re-run on EVERY realm index change. A
  realm that is being written every few seconds (sync loops, log writers)
  makes every section flash its loading state continuously — keep
  high-frequency writers out of the realm the dashboard watches, and prefer
  showing stale results over a loading state during revalidation.
