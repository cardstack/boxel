// Distilled example for `organize-typed-activity-feed`.
//
// One base `FeedEntry` CardDef + two subclass demonstrations
// (`AcademicEntry`, `BehavioralEntry`). Both inherit the base chrome
// (header with subject + actor + timestamp + category) and add their
// own specialized body fields.
//
// The full real-world implementation has 4–5 subclasses + richer
// enum-driven body sections; this example pulls out just the
// inheritance shape so the reader can adapt it to their domain.
import {
  CardDef,
  Component,
  FieldDef,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';
import DatetimeField from 'https://cardstack.com/base/datetime';
import MarkdownField from 'https://cardstack.com/base/markdown';

// Minimal "subject" + "actor" stand-ins. In a real domain these are
// the cards the feed is *about* (Subject) and *by* (Actor).
class Subject extends CardDef {
  static displayName = 'Subject';
  @field displayName = contains(StringField);
}
class Actor extends CardDef {
  static displayName = 'Actor';
  @field displayName = contains(StringField);
}

// Category enum (denormalized — also used for fast filtering).
class FeedCategory extends FieldDef {
  static displayName = 'Feed Category';
  @field value = contains(StringField); // 'academic' | 'behavioral' | 'social' | …
}

// ─── BASE: FeedEntry ────────────────────────────────────────────────
// Owns the shared surface and the header/footer chrome.
export class FeedEntry extends CardDef {
  static displayName = 'Feed Entry';

  @field subject   = linksTo(() => Subject);
  @field actor     = linksTo(() => Actor);
  @field timestamp = contains(DatetimeField);
  @field category  = contains(FeedCategory);

  @field content          = contains(MarkdownField);
  @field aiInterpretation = contains(MarkdownField);
  @field isAIGenerated    = contains(BooleanField);

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
          <@fields.content />
          {{#if @model.aiInterpretation}}
            <details class='ai-detail'>
              <summary>AI interpretation</summary>
              <@fields.aiInterpretation />
            </details>
          {{/if}}
        </section>
      </article>

      <style scoped>
        .feed-isolated { padding: 1.25rem; }
        .feed-header { display: flex; justify-content: space-between; align-items: start; gap: 1rem; margin-bottom: 1rem; }
        .header-meta { display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; }
        .time-ago { color: var(--muted-foreground, var(--boxel-600)); }
        .ai-badge {
          font-size: 0.6875rem; font-weight: 600;
          padding: 0.125rem 0.375rem; border-radius: 999px;
          background: var(--primary, var(--boxel-purple-100));
          color: var(--primary-foreground, var(--boxel-purple-900));
        }
        .header-people { display: flex; gap: 0.5rem; }
        .person-card { display: flex; flex-direction: column; gap: 0.25rem; }
        .person-label { font-size: 0.75rem; color: var(--muted-foreground, var(--boxel-600)); }
        .ai-detail { margin-top: 0.5rem; }
      </style>
    </template>
  };
}

// ─── Subclass: AcademicEntry ────────────────────────────────────────
// Adds typed fields about the academic context. Inherits FeedEntry's
// `isolated` view; overrides `embedded` to surface its specialized
// fields in feed strips.
export class AcademicEntry extends FeedEntry {
  static displayName = 'Academic Entry';

  @field subjectArea  = contains(StringField); // e.g. 'Algebra II'
  @field understanding = contains(StringField); // 'mastered' | 'developing' | 'struggling'
  @field score         = contains(NumberField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <article class='feed-embedded academic'>
        <div class='row'>
          <span class='kind'>Academic</span>
          {{#if @model.timeAgo}}<span class='time-ago'>{{@model.timeAgo}}</span>{{/if}}
        </div>
        <div class='row'>
          {{#if @model.subjectArea}}<span class='chip'>{{@model.subjectArea}}</span>{{/if}}
          {{#if @model.understanding}}<span class='chip understanding'>{{@model.understanding}}</span>{{/if}}
          {{#if @model.score}}<span class='chip score'>{{@model.score}}%</span>{{/if}}
        </div>
        <@fields.content />
      </article>

      <style scoped>
        .feed-embedded { padding: 0.75rem 1rem; border-bottom: 1px solid var(--border, var(--boxel-200)); }
        .row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
        .kind { font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; }
        .time-ago { font-size: 0.75rem; color: var(--muted-foreground, var(--boxel-600)); margin-left: auto; }
        .chip { padding: 0.125rem 0.5rem; border-radius: 999px; font-size: 0.75rem; background: var(--boxel-100); }
        .chip.understanding { background: var(--primary, var(--boxel-purple-100)); color: var(--primary-foreground, var(--boxel-purple-900)); }
        .chip.score { font-variant-numeric: tabular-nums; }
      </style>
    </template>
  };
}

// ─── Subclass: BehavioralEntry ──────────────────────────────────────
export class BehavioralEntry extends FeedEntry {
  static displayName = 'Behavioral Entry';

  @field behaviorType    = contains(StringField); // 'positive' | 'concerning' | 'neutral'
  @field rating          = contains(NumberField); // 1–5 scale
  @field interventionUsed = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <article class='feed-embedded behavioral'>
        <div class='row'>
          <span class='kind'>Behavioral</span>
          {{#if @model.timeAgo}}<span class='time-ago'>{{@model.timeAgo}}</span>{{/if}}
        </div>
        <div class='row'>
          {{#if @model.behaviorType}}<span class='chip behavior'>{{@model.behaviorType}}</span>{{/if}}
          {{#if @model.rating}}<span class='chip score'>{{@model.rating}}/5</span>{{/if}}
        </div>
        <@fields.content />
        {{#if @model.interventionUsed}}
          <p class='intervention'>Intervention: {{@model.interventionUsed}}</p>
        {{/if}}
      </article>

      <style scoped>
        .feed-embedded { padding: 0.75rem 1rem; border-bottom: 1px solid var(--border, var(--boxel-200)); }
        .row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
        .kind { font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; }
        .time-ago { font-size: 0.75rem; color: var(--muted-foreground, var(--boxel-600)); margin-left: auto; }
        .chip { padding: 0.125rem 0.5rem; border-radius: 999px; font-size: 0.75rem; background: var(--boxel-100); }
        .chip.behavior { background: var(--surface-2, var(--boxel-200)); }
        .chip.score { font-variant-numeric: tabular-nums; }
        .intervention { margin-top: 0.5rem; font-size: 0.875rem; color: var(--muted-foreground, var(--boxel-600)); }
      </style>
    </template>
  };
}
