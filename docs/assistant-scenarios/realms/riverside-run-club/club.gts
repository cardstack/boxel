import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  linksToMany,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import FootprintsIcon from '@cardstack/boxel-icons/footprints';
import { Route } from './route';
import { Runner } from './runner';
import { Session } from './session';
import { RouteLine } from './shared';

export class Club extends CardDef {
  static displayName = 'Club';
  static icon = FootprintsIcon;
  @field name = contains(StringField);
  @field tagline = contains(StringField);
  @field founded = contains(StringField);
  @field meetingPoint = contains(StringField);
  @field homeRoute = linksTo(() => Route);
  @field members = linksToMany(() => Runner);
  @field sessions = linksToMany(() => Session);
  @field routes = linksToMany(() => Route);
  @field memberCount = contains(NumberField, {
    computeVia: function (this: Club) {
      return this.members?.length ?? 0;
    },
  });
  @field regularCount = contains(NumberField, {
    computeVia: function (this: Club) {
      return (this.members ?? []).filter((m) => m?.status === 'Regular').length;
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Club) {
      return this.name ?? 'Club';
    },
  });
  @field cardDescription = contains(StringField, {
    computeVia: function (this: Club) {
      return [
        `${this.members?.length ?? 0} runners`,
        `${(this.members ?? []).filter((m) => m?.status === 'Regular').length} regulars`,
        this.meetingPoint ? `meets at ${this.meetingPoint}` : undefined,
      ]
        .filter(Boolean)
        .join(' · ');
    },
  });

