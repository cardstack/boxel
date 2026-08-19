---
validated: source-proven
---

# organize-typed-activity-feed — One base `FeedEntry` CardDef + N specialized subclasses that compose freely

**What this gives you:** A typed feed where each entry is a discriminated subtype (`AcademicEntry`, `BehavioralEntry`, `SocialEntry`, etc.) sharing a base `FeedEntry` CardDef. The base owns the shared fields (subject, actor, timestamp, content, AI interpretation, relationships); each subclass adds its own specialized fields. Queries can be against the base (all entries, mixed types) OR a specific subtype (just academic entries). One template — the base's — handles the common card chrome; subtypes override only what's specific.

**When to use:**
- **Activity feeds, audit logs, journals.** When events fall into 3–8 stable categories that share common metadata (who/when/what category) but differ in their specifics.
- **CRM interaction feeds** (call, email, meeting, note).
- **Education / clinical journals** (academic note, behavioral observation, social interaction, curriculum progress).
- **DevOps event streams** (deploy, incident, rollback, postmortem).
- **Anything modeled today as a single `Entry` CardDef with a giant `kind` enum** and conditional rendering based on `kind`. The conditional rendering is the smell; subclasses replace it.

Don't use for one-off variants — `polymorphic-field-subclass` is the right call when the variant is a **slot inside one card** (a Shape that's Circle or Square). Don't use when the categories are unstable / change weekly — an enum + conditional is more pliable.

**The insight:** Boxel CardDefs support inheritance: `class AcademicEntry extends FeedEntry` is a real CardDef that *is-a* `FeedEntry`. The realm indexer tracks both — querying `filter: { type: codeRef(here, './feed', 'FeedEntry') }` returns every subtype; querying `filter: { type: codeRef(here, './feed', 'AcademicEntry') }` returns only that one. So you get one polymorphic stream + N typed-and-filtered views from the same data model, without an enum dispatch.

The base CardDef declares the common surface:

- `subject = linksTo(SubjectCard)` — who/what the entry is about
- `actor = linksTo(ActorCard)` — who created it
- `timestamp = contains(DatetimeField)`
- `category = contains(CategoryEnum)` (a redundant denormalization for fast filtering — `type` filter is exact, `category` filter is fuzzier)
- `content = contains(MarkdownField)` — raw note
- `aiInterpretation = contains(MarkdownField)` — optional structured/AI-summarized version
- `isAIGenerated = contains(BooleanField)`
- `relatedGoals = linksToMany(GoalCard)` — domain-specific cross-link
- Computed: `timeAgo`, `cardTitle`

The base owns the `isolated` / `embedded` / `fitted` views — the chrome of "who, when, what category, content" with appropriate format-density. Subclasses override only the body slot where their specialized fields go.

## Recipe shape

