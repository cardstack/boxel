import {
  CardDef,
  Component,
  contains,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import RouteIcon from '@cardstack/boxel-icons/route';
import { RouteLine, accentStyle, kmLabel } from './shared';

export class Route extends CardDef {
  static displayName = 'Route';
  static icon = RouteIcon;
  @field name = contains(StringField);
  @field distanceKm = contains(NumberField);
  @field climbM = contains(NumberField);
  // "Paved", "Gravel", "Track", "Mixed"
  @field surface = contains(StringField);
  // "Lit after dark", "Daylight only"
  @field lighting = contains(StringField);
  @field meetingPoint = contains(StringField);
  // the route as an SVG path in a 120 by 60 box
  @field path = contains(StringField);
  @field accent = contains(StringField);
  @field notes = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Route) {
      return this.name ?? 'Route';
    },
  });
  @field cardDescription = contains(StringField, {
    computeVia: function (this: Route) {
      let parts = [
        this.distanceKm != null ? `${kmLabel(this.distanceKm)} km` : undefined,
        this.climbM != null ? `${this.climbM} m climb` : undefined,
        this.surface?.toLowerCase(),
        this.lighting?.toLowerCase(),
        this.meetingPoint ? `from ${this.meetingPoint}` : undefined,
      ].filter(Boolean);
      return parts.join(' · ');
    },
  });

  static atom = class Atom extends Component<typeof Route> {
    <template>
      <span class='route-atom' style={{accentStyle 'accent' @model.accent '#3f8f7a'}}>
        <RouteLine class='mark' @path={{@model.path}} @weight={{1.6}} />
        <span class='name'>{{@model.name}}</span>
      </span>
      <style scoped>
        .route-atom {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-width: 0;
          max-width: 100%;
        }
        .mark {
          flex: none;
          width: 20px;
          height: 11px;
          color: var(--accent);
        }
        .name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Route> {
    <template>
      <div class='fit-frame'>
        <div class='route-fit' style={{accentStyle 'accent' @model.accent '#7fd4b8'}}>
        <RouteLine class='line' @path={{@model.path}} @weight={{2.5}} @start={{true}} />
        <div class='words'>
          <span class='name'>{{@model.name}}</span>
          <span class='meta'>{{@model.surface}}{{#if @model.lighting}} · {{@model.lighting}}{{/if}}</span>
        </div>
        <span class='km'>{{kmLabel @model.distanceKm}}<small>km</small></span>
      </div>
      </div>
      <style scoped>
        .fit-frame {
          container: route-fit / size;
          height: 100%;
        }
        .route-fit {
          position: relative;
          height: 100%;
          box-sizing: border-box;
          padding: 10px 12px;
          display: grid;
          grid-template: 1fr auto / 1fr auto;
          gap: 4px 10px;
          background: #0d1522;
          color: #f4f1ea;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
          overflow: hidden;
        }
        .line {
          grid-area: 1 / 1 / 2 / 3;
          width: 100%;
          height: 100%;
          min-height: 0;
          color: var(--accent);
        }
        .words {
          grid-area: 2 / 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .name {
          font-family: 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 75%;
          font-weight: 800;
          font-size: 15px;
          line-height: 1.05;
          text-transform: uppercase;
          letter-spacing: 0.01em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .meta {
          font-size: 11px;
          line-height: 15px;
          color: #9fb0c3;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .km {
          grid-area: 2 / 2;
          align-self: end;
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-weight: 600;
          font-size: 20px;
          line-height: 1;
          color: var(--accent);
        }
        .km small {
          margin-inline-start: 2px;
          font-size: 10px;
          color: #9fb0c3;
        }
        /* a strip: the line on the left, the words beside it */
        @container route-fit (height < 72px) {
          .route-fit {
            grid-template: 1fr / 56px 1fr auto;
            align-items: center;
            padding: 6px 10px;
          }
          .line {
            grid-area: 1 / 1;
          }
          .words {
            grid-area: 1 / 2;
          }
          .km {
            grid-area: 1 / 3;
            align-self: center;
            font-size: 16px;
          }
        }
        @container route-fit (height < 40px) {
          .meta {
            display: none;
          }
          .name {
            font-size: 13px;
          }
        }
        /* a badge: the line and the name */
        @container route-fit (width < 150px) and (height >= 72px) {
          .meta,
          .km {
            display: none;
          }
          .words {
            grid-column: 1 / 3;
          }
          .name {
            font-size: 14px;
            white-space: normal;
          }
        }
        /* a narrow tile: the distance on its own line under the name */
        @container route-fit (width < 200px) and (height >= 140px) {
          .route-fit {
            grid-template: 1fr auto auto / 1fr;
          }
          .line {
            grid-area: 1 / 1;
          }
          .words {
            grid-area: 2 / 1;
          }
          .km {
            grid-area: 3 / 1;
            align-self: start;
            margin-top: 4px;
          }
          .name {
            white-space: normal;
            font-size: 18px;
          }
        }
        @container route-fit (height >= 160px) {
          .name {
            font-size: 22px;
          }
          .km {
            font-size: 28px;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Route> {
    <template>
      <article class='route-row' style={{accentStyle 'accent' @model.accent '#7fd4b8'}}>
        <div class='map'>
          <RouteLine class='line' @path={{@model.path}} @weight={{2.5}} @start={{true}} />
        </div>
        <div class='body'>
          <h3>{{@model.name}}</h3>
          <dl>
            <div><dt>Distance</dt><dd>{{kmLabel @model.distanceKm}} km</dd></div>
            <div><dt>Climb</dt><dd>{{@model.climbM}} m</dd></div>
            <div><dt>Surface</dt><dd>{{@model.surface}}</dd></div>
          </dl>
          {{#if @model.meetingPoint}}
            <p class='from'>From {{@model.meetingPoint}}{{#if @model.lighting}} · {{@model.lighting}}{{/if}}</p>
          {{/if}}
        </div>
      </article>
      <style scoped>
        .route-row {
          display: grid;
          grid-template-columns: 132px 1fr;
          min-height: 108px;
          background: #f4f1ea;
          color: #0d1522;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
        }
        .map {
          display: grid;
          padding: 12px;
          background: #0d1522;
          color: var(--accent);
        }
        .line {
          width: 100%;
          height: 100%;
        }
        .body {
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }
        h3 {
          margin: 0;
          font-family: 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 75%;
          font-weight: 800;
          font-size: 20px;
          line-height: 1.05;
          text-transform: uppercase;
        }
        dl {
          margin: 0;
          display: flex;
          gap: 16px;
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
        .from {
          margin: 0;
          font-size: 12px;
          color: #67707d;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Route> {
    <template>
      <article class='route-page' style={{accentStyle 'accent' @model.accent '#7fd4b8'}}>
        <header>
          <span class='eyebrow'>Riverside Run Club · Route</span>
          <h1>{{@model.name}}</h1>
        </header>
        <RouteLine class='line' @path={{@model.path}} @weight={{4}} @start={{true}} />
        <dl class='stats'>
          <div><dt>Distance</dt><dd>{{kmLabel @model.distanceKm}}<small>km</small></dd></div>
          <div><dt>Climb</dt><dd>{{@model.climbM}}<small>m</small></dd></div>
          <div><dt>Surface</dt><dd class='word'>{{@model.surface}}</dd></div>
          <div><dt>Light</dt><dd class='word'>{{@model.lighting}}</dd></div>
        </dl>
        <footer>
          {{#if @model.meetingPoint}}<p class='from'>Meet at {{@model.meetingPoint}}</p>{{/if}}
          {{#if @model.notes}}<p class='notes'>{{@model.notes}}</p>{{/if}}
        </footer>
      </article>
      <style scoped>
        .route-page {
          min-height: 100%;
          box-sizing: border-box;
          padding: 40px 44px;
          display: flex;
          flex-direction: column;
          gap: 28px;
          background: #0d1522;
          color: #f4f1ea;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
        }
        .eyebrow {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--accent);
        }
        h1 {
          margin: 6px 0 0;
          font-family: 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 62%;
          font-weight: 900;
          font-size: clamp(44px, 9cqi, 88px);
          line-height: 0.92;
          text-transform: uppercase;
        }
        .line {
          width: 100%;
          max-height: 300px;
          aspect-ratio: 2;
          color: var(--accent);
        }
        .stats {
          margin: 0;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 0;
          border-top: 1px solid #26354a;
        }
        .stats div {
          padding: 14px 16px 0 0;
        }
        dt {
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #9fb0c3;
        }
        dd {
          margin: 4px 0 0;
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-weight: 600;
          font-size: 30px;
          line-height: 1;
        }
        dd small {
          margin-inline-start: 3px;
          font-size: 13px;
          color: #9fb0c3;
        }
        dd.word {
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
          font-size: 18px;
          line-height: 30px;
        }
        footer p {
          margin: 0 0 6px;
          max-width: 60ch;
          font-size: 15px;
          line-height: 22px;
        }
        .from {
          font-weight: 600;
        }
        .notes {
          color: #c3cdd8;
        }
      </style>
    </template>
  };
}