  static atom = class Atom extends Component<typeof Club> {
    <template>
      <span class='club-atom'>
        <span class='mark' aria-hidden='true'><RouteLine @path={{@model.homeRoute.path}} @weight={{1.4}} /></span>
        <span class='name'>{{@model.name}}</span>
      </span>
      <style scoped>
        .club-atom {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-width: 0;
          max-width: 100%;
        }
        .mark {
          flex: none;
          display: grid;
          width: 18px;
          height: 13px;
          padding: 1px 2px;
          box-sizing: border-box;
          border-radius: 3px;
          background: #0d1522;
          color: #c6f432;
        }
        .mark svg {
          width: 100%;
          height: 100%;
        }
        .name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Club> {
    <template>
      <div class='fit-frame'>
        <div class='club-fit'>
        <RouteLine class='line' @path={{@model.homeRoute.path}} @weight={{2.5}} @start={{true}} />
        <span class='name'>{{@model.name}}</span>
        <span class='meta'><b>{{@model.memberCount}}</b> runners · <b>{{@model.regularCount}}</b> regulars</span>
      </div>
      </div>
      <style scoped>
        .fit-frame {
          container: club-fit / size;
          height: 100%;
        }
        .club-fit {
          position: relative;
          height: 100%;
          box-sizing: border-box;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          gap: 2px;
          background: #0d1522;
          color: #f4f1ea;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
          overflow: hidden;
        }
        .line {
          position: absolute;
          inset: 8px 10px auto auto;
          width: 55%;
          height: 60%;
          color: #c6f432;
        }
        .name {
          position: relative;
          font: 900 20px/0.95 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 65%;
          text-transform: uppercase;
        }
        .meta {
          position: relative;
          font-size: 11px;
          line-height: 15px;
          color: #9fb0c3;
          white-space: nowrap;
        }
        .meta b {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          color: #c6f432;
        }
        @container club-fit (height < 72px) {
          .club-fit {
            justify-content: center;
          }
          .line {
            inset: 6px 10px 6px auto;
            width: 30%;
            height: auto;
          }
          .name {
            font-size: 17px;
            white-space: nowrap;
          }
        }
        @container club-fit (height < 56px) {
          .meta {
            display: none;
          }
          .name {
            font-size: 16px;
          }
        }
        @container club-fit (width < 150px) {
          .meta {
            display: none;
          }
          .name {
            font-size: 17px;
          }
        }
        @container club-fit (height >= 160px) {
          .name {
            font-size: min(34px, 15cqw);
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Club> {
    <template>
      <article class='club-row'>
        <RouteLine class='line' @path={{@model.homeRoute.path}} @weight={{2.5}} @start={{true}} />
        <div class='words'>
          <h3>{{@model.name}}</h3>
          <p>{{@model.tagline}}</p>
        </div>
        <dl>
          <div><dt>Runners</dt><dd>{{@model.memberCount}}</dd></div>
          <div><dt>Regulars</dt><dd>{{@model.regularCount}}</dd></div>
          <div><dt>Since</dt><dd>{{@model.founded}}</dd></div>
        </dl>
      </article>
      <style scoped>
        .club-row {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 16px 18px;
          background: #0d1522;
          color: #f4f1ea;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
          overflow: hidden;
        }
        .line {
          position: absolute;
          top: 10px;
          right: 14px;
          width: 40%;
          height: 70px;
          color: #c6f432;
        }
        .words {
          position: relative;
          max-width: 62%;
        }
        h3 {
          margin: 0 0 4px;
          font: 900 26px/0.95 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 65%;
          text-transform: uppercase;
        }
        p {
          margin: 0;
          font-size: 13px;
          line-height: 19px;
          color: #c3cdd8;
        }
        dl {
          position: relative;
          margin: 0;
          display: flex;
          gap: 24px;
          padding-top: 10px;
          border-top: 1px solid #26354a;
        }
        dt {
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #9fb0c3;
        }
        dd {
          margin: 0;
          font: 600 18px/1.2 'JetBrains Mono', ui-monospace, monospace;
          color: #c6f432;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Club> {
    <template>
      <article class='club-page'>
        <header>
          <RouteLine class='line' @path={{@model.homeRoute.path}} @weight={{5}} @start={{true}} />
          <span class='eyebrow'>Since {{@model.founded}} · {{@model.meetingPoint}}</span>
          <h1>{{@model.name}}</h1>
          <p class='tagline'>{{@model.tagline}}</p>
          <dl>
            <div><dt>Runners</dt><dd>{{@model.memberCount}}</dd></div>
            <div><dt>Regulars</dt><dd>{{@model.regularCount}}</dd></div>
            <div><dt>Routes</dt><dd>{{@model.routes.length}}</dd></div>
          </dl>
        </header>
        <section>
          <h2>Recent sessions</h2>
          <div class='list'><@fields.sessions @format='embedded' /></div>
        </section>
        <section>
          <h2>Runners</h2>
          <div class='runners'><@fields.members @format='fitted' /></div>
        </section>
        <section>
          <h2>Routes</h2>
          <div class='routes'><@fields.routes @format='fitted' /></div>
        </section>
      </article>
      <style scoped>
        .club-page {
          min-height: 100%;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          gap: 32px;
          padding-bottom: 44px;
          background: #f4f1ea;
          color: #0d1522;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
        }
        header {
          position: relative;
          padding: 44px 44px 32px;
          background: #0d1522;
          color: #f4f1ea;
          overflow: hidden;
        }
        .line {
          position: absolute;
          top: 24px;
          right: 32px;
          width: min(46%, 420px);
          height: 210px;
          color: #c6f432;
        }
        .eyebrow {
          position: relative;
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #c6f432;
        }
        h1 {
          position: relative;
          margin: 8px 0;
          max-width: 9ch;
          font-family: 'Archivo', 'Inter Tight', system-ui, sans-serif;
          font-stretch: 62%;
          font-weight: 900;
          font-size: 76px;
          line-height: 0.86;
          text-transform: uppercase;
        }
        .tagline {
          position: relative;
          margin: 0;
          max-width: 46ch;
          font-size: 16px;
          line-height: 24px;
          color: #c3cdd8;
        }
        dl {
          position: relative;
          margin: 26px 0 0;
          display: flex;
          gap: 40px;
        }
        dt {
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #9fb0c3;
        }
        dd {
          margin: 4px 0 0;
          font: 600 34px/1 'JetBrains Mono', ui-monospace, monospace;
          color: #c6f432;
        }
        section {
          padding: 0 44px;
        }
        h2 {
          margin: 0 0 10px;
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #67707d;
        }
        .list :deep(.linksToMany-field) {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .list :deep(.field-component-card) {
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 0 0 1px #d9d3c7;
        }
        .runners :deep(.linksToMany-field) {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
          gap: 8px;
        }
        .runners :deep(.field-component-card.fitted-format) {
          height: 58px;
          border-radius: 10px;
          overflow: hidden;
        }
        .routes :deep(.linksToMany-field) {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 8px;
        }
        .routes :deep(.field-component-card.fitted-format) {
          height: 150px;
          border-radius: 12px;
          overflow: hidden;
        }
      </style>
    </template>
  };
}
