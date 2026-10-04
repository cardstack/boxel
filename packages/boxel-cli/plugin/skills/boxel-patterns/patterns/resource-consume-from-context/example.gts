import {
  CardDef,
  Component,
  contains,
  containsMany,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { codeRef, realmURL, type Query } from '@cardstack/runtime-common';

// 🧩 PATTERN: Consume a @context resource by rendering straight off it.
//
// `getCards`, `getCard` and `getCardCollection` return RESOURCES, not promises.
// Their properties start empty and fill in as the data arrives; every read is
// tracked, so the template re-renders on its own when they change.
//
//   - Hold each resource as a class field (created once, owned by `this`).
//   - Read it from the template or from a getter — never copy it into @tracked.
//   - Gate on its own loading/error properties — never await it, `.then` it,
//     poll it on a timer, or read it from a constructor.
//
// The thunks (`() => …`) are the tracking boundary: whatever tracked value is
// read inside them re-runs the resource when it changes.

// @ts-expect-error import.meta is host-supported
const here: string = import.meta.url;
const skillRef = codeRef(here, './skill', 'Skill');

export class CourseOverview extends CardDef {
  static displayName = 'Course Overview';

  @field instructorId = contains(StringField);
  @field memberIds = containsMany(StringField);

  static isolated = class Isolated extends Component<typeof CourseOverview> {
    get realm(): string | undefined {
      return this.args.model?.[realmURL]?.href;
    }

    // ── getCards: a search. Filter and sort in the query, on the server.
    // `isLive: true` re-runs it as the realm's contents change; leave it off
    // for a list that does not need to follow writes.
    skills = this.args.context?.getCards(
      this,
      (): Query | undefined =>
        this.realm
          ? {
              filter: { type: skillRef },
              sort: [{ by: 'cardTitle', on: skillRef }],
            }
          : undefined, // no realm yet → hold the search, the resource stays idle
      () => (this.realm ? [this.realm] : undefined),
      { isLive: true },
    );

    // Derive with a getter over the resource. It re-runs whenever `instances`
    // changes — a copy into a @tracked field would freeze at the first value.
    get featuredSkills() {
      return (this.skills?.instances ?? []).slice(0, 3);
    }

    // A failed search looks like an empty one — no instances, `page.total` 0 —
    // except that `meta.incomplete` is set. It is also set when a realm the
    // search fanned out to did not answer, so the rows are a floor, not the
    // answer. Check it before reporting a count or "nothing here".
    get skillsIncomplete() {
      return Boolean(this.skills?.meta.incomplete);
    }

    get skillCount() {
      return this.skills?.meta.page.total ?? 0;
    }

    // ── getCard: one card by id. `isLoaded` is also true when the card
    // failed, so read `cardError` before trusting `card`. With no id,
    // `isLoaded` stays false forever — check your own input first, or the
    // template shows "Loading…" for a card that has none.
    instructor = this.args.context?.getCard(
      this,
      () => this.args.model?.instructorId ?? undefined,
    );

    get hasInstructor() {
      return Boolean(this.args.model?.instructorId);
    }

    // ── getCardCollection: many cards by id. Failures land in `cardErrors`,
    // not in `cards`. Pass `[]`, not `undefined`, for "no ids": an undefined
    // id list never loads, so `isLoaded` would stay false forever.
    members = this.args.context?.getCardCollection(
      this,
      () => this.args.model?.memberIds ?? [],
    );

    <template>
      <section>
        <h2>Instructor</h2>
        {{#if this.instructor.cardError}}
          <p>Couldn't load the instructor.</p>
        {{else if this.instructor.isLoaded}}
          <p>{{this.instructor.card.cardTitle}}</p>
        {{else if this.hasInstructor}}
          <p>Loading…</p>
        {{else}}
          <p>No instructor assigned.</p>
        {{/if}}
      </section>

      <section>
        <h2>Skills ({{this.skillCount}})</h2>
        {{#if this.skills.isLoading}}
          <p>Loading skills…</p>
        {{else if this.skillsIncomplete}}
          <p>Some skills couldn't be loaded.</p>
        {{else}}
          <ul>
            {{#each this.featuredSkills as |skill|}}
              <li>{{skill.cardTitle}}</li>
            {{else}}
              <li>No skills yet.</li>
            {{/each}}
          </ul>
        {{/if}}
      </section>

      <section>
        <h2>Members</h2>
        {{#if this.members.isLoaded}}
          <ul>
            {{#each this.members.cards as |member|}}
              <li>{{member.cardTitle}}</li>
            {{/each}}
          </ul>
          {{#if this.members.cardErrors.length}}
            <p>{{this.members.cardErrors.length}} members couldn't be loaded.</p>
          {{/if}}
        {{else}}
          <p>Loading members…</p>
        {{/if}}
      </section>
    </template>
  };
}

// === The shape to replace =============================================
//
// Each of these fights the resource instead of reading it:
//
//   @tracked skillCards: CardDef[] = [];
//   constructor(owner, args) {
//     super(owner, args);
//     let res = this.args.context?.getCards(this, () => query, () => realms);
//     waitForResource(res)                 // polls res.isLoading on a timer
//       .then((cards) => (this.skillCards = cards)) // snapshot: stops updating
//       .catch(() => {});                  // and the error is gone
//   }
//
// → one class field holding the resource, read from the template (above).
//
// A genuinely one-shot read inside a click handler or command, where nothing
// renders from the result, uses the promise API instead:
//   let cards = await this.args.context?.store.search(query, [this.realm]);
//   let card = await this.args.context?.store.get(id); // card OR its error
