import GlimmerComponent from '@glimmer/component';
import { type CardContext } from 'https://cardstack.com/base/card-api';
import { type Query } from '@cardstack/runtime-common';
import { get } from '@ember/helper';

// 🧩 PATTERN: Generic field-table over Query + realm
//
// One component, any query. Caller passes the query + the columns to render.
//
// A per-field table needs the LIVE card instances (one <td> per column, reading
// each field's value), so this uses `context.getCards` — NOT the search-results
// or prerendered surfaces, which render whole cards and expose no addressable
// fields. `getCards` is only available via the rendering context; importing it
// as a value compiles (TS sees the type) but explodes at runtime with
// "getCards is not a function".

interface TableSignature {
  Args: {
    query: Query;
    realm: string;
    columns: string[];          // field names to render
    headers?: string[];         // optional header labels (defaults to columns)
    context?: CardContext;
  };
}

export class CardTable extends GlimmerComponent<TableSignature> {
  get headers(): string[] {
    return this.args.headers ?? this.args.columns;
  }

  // Live-tracked search over the realm. `.instances` is the reactive array of
  // CardDefs; `.isLoading` flips while the search runs.
  cards = this.args.context?.getCards(
    this,
    () => this.args.query,
    () => [this.args.realm],
    { isLive: true },
  );

  <template>
    <table class='card-table'>
      <thead>
        <tr>
          {{#each this.headers as |h|}}
            <th>{{h}}</th>
          {{/each}}
        </tr>
      </thead>
      <tbody>
        {{#if this.cards.isLoading}}
          <tr><td colspan={{@columns.length}}>Loading…</td></tr>
        {{else}}
          {{#each this.cards.instances as |card|}}
            <tr>
              {{#each @columns as |col|}}
                <td>{{get card col}}</td>
              {{/each}}
            </tr>
          {{else}}
            <tr><td colspan={{@columns.length}}>No results.</td></tr>
          {{/each}}
        {{/if}}
      </tbody>
    </table>
  </template>
}

// === Usage ============================================================
//
// import { Person } from './person';
//
// const personModule = new URL('./person', import.meta.url).href;
//
// <CardTable
//   @query={{hash filter=(hash on=(hash module=personModule name='Person'))}}
//   @realm='https://realms.example.com/team/'
//   @columns={{array 'firstName' 'lastName' 'email'}}
//   @headers={{array 'First' 'Last' 'Email'}}
//   @context={{@context}}
// />
