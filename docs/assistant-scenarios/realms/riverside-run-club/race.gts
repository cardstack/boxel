import {
  CardDef,
  Component,
  contains,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import DateField from '@cardstack/base/date';
import BooleanField from '@cardstack/base/boolean';
import TrophyIcon from '@cardstack/boxel-icons/trophy';
import { dateParts } from './shared';

function dollars(value: number | undefined | null) {
  return value == null ? '' : `$${value}`;
}

export class Race extends CardDef {
  static displayName = 'Race';
  static icon = TrophyIcon;
  @field name = contains(StringField);
  @field date = contains(DateField);
  // "5K", "10K", "Half", "Relay"
  @field distance = contains(StringField);
  @field borough = contains(StringField);
  @field startLine = contains(StringField);
  @field organiser = contains(StringField);
  @field feeUsd = contains(NumberField);
  @field kidsRace = contains(BooleanField);
  @field kidsFeeUsd = contains(NumberField);
  @field website = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Race) {
      return this.name ?? 'Race';
    },
  });
  @field cardDescription = contains(StringField, {
    computeVia: function (this: Race) {
      let date = dateParts(this.date);
      return [
        this.distance,
        date ? `${date.weekday} ${date.month} ${date.day}` : undefined,
        this.borough,
        this.feeUsd != null ? `${dollars(this.feeUsd)} bib` : undefined,
        this.kidsRace ? `kids' race ${dollars(this.kidsFeeUsd)}` : undefined,
      ]
        .filter(Boolean)
        .join(' · ');
    },
  });

  static atom = class Atom extends Component<typeof Race> {
    <template>
      <span class='race-atom'>
        <span class='dist'>{{@model.distance}}</span>
        <span class='name'>{{@model.name}}</span>
      </span>
      <style scoped>
        .race-atom {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-width: 0;
          max-width: 100%;
        }
        .dist {
          flex: none;
          padding: 0 4px;
          border-radius: 3px;
          background: #ff6b4a;
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

  // A bib: the race is pinned on, the fee is the big number
  static fitted = class Fitted extends Component<typeof Race> {
    get date() {
      return dateParts(this.args.model.date);
    }
    <template>
      <div class='fit-frame'>
        <div class='bib'>
        <span class='pin a' aria-hidden='true'></span>
        <span class='pin b' aria-hidden='true'></span>
        <span class='top'>{{@model.distance}}{{#if this.date}} · {{this.date.month}} {{this.date.day}}{{/if}}</span>
        <span class='fee'>{{dollars @model.feeUsd}}</span>
        <span class='name'>{{@model.name}}</span>
        <span class='where'>{{@model.borough}}{{#if @model.kidsRace}} · kids {{dollars @model.kidsFeeUsd}}{{/if}}</span>
      </div>
      </div>
      <style scoped>
        .fit-frame {
          container: bib / size;
          height: 100%;
        }
        .bib {
          position: relative;
          height: 100%;
          box-sizing: border-box;
          padding: 10px 14px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          background: #fffdf8;
          color: #0d1522;
          border-top: 6px solid #ff6b4a;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
          overflow: hidden;
        }
        .pin {
          position: absolute;
          top: 6px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #d9d3c7;
        }
        .pin.a {
          left: 6px;
        }
        .pin.b {
          right: 6px;
        }
        .top {
          font: 600 10px/14px 'JetBrains Mono', ui-monospace, monospace;
          text-transform: uppercase;
          color: #67707d;
        }
        .fee {
          font: 900 34px/1 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 70%;
        }
        .name {
          font-weight: 700;
          font-size: 13px;
          line-height: 17px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .where {
          font-size: 11px;
          line-height: 15px;
          color: #67707d;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* a strip: fee left, the race beside it */
        @container bib (height < 100px) {
          .bib {
            display: grid;
            grid-template: auto auto / auto 1fr;
            column-gap: 12px;
            align-content: center;
            border-top: 0;
            border-left: 6px solid #ff6b4a;
            padding: 6px 12px;
          }
          .pin,
          .top {
            display: none;
          }
          .fee {
            grid-row: 1 / 3;
            align-self: center;
            font-size: 26px;
          }
        }
        @container bib (height >= 160px) {
          .fee {
            font-size: min(60px, 34cqw);
          }
          .name {
            font-size: 16px;
            line-height: 19px;
            white-space: normal;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Race> {
    get date() {
      return dateParts(this.args.model.date);
    }
    <template>
      <article class='race-row'>
        <div class='fee'>
          <span>{{dollars @model.feeUsd}}</span>
          <small>bib</small>
        </div>
        <div class='body'>
          <h3>{{@model.name}}</h3>
          <p>{{@model.distance}}{{#if this.date}} · {{this.date.weekday}} {{this.date.month}} {{this.date.day}}{{/if}} · {{@model.borough}}</p>
          <p class='small'>{{@model.startLine}}{{#if @model.kidsRace}} · kids' race {{dollars @model.kidsFeeUsd}}{{/if}}</p>
        </div>
      </article>
      <style scoped>
        .race-row {
          display: grid;
          grid-template-columns: 92px 1fr;
          background: #fffdf8;
          color: #0d1522;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
        }
        .fee {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: #ff6b4a;
        }
        .fee span {
          font: 900 30px/1 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 70%;
        }
        .fee small {
          font: 600 10px 'JetBrains Mono', ui-monospace, monospace;
          text-transform: uppercase;
        }
        .body {
          padding: 12px 14px;
          min-width: 0;
        }
        h3 {
          margin: 0 0 2px;
          font-size: 16px;
          line-height: 20px;
        }
        p {
          margin: 0;
          font-size: 13px;
          line-height: 19px;
        }
        .small {
          font-size: 12px;
          color: #67707d;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Race> {
    get date() {
      return dateParts(this.args.model.date);
    }
    <template>
      <article class='race-page'>
        <div class='bib'>
          <span class='top'>{{@model.distance}} · {{@model.borough}}</span>
          <h1>{{@model.name}}</h1>
          {{#if this.date}}<span class='date'>{{this.date.weekday}} {{this.date.month}} {{this.date.day}}</span>{{/if}}
        </div>
        <dl>
          <div><dt>Bib</dt><dd>{{dollars @model.feeUsd}}</dd></div>
          <div><dt>Kids' race</dt><dd>{{if @model.kidsRace (dollars @model.kidsFeeUsd) 'None'}}</dd></div>
          <div><dt>Start</dt><dd class='word'>{{@model.startLine}}</dd></div>
          <div><dt>Organiser</dt><dd class='word'>{{@model.organiser}}</dd></div>
        </dl>
        {{#if @model.website}}<p class='site'>{{@model.website}}</p>{{/if}}
      </article>
      <style scoped>
        .race-page {
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
        .bib {
          padding: 28px 30px;
          border-radius: 10px;
          border-top: 14px solid #ff6b4a;
          background: #fffdf8;
          box-shadow: 0 1px 0 #d9d3c7, 0 12px 30px rgb(13 21 34 / 10%);
        }
        .top,
        .date {
          font: 600 12px/18px 'JetBrains Mono', ui-monospace, monospace;
          text-transform: uppercase;
          color: #67707d;
        }
        h1 {
          margin: 6px 0;
          font-family: 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 65%;
          font-weight: 900;
          font-size: 56px;
          line-height: 0.92;
          text-transform: uppercase;
        }
        dl {
          margin: 0;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          border-top: 2px solid #0d1522;
        }
        dl div {
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
        dd.word {
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
          font-size: 16px;
          line-height: 22px;
        }
        .site {
          margin: 0;
          font: 500 13px 'JetBrains Mono', ui-monospace, monospace;
          color: #67707d;
        }
      </style>
    </template>
  };
}