```ts
// activity-feed.gts
import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import DatetimeField from 'https://cardstack.com/base/datetime';
import MarkdownField from 'https://cardstack.com/base/markdown';

import { FeedCategory, /* domain enums */ } from './enums';
import { Subject } from './subject';
import { Actor } from './actor';
import { Goal } from './goal';

// ─── Base ───────────────────────────────────────────────────────────
export class FeedEntry extends CardDef {
  static displayName = 'Feed Entry';

  @field subject   = linksTo(() => Subject);
  @field actor     = linksTo(() => Actor);
  @field timestamp = contains(DatetimeField);
  @field category  = contains(FeedCategory);

  @field content          = contains(MarkdownField);
  @field aiInterpretation = contains(MarkdownField);
  @field isAIGenerated    = contains(BooleanField);

  @field relatedGoals = linksToMany(() => Goal);

  @field timeAgo = contains(StringField, {
    computeVia: function (this: FeedEntry) {
      if (!this.timestamp) return '';
      const diffMs = Date.now() - new Date(this.timestamp).getTime();
      const m = Math.floor(diffMs / 60_000);
      if (m < 1) return 'just now';
      if (m < 60) return `${m}m ago`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h ago`;
      return `${Math.floor(h / 24)}d ago`;
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: FeedEntry) {
      const cat = this.category?.value || 'Entry';
      const subj = this.subject?.displayName || 'Unknown';
      return `${cat}: ${subj}`;
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='feed-isolated'>
        <header class='feed-header'>
          <div class='header-meta'>
            {{#if @model.category}}<@fields.category />{{/if}}
            {{#if @model.timeAgo}}<span class='time-ago'>{{@model.timeAgo}}</span>{{/if}}
            {{#if @model.isAIGenerated}}<span class='ai-badge'>AI</span>{{/if}}
          </div>
          <div class='header-people'>
            {{#if @model.subject}}
              <div class='person-card'>
                <span class='person-label'>Subject</span>
                <@fields.subject @format='fitted' />
              </div>
            {{/if}}
            {{#if @model.actor}}
              <div class='person-card'>
                <span class='person-label'>Actor</span>
                <@fields.actor @format='fitted' />
              </div>
            {{/if}}
          </div>
        </header>
        <section class='feed-content'>
          {{!-- Subclasses override this slot in their own isolated template --}}
          <@fields.content />
          {{#if @model.aiInterpretation}}
            <details class='ai-detail'>
              <summary>AI interpretation</summary>
              <@fields.aiInterpretation />
            </details>
          {{/if}}
        </section>
      </article>
    </template>
  };

  // embedded + fitted formats follow the same shape but compress the chrome
}

// ─── Subclasses ─────────────────────────────────────────────────────
// Each subclass adds its own typed body but inherits header chrome.
export class AcademicEntry extends FeedEntry {
  static displayName = 'Academic Entry';

  @field subjectArea  = contains(AcademicSubject);
  @field understanding = contains(UnderstandingLevel);
  @field scoreRecords  = containsMany(ScoreRecord);
  @field curriculumPosition = contains(CurriculumPosition);

  // To customize the body, override `static isolated` (or one of the
  // other formats); the base's chrome is duplicated, and only the body
  // slot needs to change. Or accept the base template and add an
  // `embedded` view that highlights subjectArea + understanding.
}

export class BehavioralEntry extends FeedEntry {
  static displayName = 'Behavioral Entry';

  @field behaviorType    = contains(BehaviorType);
  @field rating          = contains(BehaviorRating);
  @field interventionUsed = contains(StringField);
}

export class SocialEntry extends FeedEntry {
  static displayName = 'Social Entry';

  @field activityType  = contains(SocialActivityType);
  @field groupSize     = contains(GroupSize);
  @field quality       = contains(InteractionQuality);
  @field socialSkills  = containsMany(SocialSkill);
}
```

## Querying mixed vs typed

```ts
// All entries about a subject, mixed types, sorted by timestamp:
const allQuery = {
  filter: {
    every: [
      { type: codeRef(import.meta.url, './activity-feed', 'FeedEntry') },
      { on: codeRef(import.meta.url, './activity-feed', 'FeedEntry'),
        eq: { 'subject.id': subjectId } },
    ],
  },
  sort: [{ by: 'timestamp', on: codeRef(import.meta.url, './activity-feed', 'FeedEntry'), direction: 'desc' }],
};

// Only academic entries for this subject:
const academicOnly = {
  filter: {
    every: [
      { type: codeRef(import.meta.url, './activity-feed', 'AcademicEntry') },
      { on: codeRef(import.meta.url, './activity-feed', 'AcademicEntry'),
        eq: { 'subject.id': subjectId } },
    ],
  },
  sort: [{ by: 'timestamp', on: codeRef(import.meta.url, './activity-feed', 'AcademicEntry'), direction: 'desc' }],
};
```

Each subclass's `type` filter excludes the others; the base's `type` filter is inclusive (covers every subtype). This is the same realm-indexer rule that makes `organize-base-class-taxonomy` work — except here the base also has fields, not just an abstract marker.

## Picking the base vs the subclass

| You want… | Filter by |
|---|---|
| "Show me everything about this subject" — mixed-type feed | base `FeedEntry` |
| "Just academic notes this week" | `AcademicEntry` |
| Side-by-side breakdowns of category counts | `FeedCategory` enum on the base; `meta.page.total` of base + each subtype |
| A typed editor that only writes `BehavioralEntry` | `BehavioralEntry` |

The `category` enum is a denormalization of the type — it makes some filter shapes simpler (especially when the category value is "Other" rather than a typed subclass), and it lets the host UI label the chip without resolving the type ref. Keep both; they cost almost nothing and remove edge cases.

## Gotchas

- **Subclass fields live ON the subclass type, not on the base.** Querying `FeedEntry` then accessing `entry.understanding` is `undefined` — even if the row is actually an `AcademicEntry`. You have to filter by the typed subclass to get typed fields, or use `instanceOf` checks in your component.
- **The host renders the most-specific format.** If `AcademicEntry` doesn't override `static embedded`, it gets `FeedEntry.embedded`. Most subclasses only override `embedded` (where the body slot matters) and inherit `isolated` + `fitted` unchanged.
- **`linksTo` arrow-function reference.** When subclass + base + linked targets are in the same file (`activity-feed.gts` defines `FeedEntry` + 4 subclasses + imports `Subject`/`Actor`), use `linksTo(() => Subject)` to defer resolution and avoid circular-init issues.
- **The category enum gets stale.** When you add a new subclass, you also have to add its category to the enum. Easy to forget; the realm doesn't complain. Cross-reference in a `// TYPE-ENUM-PAIRING` comment block at the top of the file so future-you sees them together.
- **Mixed-type sort by `timestamp`** needs `on: ref` (the custom-field-sort rule). Use the base `FeedEntry` as the `on` ref for the mixed query.
- **Template chrome duplication if subclasses override formats.** When a subclass overrides `static isolated`, it has to repeat (or compose) the base's header chrome. Two ways out: (a) accept the base format and only add an `embedded` override per subclass; (b) factor the header chrome into a `TemplateOnlyComponent` and have every subclass's isolated invoke it. (b) is `format-morph-shared-component`-adjacent — see that pattern.

## Source

- An `activity-feed.gts` card in the workspace, ~479 lines including base + 4 subclasses (Academic / Behavioral / Social / Curriculum), the timeAgo + cardTitle computations, and full `isolated` template chrome on the base.
- Common shape across multiple realms in the workspace that model journals / streams / typed event logs.

## See also

- [`organize-base-class-taxonomy`](../organize-base-class-taxonomy/README.md) — when the base has *no fields*, just the type marker. This pattern's base has fields too.
- [`polymorphic-field-subclass`](../polymorphic-field-subclass/README.md) — when the variant is a *slot inside one card* (FieldDef inheritance), not a feed-of-cards (CardDef inheritance).
- [`format-morph-shared-component`](../format-morph-shared-component/README.md) — for sharing template chrome across format/subclass boundaries.
- [`show-card-list-with-views`](../show-card-list-with-views/README.md) — feeds rendered through `@context.searchResultsComponent`; pass the base type to get mixed types, the subtype for filtered streams.
- [`boxel/references/query-systems.md`](../../../boxel/references/query-systems.md) — `every: [{ type }, { on, eq }]` composition; custom-field sorts.
