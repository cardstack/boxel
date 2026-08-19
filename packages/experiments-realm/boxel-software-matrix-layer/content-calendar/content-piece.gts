import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import DateTimeField from '@cardstack/base/datetime';
import TextAreaField from '@cardstack/base/text-area';
import ClapperboardIcon from '@cardstack/boxel-icons/clapperboard';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';

import StatePill from '../components/state-pill';
import { ContentIdea } from './content-idea';
import { ContentSeries } from './content-series';
import {
  ContentStatusField,
  PlatformField,
  contentStatusStyle,
  platformStyle,
} from './content-fields';
import { Freelancer } from './freelancer';

export class ContentPiece extends CardDef {
  static displayName = 'Content Piece';
  static icon = ClapperboardIcon;

  @field title = contains(StringField);
  @field platform = contains(PlatformField);
  @field scheduledAt = contains(DateTimeField);
  @field status = contains(ContentStatusField);
  @field handedTo = linksTo(Freelancer);
  @field brief = contains(TextAreaField);
  @field sourceIdea = linksTo(ContentIdea);
  @field series = linksTo(ContentSeries);
  /**
   * Which calendar owns this. A plain key rather than a `linksTo`: the console
   * lives in the calendar's own module, so a link back to it is a module cycle
   * that fails with `cardOrThunk was undefined` even in thunk form (verified —
   * it broke every instance). Scoping is all this needs to do; a calendar
   * reaches its content by live query, not by traversing a link.
   */
  @field calendarId = contains(StringField);


  @field cardTitle = contains(StringField, {
    computeVia: function (this: ContentPiece) {
      return this.title?.trim()?.length ? this.title : 'Untitled piece';
    },
  });

