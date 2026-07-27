import { CardDef, Component } from 'https://cardstack.com/base/card-api';
import {
  codeRef,
  realmURL,
  searchEntryWireQueryFromQuery,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

// 🧩 PATTERN: For a display list, render the prerendered result stream —
// do NOT hydrate live instances.
//
// A card that shows a *list* of other cards has two families of APIs, split
// by cost:
//
//   CHEAP  → @context.searchResultsComponent renders the prerendered `entry`
//            stream: inert HTML, hydrated lazily only when a row is interacted
//            with. No server loadLinks, no serialization, no Store hydration
//            until a row is opened. This is the default for any list / grid /
//            feed / roster the user only looks at. (The base CardList /
//            CardsGrid components wrap this same surface.)
//
//   COSTLY → getCards / getCardCollection (reactive) and store.search
//            (imperative) return live CardDef instances. Each one triggers
//            server-side loadLinks + serialization + Store hydration for EVERY
//            matching row — even the rows the user never opens. Reserve these
//            for genuine read/mutate needs (reading a field off each row,
//            editing, computing a rollup), never for "I just want to show
//            them".
//
// Resolve a single live instance only when a row is actually opened.

// @ts-expect-error import.meta is host-supported
const here: string = import.meta.url;

export class Directory extends CardDef {
  static displayName = 'Directory';

  static isolated = class Isolated extends Component<typeof Directory> {
    // Build an entry-rooted query from an ordinary query, then scope it to the
    // realm this card lives in. `realmURL` is the Symbol the host injects —
    // import it from runtime-common; never Symbol.for('realmURL').
    get listQuery(): SearchEntryWireQuery {
      let realm = this.args.model?.[realmURL]?.href;
      return {
        ...searchEntryWireQueryFromQuery({
          filter: { type: codeRef(here, './contact', 'Contact') },
          sort: [{ by: 'cardTitle', direction: 'asc' }],
        }),
        realms: realm ? [realm] : [], // current realm only
      };
    }

    <template>
      {{! ✅ DEFAULT — display list via the prerendered stream (cheap). }}
      <ul class='contacts'>
        <@context.searchResultsComponent
          @query={{this.listQuery}}
          @mode='hover'
          as |results|
        >
          {{#each results.entries key='id' as |entry|}}
            <li><entry.component /></li>
          {{else}}
            <li>{{if results.isLoading 'Loading…' 'No contacts yet'}}</li>
          {{/each}}
        </@context.searchResultsComponent>
      </ul>

      <style scoped>
        .contacts { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
      </style>
    </template>
  };
}

// === When you GENUINELY need the instances (read a field, mutate, roll up) ===
//
// Only then reach for a hydrating getter — and scope it to the CURRENT realm so
// you hydrate one realm's worth of rows, not the whole federation. Passing the
// current realm (via the realmURL Symbol) is the load-bearing part.
//
//   class WithData extends Component<typeof Directory> {
//     get realms(): string[] {
//       let realm = this.args.model?.[realmURL]?.href;
//       return realm ? [realm] : []; // current realm only — NOT every realm
//     }
//
//     // reactive: .instances is CardDef[], .isLoading flips while loading
//     contacts = this.args.context?.getCards(
//       this,
//       () => ({ filter: { type: codeRef(here, './contact', 'Contact') } }),
//       () => this.realms,
//       { isLive: true },
//     );
//
//     // imperative one-shot alternative: this.args.context?.store.search(...)
//     // returns instances directly — scope it to this.realms the same way.
//   }
//
// Rule of thumb: if the template only *renders* each row, you do not need the
// instance — use the prerendered stream above.
