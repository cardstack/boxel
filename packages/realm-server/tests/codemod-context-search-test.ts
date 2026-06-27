import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { transformContextSearch } from '../scripts/codemod/context-search/transform.ts';

// A clean, mechanically-transformable usage: the `:response` body is a direct
// `{{#each}}` over the result array that renders `<card.component />`, the query
// is a passed-in arg, and `@format` is the default (`fitted`). This is the
// "representative card" the codemod must transform end to end.
const TRANSFORMABLE = `import GlimmerComponent from '@glimmer/component';

import { type CardContext } from 'https://cardstack.com/base/card-api';

import { type Query } from '@cardstack/runtime-common';

interface CardsGridSignature {
  Args: {
    query: Query;
    realms: string[];
    context?: CardContext;
  };
  Element: HTMLElement;
}

export class CardsGrid extends GlimmerComponent<CardsGridSignature> {
  <template>
    <ul class='cards' ...attributes>
      <@context.prerenderedCardSearchComponent
        @query={{@query}}
        @format='fitted'
        @realms={{@realms}}
        @isLive={{true}}
      >
        <:loading>
          Loading...
        </:loading>
        <:response as |cards|>
          {{#each cards key='url' as |card|}}
            <li class='cards-grid-item' data-url={{card.url}}>
              <card.component class='card' />
            </li>
          {{/each}}
        </:response>
      </@context.prerenderedCardSearchComponent>
    </ul>
  </template>
}
`;

// Same clean shape, but a non-default `@format` — which must be bound through
// the htmlQuery field (a bare `eq.format` is rejected by the wire grammar).
const TRANSFORMABLE_EMBEDDED = `import GlimmerComponent from '@glimmer/component';

import { type CardContext } from 'https://cardstack.com/base/card-api';

import { type Query } from '@cardstack/runtime-common';

interface Sig {
  Args: { query: Query; realms: string[]; context?: CardContext };
  Element: HTMLElement;
}

export class EmbeddedList extends GlimmerComponent<Sig> {
  <template>
    <@context.prerenderedCardSearchComponent
      @query={{@query}}
      @format='embedded'
      @realms={{@realms}}
      @isLive={{true}}
    >
      <:response as |cards|>
        {{#each cards key='url' as |card|}}
          <card.component />
        {{/each}}
      </:response>
    </@context.prerenderedCardSearchComponent>
  </template>
}
`;

// The only runtime-common import is declaration-level type-only. The adapter is
// a runtime value, so it must NOT be appended to that import (which would erase
// it) — it goes in a separate value import.
const TRANSFORMABLE_TYPE_ONLY_IMPORT = `import GlimmerComponent from '@glimmer/component';

import { type CardContext } from 'https://cardstack.com/base/card-api';

import type { Query } from '@cardstack/runtime-common';

interface Sig {
  Args: { query: Query; realms: string[]; context?: CardContext };
  Element: HTMLElement;
}

export class TypeOnlyList extends GlimmerComponent<Sig> {
  <template>
    <@context.prerenderedCardSearchComponent
      @query={{@query}}
      @realms={{@realms}}
      @isLive={{true}}
    >
      <:response as |cards|>
        {{#each cards key='url' as |card|}}
          <card.component />
        {{/each}}
      </:response>
    </@context.prerenderedCardSearchComponent>
  </template>
}
`;

// The result array is handed to a child component instead of being iterated
// directly — the child still expects the old PrerenderedCardLike shape, so this
// can't be reshaped mechanically and must be reported for hand migration.
const COMPLEX_PASSES_CARDS = `import GlimmerComponent from '@glimmer/component';

import { type CardContext } from 'https://cardstack.com/base/card-api';
import { type Query } from '@cardstack/runtime-common';

import TableView from './table-view';

interface Sig {
  Args: { query: Query; realms: string[]; context?: CardContext };
  Element: HTMLElement;
}

export class AppGrid extends GlimmerComponent<Sig> {
  <template>
    <@context.prerenderedCardSearchComponent
      @query={{@query}}
      @format='fitted'
      @realms={{@realms}}
      @isLive={{true}}
    >
      <:loading>Loading...</:loading>
      <:response as |cards|>
        <TableView @cards={{cards}} />
      </:response>
    </@context.prerenderedCardSearchComponent>
  </template>
}
`;

