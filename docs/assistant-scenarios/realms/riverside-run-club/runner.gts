import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import UserRoundIcon from '@cardstack/boxel-icons/user-round';
import { htmlSafe } from '@ember/template';
import { Route } from './route';
import { initialsOf, kmLabel, paceLabel } from './shared';

// A runner's disc takes the colour of their pace band, so a grid of
// regulars reads fast to easy at a glance.
function paceColor(seconds: number | undefined | null) {
  if (!seconds) {
    return '#9aa3ad';
  }
  if (seconds < 290) {
    return '#ff6b4a';
  }
  if (seconds < 320) {
    return '#ffb547';
  }
  if (seconds < 350) {
    return '#c6f432';
  }
  return '#7fd4b8';
}

const STATUS_COLORS: Record<string, string> = {
  Regular: '#c6f432',
  Coach: '#ffb547',
  Member: '#dfe6ee',
  Lapsed: '#c9ced5',
};

function runnerStyle(seconds: number | undefined | null, status: string | undefined | null) {
  return htmlSafe(
    `--pace: ${paceColor(seconds)}; --status: ${STATUS_COLORS[status ?? ''] ?? '#dfe6ee'}`,
  );
}

export class Runner extends CardDef {
  static displayName = 'Runner';
  static icon = UserRoundIcon;
  @field name = contains(StringField);
  // "Member", "Regular", "Coach" or "Lapsed"
  @field status = contains(StringField);
  // seconds a kilometre on an easy run
  @field paceSeconds = contains(NumberField);
  @field neighbourhood = contains(StringField);
  @field since = contains(StringField);
  @field runs = contains(NumberField);
  @field longestKm = contains(NumberField);
  @field favouriteRoute = linksTo(() => Route);
  @field bio = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Runner) {
      return this.name ?? 'Runner';
    },
  });
  @field cardDescription = contains(StringField, {
    computeVia: function (this: Runner) {
      let parts = [
        this.status,
        this.paceSeconds ? `${paceLabel(this.paceSeconds)}/km` : undefined,
        this.runs != null ? `${this.runs} runs since ${this.since ?? 'joining'}` : undefined,
        this.neighbourhood,
      ].filter(Boolean);
      return parts.join(' · ');
    },
  });

  static atom = class Atom extends Component<typeof Runner> {
    get initials() {
      return initialsOf(this.args.model.name);
    }
    get style() {
      return runnerStyle(this.args.model.paceSeconds, this.args.model.status);
    }
    <template>
      <span class='runner-atom' style={{this.style}}>
        <span class='disc' aria-hidden='true'>{{this.initials}}</span>
        <span class='name'>{{@model.name}}</span>
      </span>
      <style scoped>
        .runner-atom {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-width: 0;
          max-width: 100%;
        }
        .disc {
          flex: none;
          display: inline-grid;
          place-items: center;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--pace);
          color: #0d1522;
          font: 700 7px/1 'Inter Tight', 'Inter', system-ui, sans-serif;
          letter-spacing: -0.02em;
        }
        .name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Runner> {
    get initials() {
      return initialsOf(this.args.model.name);
    }
    get style() {
      return runnerStyle(this.args.model.paceSeconds, this.args.model.status);
    }
    <template>
      <div class='fit-frame'>
        <div class='runner-fit' style={{this.style}}>
        <span class='disc' aria-hidden='true'>{{this.initials}}</span>
        <div class='words'>
          <span class='name'>{{@model.name}}</span>
          <span class='meta'><b>{{paceLabel @model.paceSeconds}}</b>/km · {{@model.runs}} runs</span>
        </div>
        <span class='status' data-status={{@model.status}}>{{@model.status}}</span>
      </div>
      </div>
      <style scoped>
        .fit-frame {
          container: runner-fit / size;
          height: 100%;
        }
        .runner-fit {
          height: 100%;
          box-sizing: border-box;
          padding: 8px 10px;
          display: grid;
          grid-template: auto / auto 1fr auto;
          align-items: center;
          gap: 10px;
          background: #f4f1ea;
          color: #0d1522;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
          overflow: hidden;
        }
        .disc {
          display: grid;
          place-items: center;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: var(--pace);
          font: 800 13px/1 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 85%;
        }
        .words {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .name {
          font-weight: 700;
          font-size: 14px;
          line-height: 18px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .meta {
          font-size: 11px;
          line-height: 15px;
          color: #67707d;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .meta b {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-weight: 600;
          color: #0d1522;
        }
        .status {
          padding: 2px 7px;
          border-radius: 999px;
          background: var(--status);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .status[data-status='Lapsed'] {
          color: #67707d;
        }
        /* narrow: the status gives way to the name */
        @container runner-fit (width < 220px) {
          .status {
            display: none;
          }
        }
        @container runner-fit (height < 44px) {
          .disc {
            width: 24px;
            height: 24px;
            font-size: 10px;
          }
          .meta {
            display: none;
          }
        }
        /* a tall tile: the disc on top, the words stacked under it */
        @container runner-fit (height >= 120px) {
          .runner-fit {
            grid-template: 1fr auto auto / 1fr;
            justify-items: start;
            align-items: end;
            padding: 12px;
            gap: 6px;
          }
          .disc {
            align-self: start;
            width: 52px;
            height: 52px;
            font-size: 19px;
          }
          .status {
            display: inline-block;
          }
        }
        /* a badge: the disc, the name and the status */
        @container runner-fit (width < 150px) and (height < 150px) {
          .disc {
            width: 40px;
            height: 40px;
            font-size: 15px;
          }
          .meta {
            display: none;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Runner> {
    get initials() {
      return initialsOf(this.args.model.name);
    }
    get style() {
      return runnerStyle(this.args.model.paceSeconds, this.args.model.status);
    }
    <template>
      <article class='runner-row' style={{this.style}}>
        <span class='disc' aria-hidden='true'>{{this.initials}}</span>
        <div class='body'>
          <header>
            <h3>{{@model.name}}</h3>
            <span class='status' data-status={{@model.status}}>{{@model.status}}</span>
          </header>
          <dl>
            <div><dt>Easy pace</dt><dd>{{paceLabel @model.paceSeconds}}/km</dd></div>
            <div><dt>Runs</dt><dd>{{@model.runs}}</dd></div>
            <div><dt>Longest</dt><dd>{{kmLabel @model.longestKm}} km</dd></div>
          </dl>
          {{#if @model.bio}}<p>{{@model.bio}}</p>{{/if}}
        </div>
      </article>
      <style scoped>
        .runner-row {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 14px;
          padding: 14px 16px;
          background: #f4f1ea;
          color: #0d1522;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
        }
        .disc {
          display: grid;
          place-items: center;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: var(--pace);
          font: 800 17px/1 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 85%;
        }
        .body {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }
        header {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        h3 {
          margin: 0;
          font-size: 16px;
          line-height: 20px;
          font-weight: 700;
        }
        .status {
          padding: 2px 7px;
          border-radius: 999px;
          background: var(--status);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        dl {
          margin: 0;
          display: flex;
          gap: 18px;
        }
        dt {
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #67707d;
        }
        dd {
          margin: 0;
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 13px;
          font-weight: 600;
        }
        p {
          margin: 0;
          font-size: 13px;
          line-height: 19px;
          color: #3b4552;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Runner> {
    get initials() {
      return initialsOf(this.args.model.name);
    }
    get style() {
      return runnerStyle(this.args.model.paceSeconds, this.args.model.status);
    }
    <template>
      <article class='runner-page' style={{this.style}}>
        <header>
          <span class='disc' aria-hidden='true'>{{this.initials}}</span>
          <div>
            <span class='eyebrow'>Riverside Run Club · {{@model.status}}</span>
            <h1>{{@model.name}}</h1>
            <p class='where'>{{@model.neighbourhood}} · running with us since {{@model.since}}</p>
          </div>
        </header>
        <dl class='stats'>
          <div><dt>Easy pace</dt><dd>{{paceLabel @model.paceSeconds}}<small>/km</small></dd></div>
          <div><dt>Runs with the club</dt><dd>{{@model.runs}}</dd></div>
          <div><dt>Longest run</dt><dd>{{kmLabel @model.longestKm}}<small>km</small></dd></div>
        </dl>
        {{#if @model.bio}}<p class='bio'>{{@model.bio}}</p>{{/if}}
        {{#if @model.favouriteRoute}}
          <section>
            <h2>Favourite route</h2>
            <div class='route'><@fields.favouriteRoute @format='embedded' /></div>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .runner-page {
          min-height: 100%;
          box-sizing: border-box;
          padding: 40px 44px;
          display: flex;
          flex-direction: column;
          gap: 28px;
          background: #f4f1ea;
          color: #0d1522;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
        }
        header {
          display: flex;
          align-items: center;
          gap: 22px;
        }
        .disc {
          flex: none;
          display: grid;
          place-items: center;
          width: 96px;
          height: 96px;
          border-radius: 50%;
          background: var(--pace);
          font: 900 36px/1 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 80%;
        }
        .eyebrow {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #67707d;
        }
        h1 {
          margin: 4px 0;
          font-family: 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 70%;
          font-weight: 900;
          font-size: 52px;
          line-height: 0.95;
          text-transform: uppercase;
        }
        .where {
          margin: 0;
          font-size: 14px;
          color: #67707d;
        }
        .stats {
          margin: 0;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          border-top: 2px solid #0d1522;
        }
        .stats div {
          padding: 14px 16px 0 0;
        }
        dt {
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #67707d;
        }
        dd {
          margin: 4px 0 0;
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-weight: 600;
          font-size: 32px;
          line-height: 1;
        }
        dd small {
          margin-inline-start: 3px;
          font-size: 13px;
          color: #67707d;
        }
        .bio {
          margin: 0;
          max-width: 60ch;
          font-size: 17px;
          line-height: 26px;
        }
        h2 {
          margin: 0 0 8px;
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #67707d;
        }
        .route {
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 0 0 1px #d9d3c7;
        }
      </style>
    </template>
  };
}
