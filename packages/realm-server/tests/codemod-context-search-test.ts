import { module, test } from 'qunit';
import { basename } from 'path';

import { transformContextSearch } from '../scripts/codemod/context-search/transform';

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
// `entry.html` in the v2 shape — no safe mechanical mapping, so it's reported.
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

// No old affordance at all — must be left byte-for-byte untouched.
const NO_USAGE = `import GlimmerComponent from '@glimmer/component';

export class Plain extends GlimmerComponent {
  <template>
    <div>hello</div>
  </template>
}
`;

module(basename(__filename), function () {
  test('transforms a representative card: renames the component, reshapes the blocks, adds the query getter + import', function (assert) {
    let { status, output, reasons } = transformContextSearch(TRANSFORMABLE, {
      filename: 'grid.gts',
    });
    assert.strictEqual(status, 'transformed', reasons.join('; '));

    // component reference moves to the v2 surface
    assert.true(
      output.includes('@context.searchResultsComponent'),
      'invokes @context.searchResultsComponent',
    );
    assert.false(
      output.includes('prerenderedCardSearchComponent'),
      'no reference to the deprecated component remains',
    );

    // a typed getter wraps the incoming v1 query through the sanctioned adapter
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
      'carries @realms into the v2 query',
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
    // array source and the per-item `.url` field are remapped to the v2 shape
    assert.true(
      output.includes('<card.component'),
      'the loop variable and <card.component /> invocation are preserved',
    );
    assert.true(output.includes('card.id'), 'card.url becomes card.id');
    assert.false(output.includes('card.url'), 'no card.url reference remains');
    assert.false(/<:loading>/.test(output), 'no named :loading block remains');
    assert.false(/<:response/.test(output), 'no named :response block remains');
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

  test('reports (does not transform) a usage that hands the result array to a child component', function (assert) {
    let { status, reasons, output } = transformContextSearch(
      COMPLEX_PASSES_CARDS,
      {
        filename: 'app-card.gts',
      },
    );
    assert.strictEqual(status, 'skipped');
    assert.true(
      reasons.some((r) => /child component|passed|iterate/i.test(r)),
      `reason explains why: ${reasons.join('; ')}`,
    );
    assert.true(
      output.includes('prerenderedCardSearchComponent'),
      'left untouched for hand migration',
    );
  });

  test('reports a usage that reaches into per-card fields with no v2 mapping', function (assert) {
    let { status, reasons } = transformContextSearch(COMPLEX_PER_CARD_FIELDS, {
      filename: 'card-list.gts',
    });
    assert.strictEqual(status, 'skipped');
    assert.true(
      reasons.some((r) => /cardType|iconHtml|hasHtml|field/i.test(r)),
      `reason names the unsupported field(s): ${reasons.join('; ')}`,
    );
  });

  test('leaves a file without the deprecated component untouched', function (assert) {
    let { status, output } = transformContextSearch(NO_USAGE, {
      filename: 'plain.gts',
    });
    assert.strictEqual(status, 'unchanged');
    assert.strictEqual(output, NO_USAGE, 'byte-for-byte unchanged');
  });
});
