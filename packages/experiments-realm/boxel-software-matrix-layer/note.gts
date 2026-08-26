import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import MarkdownField from '@cardstack/base/markdown';
import StickyNoteIcon from '@cardstack/boxel-icons/sticky-note';

import CreatedAtField from './created-at-field';
import { User } from './user';

/**
 * A freeform written record, usually about something — the base card
 * content-calendar found missing (its ContentIdea had to extend CardDef
 * directly and recorded the gap). The block is deliberately small: a title,
 * a markdown body, who wrote it, when, and the one link that gives a note
 * its power — `about`, the card it annotates. Apps extend it additively
 * (a session note adds its quest, a call note adds its deal).
 */
const EXCERPT_LENGTH = 140;

function excerpt(body: string | null | undefined): string {
  if (!body?.trim()) {
    return '';
  }
  let plain = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > EXCERPT_LENGTH
    ? plain.slice(0, EXCERPT_LENGTH).trimEnd() + '…'
    : plain;
}

export class Note extends CardDef {
  static displayName = 'Note';
  static icon = StickyNoteIcon;

  @field title = contains(StringField);
  @field body = contains(MarkdownField);
  @field about = linksTo(CardDef);
  @field author = linksTo(() => User);
  @field createdAt = contains(CreatedAtField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Note) {
      if (this.title?.trim()?.length) {
        return this.title;
      }
      let fromBody = excerpt(this.body);
      return fromBody.length ? fromBody.slice(0, 60) : 'Untitled note';
    },
  });

  static embedded = class Embedded extends Component<typeof Note> {
    get excerpt() {
      return excerpt(this.args.model?.body);
    }
    <template>
      <div class='note-row'>
        <div class='n-main'>
          <span class='n-title'>{{@model.cardTitle}}</span>
          {{#if this.excerpt}}
            <span class='n-excerpt'>{{this.excerpt}}</span>
          {{/if}}
        </div>
        <span class='n-when'>{{#if @model.createdAt}}<@fields.createdAt
              @format='atom'
            />{{else}}<span class='n-empty'>—</span>{{/if}}</span>
      </div>
      <style scoped>
        .note-row {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          font-size: var(--boxel-font-size-sm);
        }
        .n-main {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          flex: 1;
          min-width: 0;
        }
        .n-title {
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .n-excerpt {
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .n-when {
          flex-shrink: 0;
          min-width: 4rem;
          text-align: right;
        }
        .n-empty {
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof Note> {
    <template>
      <span class='note-atom'>{{@model.cardTitle}}</span>
      <style scoped>
        .note-atom {
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Note> {
    <template>
      <article class='note-page'>
        <header>
          <h1>{{@model.cardTitle}}</h1>
          <div class='byline'>
            {{#if @model.author}}
              <span>{{@model.author.name}}</span>
            {{/if}}
            {{#if @model.createdAt}}
              <span class='muted'><@fields.createdAt @format='atom' /></span>
            {{/if}}
            {{#if @model.about}}
              <span class='about'>on <@fields.about @format='atom' /></span>
            {{/if}}
          </div>
        </header>
        {{#if @model.body}}
          <section class='body'><@fields.body /></section>
        {{else}}
          <p class='empty'>Nothing written yet.</p>
        {{/if}}
      </article>
      <style scoped>
        .note-page {
          max-width: 40rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        header {
          border-bottom: 2px solid var(--foreground, var(--boxel-dark));
          padding-bottom: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
        h1 {
          margin: 0;
          font-size: 1.5rem;
          line-height: 1.2;
          font-family: var(--font-heading, inherit);
        }
        .byline {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          flex-wrap: wrap;
          font-size: var(--boxel-font-size-sm);
        }
        .muted {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .about {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .body {
          line-height: 1.55;
        }
        .body :deep(p:first-child) {
          margin-top: 0;
        }
        .empty {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
          font-size: var(--boxel-font-size-sm);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Note> {
    get excerpt() {
      return excerpt(this.args.model?.body);
    }
    <template>
      <div class='fit'>
        <span class='f-title'>{{@model.cardTitle}}</span>
        <span class='f-excerpt'>{{this.excerpt}}</span>
        <span class='f-when'>{{#if @model.createdAt}}<@fields.createdAt
              @format='atom'
            />{{/if}}</span>
      </div>
      <style scoped>
        .fit {
          width: 100%;
          height: 100%;
          padding: var(--boxel-sp-xs);
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          gap: var(--boxel-sp-4xs);
          overflow: hidden;
        }
        .f-title {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          line-height: 1.25;
          color: var(--foreground, var(--boxel-dark));
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }
        .f-excerpt {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          line-height: 1.4;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 4;
          overflow: hidden;
        }
        .f-when {
          align-self: end;
        }
        /* badge: title only */
        @container fitted-card (width <= 150px) and (height <= 169px) {
          .f-excerpt,
          .f-when {
            display: none;
          }
          .f-title {
            -webkit-line-clamp: 2;
            font-size: var(--boxel-font-size-xs);
          }
        }
        /* strip: one line + timestamp */
        @container fitted-card (aspect-ratio > 2.0) and (height <= 90px) {
          .fit {
            grid-template-rows: none;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
          }
          .f-title {
            -webkit-line-clamp: 1;
          }
          .f-excerpt {
            display: none;
          }
          .f-when {
            align-self: center;
          }
        }
        /* larger cards let the excerpt breathe */
        @container fitted-card (width >= 400px) and (height >= 170px) {
          .f-excerpt {
            -webkit-line-clamp: 6;
          }
        }
      </style>
    </template>
  };
}

export default Note;