// The body reaches into per-card fields (`cardType`, `iconHtml`) that live under
// `entry.html` in the search-entry shape — no safe mechanical mapping, so it's reported.
const COMPLEX_PER_CARD_FIELDS = `import GlimmerComponent from '@glimmer/component';

import { type CardContext } from 'https://cardstack.com/base/card-api';
import { type Query } from '@cardstack/runtime-common';

interface Sig {
  Args: { query: Query; realms: string[]; context?: CardContext };
  Element: HTMLElement;
}

export class CardList extends GlimmerComponent<Sig> {
  <template>
    <@context.prerenderedCardSearchComponent
      @query={{@query}}
      @format='fitted'
      @realms={{@realms}}
      @isLive={{true}}
    >
      <:response as |cards|>
        {{#each cards key='url' as |card|}}
          <li data-type={{card.cardType}}>
            {{card.iconHtml}}
            <card.component />
          </li>
        {{/each}}
      </:response>
    </@context.prerenderedCardSearchComponent>
  </template>
}
`;

// A dynamic `@format` (a passed-in `@arg`) — folded into the query getter and
// guarded by `isValidPrerenderedHtmlFormat`, mirroring base CardsGrid.
const DYNAMIC_FORMAT = `import GlimmerComponent from '@glimmer/component';

import { type CardContext } from 'https://cardstack.com/base/card-api';
import { type Query } from '@cardstack/runtime-common';

interface Sig {
  Args: { query: Query; realms: string[]; format: string; context?: CardContext };
  Element: HTMLElement;
}

export class Grid extends GlimmerComponent<Sig> {
  <template>
    <@context.prerenderedCardSearchComponent
      @query={{@query}}
      @format={{@format}}
      @realms={{@realms}}
    >
      <:response as |cards|>
        {{#each cards key='url' as |card|}}
          <card.component />
        {{/each}}
      </:response>
    </@context.prerenderedCardSearchComponent>
  </template>
}
`;

// Hands the whole list to a child AND reads `.length` — both adapt cleanly
// (the array adapter for the list, `results.entries.length` for the count).
const ARRAY_AND_LENGTH = `import GlimmerComponent from '@glimmer/component';

import { type CardContext } from 'https://cardstack.com/base/card-api';
import { type Query, type PrerenderedCardLike } from '@cardstack/runtime-common';

import TableView from './table-view';

interface Sig {
  Args: { query: Query; realms: string[]; context?: CardContext };
  Element: HTMLElement;
}

export class AppGrid extends GlimmerComponent<Sig> {
  <template>
    <@context.prerenderedCardSearchComponent @query={{@query}} @realms={{@realms}}>
      <:response as |cards|>
        {{#if cards.length}}
          <TableView @cards={{cards}} />
        {{/if}}
      </:response>
    </@context.prerenderedCardSearchComponent>
  </template>
}
`;

// Reads the result list through an arbitrary property path (`firstObject.url`)
// — can't adapt as a path, so it stays reported for hand migration.
const UNSUPPORTED_TAIL = `import GlimmerComponent from '@glimmer/component';

import { type CardContext } from 'https://cardstack.com/base/card-api';
import { type Query } from '@cardstack/runtime-common';

interface Sig {
  Args: { query: Query; realms: string[]; context?: CardContext };
  Element: HTMLElement;
}

export class Peek extends GlimmerComponent<Sig> {
  <template>
    <@context.prerenderedCardSearchComponent @query={{@query}} @realms={{@realms}}>
      <:response as |cards|>
        {{cards.firstObject.url}}
      </:response>
    </@context.prerenderedCardSearchComponent>
  </template>
}
`;

