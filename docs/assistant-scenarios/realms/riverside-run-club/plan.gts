// The autumn relaunch plan, and the one tool that writes it. The plan
// takes its colour from its own accent field, so a change the assistant
// makes is visible on the card as soon as it lands. SetPlanFieldsTool
// reports each change with its value before and after, which the
// assistant transcript shows as a change table.
import { Tool } from '@cardstack/runtime-common';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import {
  CardDef,
  Component,
  FieldDef,
  contains,
  containsMany,
  field,
  linksTo,
  linksToMany,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import ClipboardListIcon from '@cardstack/boxel-icons/clipboard-list';
import { htmlSafe } from '@ember/template';
import { Club } from './club';
import { PosterOption } from './poster';
import { Runner } from './runner';
import { safeColor } from './shared';

const UNSET_ACCENT = '#9aa3ad';

interface Decision {
  label: string;
  value: string;
  set: boolean;
  swatch?: string;
}

function decisionsOf(plan: RelaunchPlan): Decision[] {
  let accent = safeColor(plan.accent, '');
  return [
    {
      label: 'Poster',
      value: plan.poster?.title ?? 'not chosen yet',
      set: Boolean(plan.poster),
    },
    {
      label: 'Accent',
      value: plan.accentName ?? (accent || 'not chosen yet'),
      set: Boolean(accent),
      swatch: accent || undefined,
    },
    {
      label: 'Invite goes out',
      value: plan.sendDay ?? 'not chosen yet',
      set: Boolean(plan.sendDay),
    },
    {
      label: 'Relaunch run',
      value: plan.distance ?? 'not chosen yet',
      set: Boolean(plan.distance),
    },
    {
      label: 'Regulars',
      value: plan.regularsCount ? `${plan.regularsCount} invited first` : 'not picked yet',
      set: Boolean(plan.regularsCount),
    },
  ];
}

function planStyle(plan: RelaunchPlan) {
  return htmlSafe(`--accent: ${safeColor(plan.accent, UNSET_ACCENT)}`);
}

export class RelaunchPlan extends CardDef {
  static displayName = 'Relaunch plan';
  static icon = ClipboardListIcon;
  @field name = contains(StringField);
  @field club = linksTo(() => Club);
  @field poster = linksTo(() => PosterOption);
  @field accent = contains(StringField);
  // the accent's name as the reader chose it: "Lime"
  @field accentName = contains(StringField);
  @field sendDay = contains(StringField);
  // "5K", "10K" or "Relay"
  @field distance = contains(StringField);
  @field status = contains(StringField);
  @field regulars = linksToMany(() => Runner);
  @field regularsCount = contains(NumberField);
  @field decided = contains(NumberField, {
    computeVia: function (this: RelaunchPlan) {
      return decisionsOf(this).filter((d) => d.set).length;
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: RelaunchPlan) {
      return this.name ?? 'Relaunch plan';
    },
  });
  @field cardDescription = contains(StringField, {
    computeVia: function (this: RelaunchPlan) {
      let decided = decisionsOf(this).filter((d) => d.set).length;
      return [this.status, `${decided} of 5 decided`, this.poster?.title, this.sendDay]
        .filter(Boolean)
        .join(' · ');
    },
  });

  static atom = class Atom extends Component<typeof RelaunchPlan> {
    get style() {
      return planStyle(this.args.model as RelaunchPlan);
    }
    <template>
      <span class='plan-atom' style={{this.style}}>
        <span class='dot' aria-hidden='true'></span>
        <span class='name'>{{@model.name}}</span>
      </span>
      <style scoped>
        .plan-atom {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-width: 0;
          max-width: 100%;
        }
        .dot {
          flex: none;
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--accent);
          box-shadow: 0 0 0 1px rgb(13 21 34 / 25%);
        }
        .name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof RelaunchPlan> {
    get style() {
      return planStyle(this.args.model as RelaunchPlan);
    }
    get decisions() {
      return decisionsOf(this.args.model as RelaunchPlan);
    }
    <template>
      <div class='fit-frame'>
        <div class='plan-fit' style={{this.style}}>
        <div class='poster'>
          {{#if @model.poster}}
            <@fields.poster @format='fitted' />
          {{else}}
            <span class='blank'>Poster</span>
          {{/if}}
        </div>
        <div class='words'>
          <span class='status'>{{@model.status}}</span>
          <span class='name'>{{@model.name}}</span>
          <span class='ticks' aria-label='{{@model.decided}} of 5 decided'>
            {{#each this.decisions as |d|}}<i class={{if d.set 'on'}}></i>{{/each}}
            <b>{{@model.decided}}/5</b>
          </span>
        </div>
      </div>
      </div>
      <style scoped>
        .fit-frame {
          container: plan-fit / size;
          height: 100%;
        }
        .plan-fit {
          height: 100%;
          box-sizing: border-box;
          display: grid;
          grid-template-columns: auto 1fr;
          background: #f4f1ea;
          color: #0d1522;
          border-bottom: 4px solid var(--accent);
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
          overflow: hidden;
        }
        .poster {
          display: grid;
          width: 30cqh;
          min-width: 44px;
          max-width: 110px;
          background: repeating-linear-gradient(135deg, #e2ddd2 0 6px, #ebe6dc 6px 12px);
        }
        .poster > :deep(*) {
          height: 100%;
        }
        .blank {
          display: grid;
          place-items: center;
          height: 100%;
          font: 600 9px 'JetBrains Mono', ui-monospace, monospace;
          text-transform: uppercase;
          color: #67707d;
        }
        .words {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 3px;
          min-width: 0;
          padding: 8px 12px;
        }
        .status {
          font: 600 10px/14px 'JetBrains Mono', ui-monospace, monospace;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #67707d;
        }
        .name {
          font: 900 20px/0.95 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 68%;
          text-transform: uppercase;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ticks {
          display: flex;
          align-items: center;
          gap: 3px;
        }
        .ticks i {
          width: 14px;
          height: 4px;
          border-radius: 2px;
          background: #d9d3c7;
        }
        .ticks i.on {
          background: var(--accent);
          box-shadow: inset 0 0 0 1px rgb(13 21 34 / 20%);
        }
        .ticks b {
          margin-inline-start: 4px;
          font: 600 10px/1 'JetBrains Mono', ui-monospace, monospace;
        }
        .blank {
          display: none;
        }
        /* a tall tile: the poster on top, the plan under it */
        @container plan-fit (height >= 110px) {
          .plan-fit {
            grid-template: 1fr auto / 1fr;
          }
          .poster {
            width: auto;
            max-width: none;
          }
          .blank {
            display: grid;
          }
          .name {
            white-space: normal;
          }
        }
        @container plan-fit (height < 56px) {
          .status,
          .ticks {
            display: none;
          }
          .name {
            font-size: 16px;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof RelaunchPlan> {
    get style() {
      return planStyle(this.args.model as RelaunchPlan);
    }
    get decisions() {
      return decisionsOf(this.args.model as RelaunchPlan);
    }
    <template>
      <div class='embed-frame'>
        <article class='plan-row' style={{this.style}}>
        <div class='poster'>
          {{#if @model.poster}}
            <@fields.poster @format='fitted' />
          {{else}}
            <span class='blank'>No poster yet</span>
          {{/if}}
        </div>
        <div class='body'>
          <span class='status'>{{@model.status}} · {{@model.decided}} of 5 decided</span>
          <h3>{{@model.name}}</h3>
          <dl>
            {{#each this.decisions as |d|}}
              <div class={{if d.set 'set' 'unset'}}>
                <dt>{{d.label}}</dt>
                <dd>
                  {{#if d.swatch}}<i class='swatch' style={{htmlSafe (concat 'background:' d.swatch)}}></i>{{/if}}
                  {{d.value}}
                </dd>
              </div>
            {{/each}}
          </dl>
        </div>
      </article>
      </div>
      <style scoped>
        .plan-row {
          display: grid;
          grid-template-columns: 120px 1fr;
          background: #f4f1ea;
          color: #0d1522;
          border-top: 4px solid var(--accent);
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
        }
        .poster {
          display: grid;
          min-height: 160px;
          background: #e2ddd2;
        }
        .poster > :deep(*) {
          height: 100%;
        }
        .blank {
          display: grid;
          place-items: center;
          height: 100%;
          font: 600 10px 'JetBrains Mono', ui-monospace, monospace;
          text-transform: uppercase;
          color: #67707d;
        }
        .body {
          padding: 12px 14px;
          min-width: 0;
        }
        .status {
          font: 600 10px/14px 'JetBrains Mono', ui-monospace, monospace;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #67707d;
        }
        h3 {
          margin: 2px 0 8px;
          font: 900 24px/0.95 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 68%;
          text-transform: uppercase;
        }
        dl {
          margin: 0;
          display: grid;
          gap: 3px;
        }
        dl div {
          display: grid;
          grid-template-columns: 110px 1fr;
          gap: 8px;
          font-size: 13px;
          line-height: 19px;
        }
        dt {
          color: #67707d;
        }
        dd {
          margin: 0;
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
        }
        .unset dd {
          font-weight: 400;
          font-style: italic;
          color: #9aa3ad;
        }
        .swatch {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          box-shadow: 0 0 0 1px rgb(13 21 34 / 20%);
        }
        .embed-frame {
          container: plan-embed / inline-size;
        }
        /* the assistant panel's width: a narrower poster, and each label
           over its value, so no value wraps */
        @container plan-embed (width < 480px) {
          .plan-row {
            grid-template-columns: 96px 1fr;
          }
          .body {
            padding: 10px 12px;
          }
          h3 {
            margin-bottom: 6px;
            font-size: 21px;
          }
          dl {
            grid-template-columns: 1fr 1fr;
            gap: 8px 12px;
          }
          dl div {
            grid-template-columns: 1fr;
            gap: 1px;
            min-width: 0;
          }
          dt {
            font-size: 10px;
            line-height: 13px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }
          dd {
            font-size: 13.5px;
            line-height: 18px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof RelaunchPlan> {
    get style() {
      return planStyle(this.args.model as RelaunchPlan);
    }
    get decisions() {
      return decisionsOf(this.args.model as RelaunchPlan);
    }
    <template>
      <article class='plan-page' style={{this.style}}>
        <header>
          <span class='eyebrow'><i aria-hidden='true'></i>Relaunch plan · {{@model.status}}</span>
          <h1>{{@model.name}}</h1>
          {{#if @model.club}}<p class='club'>for <@fields.club @format='atom' /></p>{{/if}}
        </header>
        <div class='spread'>
          <div class='poster'>
            {{#if @model.poster}}
              <@fields.poster @format='fitted' />
            {{else}}
              <span class='blank'>No poster chosen yet</span>
            {{/if}}
          </div>
          <dl class='decisions'>
            {{#each this.decisions as |d|}}
              <div class={{if d.set 'set' 'unset'}}>
                <dt>{{d.label}}</dt>
                <dd>
                  {{#if d.swatch}}<i class='swatch' style={{htmlSafe (concat 'background:' d.swatch)}}></i>{{/if}}
                  {{d.value}}
                </dd>
              </div>
            {{/each}}
            <div class='progress'>
              <span class='bar'><span style={{htmlSafe (concat 'width:' (percent @model.decided) '%')}}></span></span>
              <span>{{@model.decided}} of 5 decided</span>
            </div>
          </dl>
        </div>
        {{#if @model.regulars.length}}
          <section>
            <h2>Invited first</h2>
            <div class='regulars'><@fields.regulars @format='fitted' /></div>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .plan-page {
          min-height: 100%;
          box-sizing: border-box;
          padding: 40px 44px;
          display: flex;
          flex-direction: column;
          gap: 28px;
          background: #f4f1ea;
          color: #0d1522;
          border-top: 10px solid var(--accent);
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
          transition: border-color 0.4s ease;
        }
        .eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #67707d;
        }
        .eyebrow i {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--accent);
          box-shadow: 0 0 0 1px rgb(13 21 34 / 25%);
        }
        h1 {
          margin: 6px 0 4px;
          font-family: 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 62%;
          font-weight: 900;
          font-size: 64px;
          line-height: 0.88;
          text-transform: uppercase;
        }
        .club {
          margin: 0;
          font-size: 14px;
          color: #67707d;
        }
        .spread {
          display: grid;
          grid-template-columns: minmax(180px, 260px) 1fr;
          gap: 32px;
          align-items: start;
        }
        .poster {
          display: grid;
          aspect-ratio: 3 / 4;
          border-radius: 6px;
          overflow: hidden;
          background: #e2ddd2;
          box-shadow: 0 18px 40px rgb(13 21 34 / 18%);
        }
        .poster > :deep(*) {
          height: 100%;
        }
        .blank {
          display: grid;
          place-items: center;
          height: 100%;
          font: 600 11px 'JetBrains Mono', ui-monospace, monospace;
          text-transform: uppercase;
          color: #67707d;
        }
        .decisions {
          margin: 0;
          display: flex;
          flex-direction: column;
        }
        .decisions > div:not(.progress) {
          display: grid;
          grid-template-columns: 150px 1fr;
          gap: 12px;
          padding: 14px 0;
          border-bottom: 1px solid #d9d3c7;
        }
        dt {
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #67707d;
          line-height: 24px;
        }
        dd {
          margin: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 19px;
          line-height: 24px;
          font-weight: 700;
        }
        .unset dd {
          font-weight: 400;
          font-style: italic;
          color: #9aa3ad;
        }
        .swatch {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          box-shadow: 0 0 0 1px rgb(13 21 34 / 20%);
        }
        .progress {
          display: flex;
          align-items: center;
          gap: 12px;
          padding-top: 16px;
          font: 600 11px 'JetBrains Mono', ui-monospace, monospace;
          text-transform: uppercase;
          color: #67707d;
        }
        .bar {
          flex: 1;
          height: 6px;
          border-radius: 3px;
          background: #e2ddd2;
          overflow: hidden;
        }
        .bar span {
          display: block;
          height: 100%;
          background: var(--accent);
          transition: width 0.4s ease;
        }
        h2 {
          margin: 0 0 10px;
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #67707d;
        }
        .regulars :deep(.linksToMany-field) {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 8px;
        }
        .regulars :deep(.field-component-card.fitted-format) {
          height: 58px;
          border-radius: 10px;
          overflow: hidden;
        }
        @container (width < 640px) {
          .spread {
            grid-template-columns: 1fr;
          }
          .poster {
            max-width: 240px;
          }
        }
      </style>
    </template>
  };
}

function concat(...parts: unknown[]) {
  return parts.join('');
}

function percent(decided: number | undefined | null) {
  return Math.round(((decided ?? 0) / 5) * 100);
}

// ── SetPlanFieldsTool ──────────────────────────────────────────────────────

export class PlanChange extends FieldDef {
  static displayName = 'Plan change';
  @field path = contains(StringField);
  @field before = contains(StringField);
  @field after = contains(StringField);
}

export class SetPlanFieldsInput extends CardDef {
  static displayName = 'Set plan fields input';
  // the plan card's full URL
  @field cardId = contains(StringField);
  // a JSON object of the fields to set: accent, accentName, sendDay,
  // distance, status, name, regularsCount, and poster as the full URL of a
  // Poster card
  @field fields = contains(StringField);
}

export class SetPlanFieldsResult extends CardDef {
  static displayName = 'Set plan fields result';
  @field cardId = contains(StringField);
  @field paths = containsMany(StringField);
  @field changes = containsMany(PlanChange);
  @field summary = contains(StringField);
}

const PLAIN_FIELDS = [
  'name',
  'accent',
  'accentName',
  'sendDay',
  'distance',
  'status',
  'regularsCount',
];

function shown(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return 'none';
  }
  if (typeof value === 'object') {
    let title = (value as { cardTitle?: unknown }).cardTitle;
    return typeof title === 'string' ? title : '(card)';
  }
  return String(value);
}

export class SetPlanFieldsTool extends Tool<
  typeof SetPlanFieldsInput,
  typeof SetPlanFieldsResult
> {
  static actionVerb = 'Update';
  // A change to the plan always waits for the user's click, in any mode.
  static neverAutoExecutes = true;
  description =
    'Set fields on a Relaunch plan card and report each change. cardId is the ' +
    'plan card URL; fields is a JSON object with any of accent (a #hex colour), ' +
    'accentName (the colour as the user named it), sendDay, distance, status, ' +
    'name, regularsCount, and poster (the full URL of a Poster card). Use this ' +
    'for every change to the plan.';

  requireInputFields = ['cardId', 'fields'];

  async getInputType() {
    return SetPlanFieldsInput;
  }

  protected async run(input: SetPlanFieldsInput): Promise<SetPlanFieldsResult> {
    let cardId = input.cardId?.trim();
    if (!cardId) {
      throw new Error('set plan fields needs cardId, the plan card URL');
    }
    let fields: Record<string, unknown>;
    try {
      fields = JSON.parse(input.fields ?? '{}');
    } catch {
      throw new Error('fields must be a JSON object');
    }
    let plan = (await new GetCardCommand(this.commandContext).execute({
      cardId,
    })) as unknown as RelaunchPlan & Record<string, unknown>;
    if (!plan || !(plan instanceof RelaunchPlan)) {
      throw new Error(`${cardId} is not a Relaunch plan card`);
    }
    let changes: PlanChange[] = [];
    for (let [key, value] of Object.entries(fields)) {
      if (key === 'poster') {
        let poster = (await new GetCardCommand(this.commandContext).execute({
          cardId: String(value),
        })) as unknown as PosterOption;
        if (!(poster instanceof PosterOption)) {
          throw new Error(`${value} is not a Poster card`);
        }
        changes.push(
          new PlanChange({
            path: 'poster',
            before: shown(plan.poster),
            after: shown(poster),
          }),
        );
        plan.poster = poster;
        continue;
      }
      if (!PLAIN_FIELDS.includes(key)) {
        throw new Error(`${key} is not a plan field this tool sets`);
      }
      let next = key === 'regularsCount' ? Number(value) : String(value);
      changes.push(
        new PlanChange({
          path: key,
          before: shown(plan[key]),
          after: shown(next),
        }),
      );
      plan[key] = next;
    }
    await new SaveCardCommand(this.commandContext).execute({ card: plan });
    return new SetPlanFieldsResult({
      cardId,
      paths: changes.map((change) => change.path),
      changes,
      summary: `Updated ${changes.length} field${changes.length === 1 ? '' : 's'} of ${plan.name}`,
    });
  }
}
