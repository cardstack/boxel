// The card a newcomer opens first: how to set the assistant up, then the
// prompts in order, each with what to click and what it shows.
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
import MarkdownField from '@cardstack/base/markdown';
import MegaphoneIcon from '@cardstack/boxel-icons/megaphone';
import { RelaunchPlan } from './plan';
import { Club } from './club';
import { RouteLine } from './shared';

const TOUR_LINE =
  'M6 44 C 20 20, 34 16, 48 30 S 70 52, 84 34 S 104 8, 114 18';

export class TourStep extends FieldDef {
  static displayName = 'Tour step';
  @field say = contains(StringField);
  @field click = contains(StringField);
  @field shows = contains(StringField);
}

export class TourScript extends CardDef {
  static displayName = 'Tour script';
  static icon = MegaphoneIcon;
  @field title = contains(StringField);
  @field intro = contains(StringField);
  @field setup = contains(MarkdownField);
  @field reset = contains(MarkdownField);
  @field plan = linksTo(() => RelaunchPlan);
  @field club = linksTo(() => Club);
  @field steps = containsMany(TourStep);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: TourScript) {
      return this.title ?? 'Tour script';
    },
  });
  @field cardDescription = contains(StringField, {
    computeVia: function (this: TourScript) {
      return `${this.steps?.length ?? 0} prompts · ${this.intro ?? ''}`;
    },
  });

  static atom = class Atom extends Component<typeof TourScript> {
    <template>
      <span class='tour-atom'>
        <span class='count'>{{@model.steps.length}}</span>
        <span class='name'>{{@model.title}}</span>
      </span>
      <style scoped>
        .tour-atom {
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
          background: #c6f432;
          color: #0d1522;
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

  static fitted = class Fitted extends Component<typeof TourScript> {
    <template>
      <div class='fit-frame'>
        <div class='tour-fit'>
        <RouteLine class='line' @path={{TOUR_LINE}} @weight={{2.5}} @start={{true}} />
        <span class='count'>{{@model.steps.length}} prompts</span>
        <span class='name'>{{@model.title}}</span>
      </div>
      </div>
      <style scoped>
        .fit-frame {
          container: tour-fit / size;
          height: 100%;
        }
        .tour-fit {
          position: relative;
          height: 100%;
          box-sizing: border-box;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          background: #c6f432;
          color: #0d1522;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
          overflow: hidden;
        }
        .line {
          position: absolute;
          top: 8px;
          right: 10px;
          width: 50%;
          height: 55%;
        }
        .count {
          position: relative;
          font: 600 10px/14px 'JetBrains Mono', ui-monospace, monospace;
          text-transform: uppercase;
        }
        .name {
          position: relative;
          font: 900 20px/0.95 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 65%;
          text-transform: uppercase;
        }
        @container tour-fit (width < 150px) {
          .line {
            display: none;
          }
        }
        @container tour-fit (height < 72px) {
          .line {
            width: 28%;
            height: 80%;
          }
          .count {
            display: none;
          }
          .tour-fit {
            justify-content: center;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof TourScript> {
    <template>
      <article class='tour-row'>
        <header>
          <h3>{{@model.title}}</h3>
          <p>{{@model.intro}}</p>
        </header>
        <ol>
          {{#each @model.steps as |step|}}
            <li>{{step.say}}</li>
          {{/each}}
        </ol>
      </article>
      <style scoped>
        .tour-row {
          padding: 14px 16px;
          background: #f4f1ea;
          color: #0d1522;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
        }
        h3 {
          margin: 0 0 2px;
          font: 900 22px/1 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 65%;
          text-transform: uppercase;
        }
        header p {
          margin: 0 0 10px;
          font-size: 13px;
          color: #67707d;
        }
        ol {
          margin: 0;
          padding-inline-start: 22px;
          font-size: 13px;
          line-height: 20px;
        }
        li::marker {
          font: 600 11px 'JetBrains Mono', ui-monospace, monospace;
          color: #67707d;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof TourScript> {
    <template>
      <article class='tour-page'>
        <header>
          <RouteLine class='line' @path={{TOUR_LINE}} @weight={{4}} @start={{true}} />
          <span class='eyebrow'>Riverside Run Club · Assistant tour</span>
          <h1>{{@model.title}}</h1>
          <p class='intro'>{{@model.intro}}</p>
        </header>
        <div class='columns'>
          <section class='setup'>
            <h2>Set up</h2>
            <div class='md'><@fields.setup /></div>
            {{#if @model.plan}}
              <h2>Open this on the stack</h2>
              <div class='plan'><@fields.plan @format='fitted' /></div>
            {{/if}}
            <h2>Reset</h2>
            <div class='md'><@fields.reset /></div>
          </section>
          <section>
            <h2>Say, in order</h2>
            <ol class='steps'>
              {{#each @model.steps as |step|}}
                <li>
                  <p class='say'>{{step.say}}</p>
                  {{#if step.click}}<p class='click'>Then: {{step.click}}</p>{{/if}}
                  <p class='shows'>{{step.shows}}</p>
                </li>
              {{/each}}
            </ol>
          </section>
        </div>
      </article>
      <style scoped>
        .tour-page {
          min-height: 100%;
          box-sizing: border-box;
          background: #f4f1ea;
          color: #0d1522;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
          container-type: inline-size;
        }
        header {
          position: relative;
          padding: 44px 44px 32px;
          background: #c6f432;
          overflow: hidden;
        }
        .line {
          position: absolute;
          top: 22px;
          right: 30px;
          width: min(40%, 380px);
          height: 170px;
        }
        .eyebrow {
          position: relative;
          font: 600 11px 'JetBrains Mono', ui-monospace, monospace;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        h1 {
          position: relative;
          margin: 8px 0;
          max-width: 10ch;
          font: 900 72px/0.86 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 62%;
          text-transform: uppercase;
        }
        .intro {
          position: relative;
          margin: 0;
          max-width: 52ch;
          font-size: 16px;
          line-height: 24px;
        }
        .columns {
          display: grid;
          grid-template-columns: minmax(220px, 300px) 1fr;
          gap: 40px;
          padding: 32px 44px 44px;
        }
        h2 {
          margin: 0 0 10px;
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #67707d;
        }
        .setup h2:not(:first-child) {
          margin-top: 24px;
        }
        .md {
          font-size: 14px;
          line-height: 21px;
        }
        .md :deep(p),
        .md :deep(ol),
        .md :deep(ul) {
          margin: 0 0 8px;
        }
        .md :deep(ol),
        .md :deep(ul) {
          padding-inline-start: 18px;
        }
        .plan {
          height: 88px;
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 0 0 1px #d9d3c7;
        }
        .plan > :deep(*) {
          height: 100%;
        }
        .steps {
          margin: 0;
          padding: 0;
          list-style: none;
          counter-reset: step;
        }
        .steps li {
          counter-increment: step;
          position: relative;
          padding: 14px 0 14px 52px;
          border-top: 1px solid #d9d3c7;
        }
        .steps li::before {
          content: counter(step, decimal-leading-zero);
          position: absolute;
          left: 0;
          top: 12px;
          font: 900 28px/1 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 65%;
          color: #b8b2a5;
        }
        .say {
          margin: 0 0 4px;
          font-size: 17px;
          line-height: 24px;
          font-weight: 700;
        }
        .click {
          margin: 0 0 2px;
          font: 600 12px/18px 'JetBrains Mono', ui-monospace, monospace;
        }
        .shows {
          margin: 0;
          font-size: 13px;
          line-height: 19px;
          color: #67707d;
        }
        @container (width < 760px) {
          .columns {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };
}