// No old affordance at all — must be left byte-for-byte untouched.
const NO_USAGE = `import GlimmerComponent from '@glimmer/component';

export class Plain extends GlimmerComponent {
  <template>
    <div>hello</div>
  </template>
}
`;

// One component bound once and invoked several times — each invocation has its
// own query/format and blocks. Every invocation must migrate, and the shared
// `(component @context.…)` binding must move to the search-entry member exactly once.
const MULTI_INVOCATION = `import GlimmerComponent from '@glimmer/component';

import { type CardContext } from 'https://cardstack.com/base/card-api';
import { type Query } from '@cardstack/runtime-common';

interface Sig {
  Args: { a: Query; b: Query; realms: string[]; context?: CardContext };
  Element: HTMLElement;
}

export class Board extends GlimmerComponent<Sig> {
  <template>
    {{#let (component @context.prerenderedCardSearchComponent) as |Search|}}
      <Search @query={{@a}} @format='fitted' @realms={{@realms}}>
        <:loading>Loading A…</:loading>
        <:response as |cards|>
          {{#each cards key='url' as |c|}}<c.component />{{/each}}
        </:response>
      </Search>
      <Search @query={{@b}} @format='embedded' @realms={{@realms}}>
        <:response as |cards|>
          {{#each cards key='url' as |c|}}<c.component />{{/each}}
        </:response>
      </Search>
    {{/let}}
  </template>
}
`;

// A usage with a <:meta> block — yields the same QueryResultsMeta search-entry exposes as
// results.meta, so it migrates to a {{#let results.meta as |m|}} wrapper.
const META_BLOCK = `import GlimmerComponent from '@glimmer/component';

import { type CardContext } from 'https://cardstack.com/base/card-api';
import { type Query } from '@cardstack/runtime-common';

interface Sig {
  Args: { query: Query; realms: string[]; context?: CardContext };
  Element: HTMLElement;
}

export class Counter extends GlimmerComponent<Sig> {
  <template>
    <@context.prerenderedCardSearchComponent @query={{@query}} @realms={{@realms}}>
      <:response as |cards|>
        {{#each cards key='url' as |c|}}<c.component />{{/each}}
      </:response>
      <:meta as |meta|>
        <span class='total'>{{meta.page.total}}</span>
      </:meta>
    </@context.prerenderedCardSearchComponent>
  </template>
}
`;

// A count-only usage: an empty (param-less) <:response> paired with a <:meta>
// count tile. The param-less response binds nothing, so it migrates verbatim
// (empty), and the meta carries the count.
const COUNT_ONLY = `import GlimmerComponent from '@glimmer/component';

import { type CardContext } from 'https://cardstack.com/base/card-api';
import { type Query } from '@cardstack/runtime-common';

interface Sig {
  Args: { query: Query; realms: string[]; context?: CardContext };
  Element: HTMLElement;
}

export class Tile extends GlimmerComponent<Sig> {
  <template>
    <@context.prerenderedCardSearchComponent @query={{@query}} @realms={{@realms}}>
      <:response></:response>
      <:meta as |meta|>
        <span class='count'>{{meta.page.total}}</span>
      </:meta>
    </@context.prerenderedCardSearchComponent>
  </template>
}
`;

// A usage gated behind an `{{#if @context.prerenderedCardSearchComponent}}`
// availability guard. The guard must move to the search-entry member alongside the usage.
const GUARDED = `import GlimmerComponent from '@glimmer/component';

import { type CardContext } from 'https://cardstack.com/base/card-api';
import { type Query } from '@cardstack/runtime-common';

interface Sig {
  Args: { query: Query; realms: string[]; context?: CardContext };
  Element: HTMLElement;
}

export class Guarded extends GlimmerComponent<Sig> {
  <template>
    {{#if @context.prerenderedCardSearchComponent}}
      <@context.prerenderedCardSearchComponent @query={{@query}} @realms={{@realms}}>
        <:response as |cards|>
          {{#each cards key='url' as |c|}}<c.component />{{/each}}
        </:response>
      </@context.prerenderedCardSearchComponent>
    {{else}}
      <p>not available</p>
    {{/if}}
  </template>
}
`;

