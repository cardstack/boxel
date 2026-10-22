// The assistant's end-to-end cases the recorded tour leaves out: each one is
// a setup, a prompt in this realm's own cards, what to click, and what the
// panel must show. The tour script covers the thirteen recorded prompts;
// this card keeps the rest so they can be run, and later automated.
import {
  CardDef,
  Component,
  FieldDef,
  contains,
  containsMany,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import ChecklistIcon from '@cardstack/boxel-icons/list-checks';
import { TourScript } from './tour-script';

export class TestCase extends FieldDef {
  static displayName = 'Test case';
  @field code = contains(StringField);
  @field area = contains(StringField);
  @field title = contains(StringField);
  // what to do before the prompt: mode, panel width, state to start from
  @field setup = contains(StringField);
  @field say = contains(StringField);
  @field then = contains(StringField);
  // what the panel must show for the case to pass
  @field expect = contains(StringField);
  // the Pret UI parts and host states it exercises, comma-separated
  @field shows = contains(StringField);
  // what it needs that a plain session doesn't have
  @field needs = contains(StringField);
}

interface Group {
  area: string;
  count: number;
  cases: TestCase[];
}

function groups(cases: TestCase[] | undefined): Group[] {
  let order: string[] = [];
  let byArea = new Map<string, TestCase[]>();
  for (let c of cases ?? []) {
    let area = c.area ?? 'Other';
    if (!byArea.has(area)) {
      byArea.set(area, []);
      order.push(area);
    }
    byArea.get(area)!.push(c);
  }
  return order.map((area) => ({
    area,
    count: byArea.get(area)!.length,
    cases: byArea.get(area)!,
  }));
}

function chips(shows: string | undefined) {
  return (shows ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export class AssistantTestPlan extends CardDef {
  static displayName = 'Assistant test plan';
  static icon = ChecklistIcon;
  @field title = contains(StringField);
  @field intro = contains(StringField);
  @field tour = linksTo(() => TourScript);
  @field cases = containsMany(TestCase);
  @field caseCount = contains(NumberField, {
    computeVia: function (this: AssistantTestPlan) {
      return this.cases?.length ?? 0;
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: AssistantTestPlan) {
      return this.title ?? 'Assistant test plan';
    },
  });
  @field cardDescription = contains(StringField, {
    computeVia: function (this: AssistantTestPlan) {
      let areas = groups(this.cases).map((g) => g.area);
      return `${this.cases?.length ?? 0} cases · ${areas.join(', ')}`;
    },
  });

  static atom = class Atom extends Component<typeof AssistantTestPlan> {
    <template>
      <span class='plan-atom'>
        <span class='count'>{{@model.caseCount}}</span>
        <span class='name'>{{@model.title}}</span>
      </span>
      <style scoped>
        .plan-atom {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-width: 0;
          max-width: 100%;
        }
        .count {
          flex: none;
          padding: 0 4px;
          border-radius: 3px;
          background: #0d1522;
          color: #c6f432;
          font: 700 9px/14px 'JetBrains Mono', ui-monospace, monospace;
        }
        .name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof AssistantTestPlan> {
    get areas() {
      return groups(this.args.model.cases as TestCase[] | undefined);
    }
    <template>
      <div class='fit-frame'>
        <div class='plan-fit'>
          <span class='count'>{{@model.caseCount}}
            <small>cases</small></span>
          <span class='name'>{{@model.title}}</span>
          <ul class='areas'>
            {{#each this.areas as |g|}}
              <li><b>{{g.count}}</b> {{g.area}}</li>
            {{/each}}
          </ul>
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
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          background: #0d1522;
          color: #f4f1ea;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
          overflow: hidden;
        }
        .count {
          font: 900 30px/1 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 70%;
          color: #c6f432;
        }
        .count small {
          font: 600 11px 'JetBrains Mono', ui-monospace, monospace;
          text-transform: uppercase;
          color: #9fb0c3;
        }
        .name {
          font: 900 17px/1.05 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 75%;
          text-transform: uppercase;
        }
        .areas {
          margin: 6px 0 0;
          padding: 0;
          list-style: none;
          font-size: 11px;
          line-height: 16px;
          color: #c3cdd8;
        }
        .areas b {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          color: #f4f1ea;
        }
        @container plan-fit (height < 120px) {
          .areas {
            display: none;
          }
        }
        @container plan-fit (height < 64px) {
          .plan-fit {
            flex-direction: row;
            align-items: center;
            gap: 10px;
          }
          .count {
            font-size: 22px;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof AssistantTestPlan> {
    get areas() {
      return groups(this.args.model.cases as TestCase[] | undefined);
    }
    <template>
      <article class='plan-row'>
        <h3>{{@model.title}}</h3>
        <p>{{@model.caseCount}} cases the recorded tour leaves out</p>
        <ul>
          {{#each this.areas as |g|}}
            <li><b>{{g.count}}</b> {{g.area}}</li>
          {{/each}}
        </ul>
      </article>
      <style scoped>
        .plan-row {
          padding: 14px 16px;
          background: #f4f1ea;
          color: #0d1522;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
        }
        h3 {
          margin: 0;
          font: 900 22px/1 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 70%;
          text-transform: uppercase;
        }
        p {
          margin: 4px 0 8px;
          font-size: 13px;
          color: #67707d;
        }
        ul {
          margin: 0;
          padding: 0;
          list-style: none;
          display: flex;
          flex-wrap: wrap;
          gap: 4px 14px;
          font-size: 13px;
        }
        b {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof AssistantTestPlan> {
    get areas() {
      return groups(this.args.model.cases as TestCase[] | undefined);
    }
    chips = chips;
    <template>
      <article class='plan-page'>
        <header>
          <span class='eyebrow'>Riverside Run Club · End-to-end cases</span>
          <h1>{{@model.title}}</h1>
          <p class='intro'>{{@model.intro}}</p>
          {{#if @model.tour}}
            <p class='tour'>The recorded prompts are in
              <@fields.tour @format='atom' /></p>
          {{/if}}
        </header>
        {{#each this.areas as |g|}}
          <section>
            <h2>{{g.area}} <span>{{g.count}}</span></h2>
            <ol class='cases'>
              {{#each g.cases as |c|}}
                <li class='case'>
                  <div class='head'>
                    <span class='code'>{{c.code}}</span>
                    <h3>{{c.title}}</h3>
                  </div>
                  <dl>
                    {{#if c.setup}}
                      <div><dt>Setup</dt><dd>{{c.setup}}</dd></div>
                    {{/if}}
                    {{#if c.say}}
                      <div><dt>Say</dt><dd class='say'>{{c.say}}</dd></div>
                    {{/if}}
                    {{#if c.then}}
                      <div><dt>Then</dt><dd>{{c.then}}</dd></div>
                    {{/if}}
                    <div><dt>Expect</dt><dd>{{c.expect}}</dd></div>
                    {{#if c.needs}}
                      <div class='needs'><dt>Needs</dt><dd>{{c.needs}}</dd></div>
                    {{/if}}
                  </dl>
                  <ul class='shows'>
                    {{#each (this.chips c.shows) as |chip|}}
                      <li>{{chip}}</li>
                    {{/each}}
                  </ul>
                </li>
              {{/each}}
            </ol>
          </section>
        {{/each}}
      </article>
      <style scoped>
        .plan-page {
          min-height: 100%;
          box-sizing: border-box;
          padding: 40px 44px 56px;
          background: #f4f1ea;
          color: #0d1522;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
        }
        header {
          margin-bottom: 30px;
        }
        .eyebrow {
          font: 600 11px 'JetBrains Mono', ui-monospace, monospace;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #67707d;
        }
        h1 {
          margin: 6px 0 8px;
          font: 900 56px/0.9 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 62%;
          text-transform: uppercase;
        }
        .intro {
          margin: 0;
          max-width: 62ch;
          font-size: 16px;
          line-height: 24px;
        }
        .tour {
          margin: 8px 0 0;
          font-size: 14px;
          color: #67707d;
        }
        section {
          margin-top: 28px;
        }
        h2 {
          margin: 0 0 10px;
          padding-bottom: 8px;
          border-bottom: 2px solid #0d1522;
          font: 900 24px/1 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 70%;
          text-transform: uppercase;
        }
        h2 span {
          margin-left: 6px;
          font: 600 13px 'JetBrains Mono', ui-monospace, monospace;
          color: #67707d;
        }
        .cases {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
          gap: 12px;
        }
        .case {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 14px 16px;
          border-radius: 12px;
          background: #fffdf8;
          box-shadow: 0 0 0 1px #d9d3c7;
        }
        .head {
          display: flex;
          align-items: baseline;
          gap: 10px;
        }
        .code {
          flex: none;
          padding: 1px 6px;
          border-radius: 4px;
          background: #0d1522;
          color: #c6f432;
          font: 700 11px/16px 'JetBrains Mono', ui-monospace, monospace;
        }
        h3 {
          margin: 0;
          font-size: 16px;
          line-height: 21px;
        }
        dl {
          margin: 0;
          display: grid;
          gap: 6px;
        }
        dl div {
          display: grid;
          grid-template-columns: 64px 1fr;
          gap: 10px;
          font-size: 13px;
          line-height: 19px;
        }
        dt {
          font: 600 10px/19px 'JetBrains Mono', ui-monospace, monospace;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #67707d;
        }
        dd {
          margin: 0;
        }
        .say {
          font-weight: 600;
        }
        .needs dd {
          color: #a2462c;
        }
        .shows {
          margin: 0;
          padding: 0;
          list-style: none;
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .shows li {
          padding: 1px 7px;
          border-radius: 999px;
          background: #e9e4d9;
          font-size: 11px;
          line-height: 18px;
        }
      </style>
    </template>
  };
}
