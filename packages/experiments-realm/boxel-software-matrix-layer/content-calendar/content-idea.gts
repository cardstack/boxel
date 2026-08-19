import {
  CardDef,
  Component,
  contains,
  field,
  linksToMany,
  StringField,
} from '@cardstack/base/card-api';
import Tag from '@cardstack/base/tag';
import TextAreaField from '@cardstack/base/text-area';
import LightbulbIcon from '@cardstack/boxel-icons/lightbulb';

import { PlatformField, platformStyle } from './content-fields';

// The matrix Note concept has no CardDef in this realm — only a ticket message
// FieldDef — so this extends CardDef directly. Recorded against Note.
export class ContentIdea extends CardDef {
  static displayName = 'Content Idea';
  static icon = LightbulbIcon;

  @field title = contains(StringField);
  @field thought = contains(TextAreaField);
  @field themes = linksToMany(Tag);
  @field hunchPlatform = contains(PlatformField);
  /**
   * Which calendar owns this. A plain key rather than a `linksTo`: the console
   * lives in the calendar's own module, so a link back to it is a module cycle
   * that fails with `cardOrThunk was undefined` even in thunk form (verified —
   * it broke every instance). Scoping is all this needs to do; a calendar
   * reaches its content by live query, not by traversing a link.
   */
  @field calendarId = contains(StringField);


  @field cardTitle = contains(StringField, {
    computeVia: function (this: ContentIdea) {
      return this.title?.trim()?.length ? this.title : 'Untitled idea';
    },
  });

  static atom = class Atom extends Component<typeof ContentIdea> {
    <template>
      <span class='idea-atom'>
        <LightbulbIcon class='ia-icon' />
        <span class='ia-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .idea-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .ia-icon {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .ia-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof ContentIdea> {
    get platform() {
      return platformStyle(this.args.model?.hunchPlatform);
    }
    <template>
      <div class='idea-row'>
        <span class='marker'><LightbulbIcon class='m-icon' /></span>
        <div class='body'>
          <span class='title'>{{@model.cardTitle}}</span>
          {{#if @model.thought}}
            <p class='thought'>{{@model.thought}}</p>
          {{/if}}
          <div class='meta'>
            {{#if @model.hunchPlatform}}
              <span class='hunch'>{{this.platform.label}}</span>
            {{/if}}
            {{#if @model.themes.length}}
              <span class='themes'><@fields.themes @format='atom' /></span>
            {{/if}}
          </div>
        </div>
      </div>
      <style scoped>
        .idea-row {
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
        .title {
          font-weight: 600;
          font-size: 0.8125rem;
        }
        .thought {
          margin: 0;
          font-size: 0.75rem;
          line-height: 1.45;
          color: var(--muted-foreground, var(--boxel-450));
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .meta {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.6875rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .themes {
          display: flex;
          flex-wrap: wrap;
          gap: 0.25rem;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof ContentIdea> {
    get platform() {
      return platformStyle(this.args.model?.hunchPlatform);
    }
    <template>
      <div class='fitted'>
        <div class='top'>
          <LightbulbIcon class='icon' />
          {{#if @model.hunchPlatform}}
            <span class='hunch'>{{this.platform.short}}</span>
          {{/if}}
        </div>
        <span class='title'>{{@model.cardTitle}}</span>
        {{#if @model.thought}}
          <span class='meta line-thought'>{{@model.thought}}</span>
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
        .hunch {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
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
        .line-thought {
          display: none;
        }
        @container fitted-card (min-height: 65px) {
          .line-thought {
            display: block;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof ContentIdea> {
    get platform() {
      return platformStyle(this.args.model?.hunchPlatform);
    }
    <template>
      <article class='idea-page'>
        <header class='ih'>
          <span class='marker'><LightbulbIcon class='m-icon' /></span>
          <div class='ih-text'>
            <p class='kind'>Content idea</p>
            <h1>{{@model.cardTitle}}</h1>
          </div>
        </header>
        {{#if @model.thought}}
          <p class='thought'>{{@model.thought}}</p>
        {{/if}}
        <dl class='facts'>
          {{#if @model.hunchPlatform}}
            <div class='fact'>
              <dt>Platform hunch</dt>
              <dd>{{this.platform.label}}</dd>
            </div>
          {{/if}}
          {{#if @model.themes.length}}
            <div class='fact'>
              <dt>Themes</dt>
              <dd class='tags'><@fields.themes @format='atom' /></dd>
            </div>
          {{/if}}
        </dl>
      </article>
      <style scoped>
        .idea-page {
          display: grid;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
        }
        .ih {
          display: flex;
          align-items: center;
          gap: 0.75rem;
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
        .thought {
          margin: 0;
          font-size: 0.875rem;
          line-height: 1.55;
          white-space: pre-wrap;
        }
        .facts {
          display: grid;
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
        .tags {
          display: flex;
          flex-wrap: wrap;
          gap: 0.25rem;
        }
      </style>
    </template>
  };
}

export default ContentIdea;