// One invocation the codemod can migrate alongside one it can't (an unsupported
// :error block) — both on the same bound component. A half-migration would
// rewrite the first and re-point the shared binding, stranding the second next
// to a search-entry component it calls with the deprecated block API. The whole file must be left
// untouched instead.
const PARTIAL_MULTI_USAGE = `import GlimmerComponent from '@glimmer/component';

import { type CardContext } from 'https://cardstack.com/base/card-api';
import { type Query } from '@cardstack/runtime-common';

interface Sig {
  Args: { query: Query; realms: string[]; context?: CardContext };
  Element: HTMLElement;
}

export class Mixed extends GlimmerComponent<Sig> {
  <template>
    {{#let (component @context.prerenderedCardSearchComponent) as |Search|}}
      <Search @query={{@query}} @realms={{@realms}}>
        <:response as |cards|>
          {{#each cards key='url' as |c|}}<c.component />{{/each}}
        </:response>
      </Search>
      <Search @query={{@query}} @realms={{@realms}}>
        <:response as |cards|>{{cards.length}}</:response>
        <:error as |e|>{{e.message}}</:error>
      </Search>
    {{/let}}
  </template>
}
`;

// The member is captured into a TS getter and the template invokes it through
// \`this\` (\`this.args.context.…\`), a shape the template pass doesn't match. It
// must be flagged for hand migration, never silently reported as clean just
// because no \`@context.…\` usage was reshaped.
const UNRECOGNIZED_USAGE = `import GlimmerComponent from '@glimmer/component';

import { type Query } from '@cardstack/runtime-common';

interface Sig {
  Args: { query: Query; realms: string[] };
  Element: HTMLElement;
}

export class ViaThis extends GlimmerComponent<Sig> {
  get searchComponent() {
    return this.args.context?.prerenderedCardSearchComponent;
  }
  <template>
    {{#let (component this.searchComponent) as |Search|}}
      <Search @query={{@query}} @realms={{@realms}}>
        <:response as |cards|>{{cards.length}}</:response>
      </Search>
    {{/let}}
  </template>
}
`;

