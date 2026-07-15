import {
  CardDef,
  field,
  contains,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { codeRef, realmURL } from '@cardstack/runtime-common';

// Sketch — your TeacherLog is defined in ./teacher-log:
class TeacherLog extends CardDef {
  static displayName = 'Teacher Log';
  @field studentLink = linksTo(() => Student);
  @field note = contains(StringField);
}

// 🧩 PATTERN: Linked-to-me lookup from CardDef.isolated
//
// The card finds its inbound references and renders them. The query is
// live-tracked — when new TeacherLogs are added to the realm, the list
// updates automatically.
//
// IMPORTANT: `getCards` is NOT exported as a value from `card-api`. Only
// the *type* is exported (line 72 of card-api.gts). The runtime value
// comes from the rendering context — `this.args.context?.getCards(...)`.
// Importing `getCards` as a value will compile cleanly (TS sees the type)
// and then explode at runtime with "getCards is not a function".

export class Student extends CardDef {
  static displayName = 'Student';

  @field firstName = contains(StringField);
  @field lastName  = contains(StringField);

  static isolated = class extends Component<typeof Student> {
    // context.getCards returns a SearchResource (a tracked object).
    // .instances is the array of CardDefs, updated reactively.
    logsQuery = this.args.context?.getCards(
      this,
      () => {
        const model = this.args.model;
        if (!model?.id) return undefined;
        const teacherLogRef = codeRef(import.meta.url, './teacher-log', 'TeacherLog');
        return {
          filter: {
            on: teacherLogRef,
            eq: { 'studentLink.id': model.id },
          },
        };
      },
      () => {
        const model = this.args.model;
        // realmURL is a Symbol imported from @cardstack/runtime-common.
        // Do NOT use Symbol.for('realmURL') — that creates a DIFFERENT
        // Symbol from the one the host injected onto the card, and the
        // query silently returns zero rows.
        const realm = model?.[realmURL];
        return realm ? [String(realm)] : undefined;
      },
      { isLive: true },
    );

    get logs() {
      return (this.logsQuery?.instances ?? []) as TeacherLog[];
    }

    get isLoading() {
      return this.logsQuery?.isLoading ?? true;
    }

    <template>
      <article class='student'>
        <h1>{{@model.firstName}} {{@model.lastName}}</h1>

        <section class='logs'>
          <h2>Teacher Logs</h2>
          {{#if this.isLoading}}
            <p>Loading logs…</p>
          {{else if this.logs.length}}
            <ul>
              {{#each this.logs as |teacherLog|}}
                <li>{{teacherLog.note}}</li>
              {{/each}}
            </ul>
          {{else}}
            <p>No logs yet.</p>
          {{/if}}
        </section>
      </article>
    </template>
  };
}

// --- Reminder: schema-level alternative ---
//
// For most "show my children" cases, prefer a query-backed linksToMany on
// the schema instead of doing this in a component. The host runs it at
// index time, the relationship is queryable from outside, and you get
// computeVia aggregates for free. See Option A in the README.
//
//   @field logs = linksToMany(TeacherLog, {
//     query: {
//       filter: {
//         on: { module: new URL('./teacher-log', import.meta.url).href, name: 'TeacherLog' },
//         eq: { 'studentLink.id': '$this.id' },
//       },
//     },
//   });
//
// Use the component-side pattern (above) only when you need:
//   - Live updates while the user is staring at the page, OR
//   - A query whose filter depends on tracked UI state, OR
//   - An imperative refresh hook