  static atom = class Atom extends Component<typeof ContentPiece> {
    get platform() {
      return platformStyle(this.args.model?.platform);
    }
    <template>
      <span class='piece-atom'>
        <this.platform.icon class='pa-icon' />
        <span class='pa-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .piece-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .pa-icon {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .pa-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof ContentPiece> {
    get platform() {
      return platformStyle(this.args.model?.platform);
    }
    get status() {
      return contentStatusStyle(this.args.model?.status);
    }
    <template>
      <div class='piece-row'>
        <span class='marker'><this.platform.icon class='m-icon' /></span>
        <div class='body'>
          <div class='head'>
            <span class='title'>{{@model.cardTitle}}</span>
            <StatePill
              @label={{this.status.label}}
              @hue={{this.status.hue}}
              @dot={{true}}
            />
          </div>
          <div class='meta'>
            <span>{{this.platform.label}}</span>
            {{#if @model.scheduledAt}}
              <span>· {{formatDateTime @model.scheduledAt preset='short'}}</span>
            {{/if}}
            {{#if @model.handedTo}}
              <span class='handed'>· with {{@model.handedTo.name}}</span>
            {{/if}}
          </div>
        </div>
      </div>
      <style scoped>
        .piece-row {
          display: flex;
          align-items: flex-start;
          gap: 0.625rem;
          padding: 0.625rem 0.875rem;
          color: var(--foreground, var(--boxel-dark));
        }
        .marker {
          display: grid;
          place-items: center;
          width: 1.5rem;
          height: 1.5rem;
          flex: none;
          border-radius: 50%;
          background: var(--muted, var(--boxel-100));
        }
        .m-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .body {
          display: grid;
          gap: 0.25rem;
          min-width: 0;
        }
        .head {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        .title {
          font-weight: 600;
          font-size: 0.8125rem;
        }
        .meta {
          display: flex;
          flex-wrap: wrap;
          gap: 0.3rem;
          font-size: 0.6875rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .handed {
          font-weight: 600;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof ContentPiece> {
    get platform() {
      return platformStyle(this.args.model?.platform);
    }
    get status() {
      return contentStatusStyle(this.args.model?.status);
    }
    <template>
      <div class='fitted'>
        <div class='top'>
          <this.platform.icon class='icon' />
          <span class='plat'>{{this.platform.short}}</span>
        </div>
        <span class='title'>{{@model.cardTitle}}</span>
        <span class='line-status'>
          <StatePill
            @label={{this.status.label}}
            @hue={{this.status.hue}}
            @dot={{true}}
          />
        </span>
        {{#if @model.scheduledAt}}
          <span class='meta line-when'>{{formatDateTime
              @model.scheduledAt
              preset='short'
            }}</span>
        {{/if}}
        {{#if @model.handedTo}}
          <span class='meta line-handed'>with {{@model.handedTo.name}}</span>
        {{/if}}
      </div>
      <style scoped>
        .fitted {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.25rem;
          width: 100%;
          height: 100%;
          padding: 0.625rem 0.75rem;
          box-sizing: border-box;
          overflow: hidden;
          color: var(--foreground, var(--boxel-dark));
        }
        .top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
        }
        .icon {
          width: 16px;
          height: 16px;
          flex-shrink: 0;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .plat {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .title {
          font-weight: 600;
          font-size: 0.8125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta {
          font-size: 0.6875rem;
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .line-status,
        .line-when,
        .line-handed {
          display: none;
        }
        @container fitted-card (min-height: 65px) {
          .line-when {
            display: block;
          }
        }
        @container fitted-card (min-height: 115px) {
          .line-status {
            display: block;
          }
        }
        @container fitted-card (min-height: 170px) {
          .line-handed {
            display: block;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof ContentPiece> {
    get platform() {
      return platformStyle(this.args.model?.platform);
    }
    get status() {
      return contentStatusStyle(this.args.model?.status);
    }
    <template>
      <article class='piece-page'>
        <header class='ph'>
          <span class='marker'><this.platform.icon class='m-icon' /></span>
          <div class='ph-text'>
            <p class='kind'>{{this.platform.label}}</p>
            <h1>{{@model.cardTitle}}</h1>
          </div>
          <StatePill
            @label={{this.status.label}}
            @hue={{this.status.hue}}
            @dot={{true}}
          />
        </header>
        {{#if @model.brief}}
          <p class='brief'>{{@model.brief}}</p>
        {{/if}}
        <dl class='facts'>
          {{#if @model.scheduledAt}}
            <div class='fact'>
              <dt>Scheduled</dt>
              <dd>{{formatDateTime @model.scheduledAt preset='medium'}}</dd>
            </div>
          {{/if}}
          <div class='fact'>
            <dt>Owner</dt>
            <dd>{{if @model.handedTo @model.handedTo.name 'Me'}}</dd>
          </div>
          {{#if @model.series}}
            <div class='fact'>
              <dt>Series</dt>
              <dd><@fields.series @format='atom' /></dd>
            </div>
          {{/if}}
          {{#if @model.sourceIdea}}
            <div class='fact'>
              <dt>From idea</dt>
              <dd><@fields.sourceIdea @format='atom' /></dd>
            </div>
          {{/if}}
        </dl>
      </article>
      <style scoped>
        .piece-page {
          display: grid;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
        }
        .ph {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .ph-text {
          flex: 1;
          min-width: 0;
        }
        .marker {
          display: grid;
          place-items: center;
          width: 2.25rem;
          height: 2.25rem;
          flex: none;
          border-radius: 50%;
          background: var(--muted, var(--boxel-100));
        }
        .m-icon {
          width: 18px;
          height: 18px;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .kind {
          margin: 0;
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        h1 {
          margin: 0;
          font-size: 1.25rem;
          line-height: 1.25;
        }
        .brief {
          margin: 0;
          font-size: 0.875rem;
          line-height: 1.55;
          white-space: pre-wrap;
        }
        .facts {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
          gap: 0.75rem;
          margin: 0;
          padding-top: var(--boxel-sp);
          border-top: 1px solid var(--border, var(--boxel-200));
        }
        .fact {
          display: grid;
          gap: 0.2rem;
        }
        dt {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        dd {
          margin: 0;
          font-size: 0.875rem;
        }
      </style>
    </template>
  };
}

export default ContentPiece;