module(basename(import.meta.filename), function () {
  test('transforms a representative card: renames the component, reshapes the blocks, adds the query getter + import', function (assert) {
    let { status, output, reasons } = transformContextSearch(TRANSFORMABLE, {
      filename: 'grid.gts',
    });
    assert.strictEqual(status, 'transformed', reasons.join('; '));

    // component reference moves to the search-entry surface
    assert.true(
      output.includes('@context.searchResultsComponent'),
      'invokes @context.searchResultsComponent',
    );
    assert.false(
      output.includes('prerenderedCardSearchComponent'),
      'no reference to the deprecated component remains',
    );

    // a typed getter wraps the incoming deprecated query through the sanctioned adapter
    assert.true(
      /get searchResultsQuery\(\)\s*:\s*SearchEntryWireQuery/.test(output),
      'adds a typed searchResultsQuery getter',
    );
    assert.true(
      output.includes('searchEntryWireQueryFromQuery(this.args.query)'),
      'wraps the incoming query via the adapter',
    );
    assert.true(
      output.includes('realms: this.args.realms'),
      'carries @realms into the search-entry query',
    );
    assert.true(
      /import\s*\{[^}]*searchEntryWireQueryFromQuery[^}]*\}\s*from\s*['"]@cardstack\/runtime-common['"]/.test(
        output,
      ),
      'imports the adapter from @cardstack/runtime-common',
    );

    // query arg points at the getter; legacy args are dropped
    assert.true(
      output.includes('@query={{this.searchResultsQuery}}'),
      'the @query arg points at the new getter',
    );
    assert.false(/@format=/.test(output), 'drops @format');
    assert.false(/@realms=/.test(output), 'drops @realms');
    assert.false(/@isLive=/.test(output), 'drops @isLive');

    // named blocks collapse into the single default block
    assert.true(
      output.includes('as |results|'),
      'yields the default results block',
    );
    assert.true(
      output.includes('results.isLoading'),
      ':loading becomes {{#if results.isLoading}}',
    );
    assert.true(
      output.includes('results.entries'),
      ':response becomes {{#each results.entries}}',
    );
    // the author's loop variable is preserved (minimal churn); only the result
    // array source and the per-item `.url` field are remapped to the search-entry shape
    assert.true(
      output.includes('<card.component'),
      'the loop variable and <card.component /> invocation are preserved',
    );
    assert.true(output.includes('card.id'), 'card.url becomes card.id');
    assert.false(output.includes('card.url'), 'no card.url reference remains');
    assert.false(/<:loading>/.test(output), 'no named :loading block remains');
    assert.false(/<:response/.test(output), 'no named :response block remains');
  });

  test('binds a non-default @format through htmlQuery (not a bare eq.format)', function (assert) {
    let { status, output, reasons } = transformContextSearch(
      TRANSFORMABLE_EMBEDDED,
      { filename: 'embedded-list.gts' },
    );
    assert.strictEqual(status, 'transformed', reasons.join('; '));
    assert.true(
      /htmlQuery:\s*\{\s*eq:\s*\{\s*format:\s*'embedded'\s*\}\s*\}/.test(
        output,
      ),
      'embedded format is bound through htmlQuery',
    );
    assert.false(
      /eq:\s*\{[^}]*\bformat:\s*'embedded'/.test(
        output.replace(
          /htmlQuery:\s*\{\s*eq:\s*\{\s*format:\s*'embedded'\s*\}\s*\}/,
          '',
        ),
      ),
      'no bare eq.format escapes the htmlQuery binding',
    );
  });

  test('does not corrupt a declaration-level type-only runtime-common import', function (assert) {
    let { status, output, reasons } = transformContextSearch(
      TRANSFORMABLE_TYPE_ONLY_IMPORT,
      { filename: 'type-only.gts' },
    );
    assert.strictEqual(status, 'transformed', reasons.join('; '));
    assert.true(
      /import type \{\s*Query\s*\} from '@cardstack\/runtime-common'/.test(
        output,
      ),
      'leaves the existing import type { Query } intact',
    );
    assert.true(
      /import\s+\{[^}]*searchEntryWireQueryFromQuery[^}]*\}\s+from\s+'@cardstack\/runtime-common'/.test(
        output,
      ),
      'adds the adapter via a separate value import',
    );
    assert.false(
      /import type \{[^}]*searchEntryWireQueryFromQuery/.test(output),
      'the adapter is never imported type-only',
    );
  });

  test('is idempotent — a second run is a no-op', function (assert) {
    let once = transformContextSearch(TRANSFORMABLE, { filename: 'grid.gts' });
    let twice = transformContextSearch(once.output, { filename: 'grid.gts' });
    assert.strictEqual(
      twice.status,
      'unchanged',
      'second run reports no change',
    );
    assert.strictEqual(
      twice.output,
      once.output,
      'output is stable across runs',
    );
  });

  test('migrates a usage that hands the result array to a child component via the array adapter', function (assert) {
    let { status, output, reasons } = transformContextSearch(
      COMPLEX_PASSES_CARDS,
      {
        filename: 'app-card.gts',
      },
    );
    assert.strictEqual(status, 'transformed', reasons.join('; '));
    assert.notOk(
      output.includes('prerenderedCardSearchComponent'),
      'old member removed',
    );
    assert.true(
      output.includes('@context.searchResultsComponent'),
      'uses the search-entry member',
    );
    assert.true(
      output.includes('searchEntriesToPrerenderedCards'),
      `child receives the adapted array: ${output}`,
    );
    assert.true(
      /function searchEntriesToPrerenderedCards\b/.test(output),
      `emits the adapter as a module-local function: ${output}`,
    );
    assert.notOk(
      /import\s*\{[^}]*searchEntriesToPrerenderedCards/.test(output),
      'does not import the adapter from runtime-common',
    );
  });

  test('migrates a usage that reaches into legacy per-card fields via the array adapter', function (assert) {
    let { status, output, reasons } = transformContextSearch(
      COMPLEX_PER_CARD_FIELDS,
      {
        filename: 'card-list.gts',
      },
    );
    assert.strictEqual(status, 'transformed', reasons.join('; '));
    assert.notOk(output.includes('prerenderedCardSearchComponent'));
    assert.true(
      output.includes('searchEntriesToPrerenderedCards'),
      'wraps the rows in the legacy-shape adapter',
    );
    // The legacy field reads survive verbatim on the adapted rows.
    assert.true(/cardType/.test(output), `keeps the cardType read: ${output}`);
    assert.true(/iconHtml/.test(output), 'keeps the iconHtml read');
  });

  test('migrates a dynamic @format into a guarded query getter', function (assert) {
    let { status, output, reasons } = transformContextSearch(DYNAMIC_FORMAT, {
      filename: 'grid.gts',
    });
    assert.strictEqual(status, 'transformed', reasons.join('; '));
    assert.true(
      output.includes('isValidPrerenderedHtmlFormat(this.args.format)'),
      `guards the dynamic format: ${output}`,
    );
    assert.true(
      /htmlQuery:\s*\{\s*eq:\s*\{\s*format:\s*this\.args\.format/.test(output),
      'binds the dynamic format through htmlQuery',
    );
  });

  test('migrates a list passed to a child plus a `.length` read by binding the adapted list once', function (assert) {
    let { status, output, reasons } = transformContextSearch(ARRAY_AND_LENGTH, {
      filename: 'app-grid.gts',
    });
    assert.strictEqual(status, 'transformed', reasons.join('; '));
    assert.true(
      output.includes('searchEntriesToPrerenderedCards'),
      'binds the adapted array',
    );
    assert.true(
      output.includes('as |cards|'),
      `binds the adapted list to the original param: ${output}`,
    );
    // The body stays verbatim on the bound list — `.length` and the child
    // hand-off both read the legacy-shape `cards`.
    assert.true(output.includes('cards.length'), 'keeps the `.length` read');
    assert.true(
      output.includes('@cards={{cards}}'),
      'child still receives `cards`',
    );
  });

  test('migrates a list read through a property path by binding the adapted list', function (assert) {
    let { status, output, reasons } = transformContextSearch(UNSUPPORTED_TAIL, {
      filename: 'peek.gts',
    });
    assert.strictEqual(status, 'transformed', reasons.join('; '));
    assert.notOk(output.includes('prerenderedCardSearchComponent'));
    assert.true(
      output.includes('searchEntriesToPrerenderedCards'),
      'binds the adapted array',
    );
    // The path rides on the adapted (legacy-shape) list, so `.url` resolves.
    assert.true(
      output.includes('cards.firstObject.url'),
      `keeps the property path on the adapted list: ${output}`,
    );
  });

  test('leaves a file without the deprecated component untouched', function (assert) {
    let { status, output } = transformContextSearch(NO_USAGE, {
      filename: 'plain.gts',
    });
    assert.strictEqual(status, 'unchanged');
    assert.strictEqual(output, NO_USAGE, 'byte-for-byte unchanged');
  });

  test('migrates a component bound once and invoked several times, re-pointing the binding once', function (assert) {
    let { status, output, reasons } = transformContextSearch(MULTI_INVOCATION, {
      filename: 'board.gts',
    });
    assert.strictEqual(status, 'transformed', reasons.join('; '));
    assert.notOk(
      output.includes('prerenderedCardSearchComponent'),
      'no old member remains',
    );
    assert.strictEqual(
      output.match(/searchResultsComponent/g)?.length,
      1,
      'the shared binding is re-pointed exactly once',
    );
    assert.strictEqual(
      output.match(/get searchResultsQuery\b/g)?.length,
      1,
      'first invocation gets the base getter',
    );
    assert.true(
      /get searchResultsQuery2\b/.test(output),
      'second invocation gets its own getter',
    );
    assert.false(/<:response/.test(output), 'no :response blocks remain');
  });

  test('migrates a <:meta> block to a results.meta let-wrapper', function (assert) {
    let { status, output, reasons } = transformContextSearch(META_BLOCK, {
      filename: 'counter.gts',
    });
    assert.strictEqual(status, 'transformed', reasons.join('; '));
    assert.true(
      /\{\{#let\s+results\.meta\s+as\s+\|meta\|\}\}/.test(output),
      `binds results.meta to the block param: ${output}`,
    );
    assert.true(
      output.includes('meta.page.total'),
      'the meta body reads the same shape verbatim',
    );
    assert.false(/<:meta/.test(output), 'no :meta block remains');
  });

  test('migrates a count-only usage (empty <:response> + <:meta>)', function (assert) {
    let { status, output, reasons } = transformContextSearch(COUNT_ONLY, {
      filename: 'tile.gts',
    });
    assert.strictEqual(status, 'transformed', reasons.join('; '));
    assert.notOk(output.includes('prerenderedCardSearchComponent'));
    assert.true(
      /\{\{#let\s+results\.meta\s+as\s+\|meta\|\}\}/.test(output),
      'keeps the count via results.meta',
    );
    assert.notOk(
      output.includes('searchEntriesToPrerenderedCards'),
      'no adapter needed — the param-less response binds nothing',
    );
    assert.false(/<:response/.test(output), 'no :response block remains');
  });

  test('rewrites an {{#if @context.…}} availability guard to the search-entry member', function (assert) {
    let { status, output, reasons } = transformContextSearch(GUARDED, {
      filename: 'guarded.gts',
    });
    assert.strictEqual(status, 'transformed', reasons.join('; '));
    assert.notOk(
      output.includes('prerenderedCardSearchComponent'),
      'the guard no longer references the old member',
    );
    assert.true(
      /\{\{#if\s+@context\.searchResultsComponent\}\}/.test(output),
      `the guard tracks the search-entry member: ${output}`,
    );
  });

  test('leaves a partially-migratable file entirely untouched rather than emit a half-migration', function (assert) {
    let { status, output, reasons } = transformContextSearch(
      PARTIAL_MULTI_USAGE,
      { filename: 'mixed.gts' },
    );
    assert.strictEqual(status, 'skipped', 'not reported as transformed');
    assert.strictEqual(
      output,
      PARTIAL_MULTI_USAGE,
      'byte-for-byte unchanged — no partial edits written',
    );
    assert.true(reasons.length > 0, 'reported for hand migration');
    assert.true(
      output.includes('prerenderedCardSearchComponent'),
      'the un-migratable usage is left in place, not stranded by a partial edit',
    );
  });

  test('flags an unrecognized usage shape for hand migration instead of silently calling it clean', function (assert) {
    let { status, output, reasons } = transformContextSearch(
      UNRECOGNIZED_USAGE,
      { filename: 'via-this.gts' },
    );
    assert.notStrictEqual(
      status,
      'unchanged',
      'a surviving member is never reported as unchanged',
    );
    assert.strictEqual(status, 'skipped');
    assert.strictEqual(output, UNRECOGNIZED_USAGE, 'left untouched');
    assert.true(
      reasons.length > 0,
      'surfaces a reason so the file is not silently skipped',
    );
  });
});
