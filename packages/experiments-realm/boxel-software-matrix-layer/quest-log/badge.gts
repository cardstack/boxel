import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  linksTo,
  linksToMany,
} from '@cardstack/base/card-api';
import BooleanField from '@cardstack/base/boolean';
import MarkdownField from '@cardstack/base/markdown';
import MedalIcon from '@cardstack/boxel-icons/medal';

import CreatedAtField from '../created-at-field';
import { Task } from '../task';
import { Quest } from './quest';

/**
 * A self-claimed achievement. The user decides when they've earned one —
 * there is no validation step anywhere in the app, on purpose. claimedAt
 * consumes the Created At block: a badge comes into existence by being
 * claimed.
 */
export class Badge extends CardDef {
  static displayName = 'Badge';
  static icon = MedalIcon;

  @field title = contains(StringField);
  @field description = contains(MarkdownField);
  @field icon = contains(StringField, {
    description: 'An emoji, e.g. 🎵 🏆 🎸.',
  });
  @field claimedAt = contains(CreatedAtField);
  @field isVisible = contains(BooleanField, {
    description: 'Show on the public profile.',
  });
  @field quest = linksTo(() => Quest);
  @field relatedTasks = linksToMany(() => Task);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Badge) {
      return this.title?.trim()?.length ? this.title : 'Unnamed badge';
    },
  });

  static embedded = class Embedded extends Component<typeof Badge> {
    <template>
      <div class='badge-chip'>
        <span class='medallion'>{{if @model.icon @model.icon '🏆'}}</span>
        <span class='b-main'>
          <span class='b-title'>{{@model.cardTitle}}</span>
          <span class='b-when'>claimed
            {{#if @model.claimedAt}}<@fields.claimedAt
                @format='atom'
              />{{else}}—{{/if}}</span>
        </span>
      </div>
      <style scoped>
        .badge-chip {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .medallion {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 2.25rem;
          height: 2.25rem;
          border-radius: 50%;
          font-size: 1.125rem;
          background: color-mix(
            in oklch,
            var(--primary, var(--boxel-warning)) 18%,
            var(--card, var(--boxel-light))
          );
          box-shadow: inset 0 0 0 1.5px
            var(--primary, var(--boxel-warning));
          flex: none;
        }
        .b-main {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
        }
        .b-title {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          color: var(--foreground, var(--boxel-dark));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .b-when {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof Badge> {
    <template>
      <span class='badge-atom'>{{if @model.icon @model.icon '🏆'}}
        {{@model.cardTitle}}</span>
      <style scoped>
        .badge-atom {
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Badge> {
    <template>
      <article class='badge-page'>
        <div class='seal'>{{if @model.icon @model.icon '🏆'}}</div>
        <h1>{{@model.cardTitle}}</h1>
        <p class='claim-line'>Claimed
          {{#if @model.claimedAt}}<@fields.claimedAt
              @format='atom'
            />{{else}}—{{/if}}
          {{#if @model.quest}}for <@fields.quest @format='atom' />{{/if}}</p>
        {{#if @model.description}}
          <section class='meaning'><@fields.description /></section>
        {{/if}}
        {{#if @model.relatedTasks.length}}
          <section class='related'>
            <h2>Earned through</h2>
            <@fields.relatedTasks @format='atom' />
          </section>
        {{/if}}
      </article>
      <style scoped>
        .badge-page {
          max-width: 30rem;
          margin: 0 auto;
          padding: 2.5rem 1.5rem;
          text-align: center;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          align-items: center;
        }
        .seal {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 5rem;
          height: 5rem;
          border-radius: 50%;
          font-size: 2.25rem;
          background: color-mix(
            in oklch,
            var(--primary, var(--boxel-warning)) 20%,
            var(--card, var(--boxel-light))
          );
          box-shadow:
            inset 0 0 0 2px var(--primary, var(--boxel-warning)),
            0 0 0 6px
              color-mix(
                in oklch,
                var(--primary, var(--boxel-warning)) 12%,
                transparent
              );
        }
        h1 {
          margin: 0.5rem 0 0;
          font-size: 1.75rem;
          line-height: 1.15;
          font-family: var(--font-heading, inherit);
        }
        .claim-line {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .meaning {
          text-align: left;
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          background: var(--card, var(--boxel-light));
          width: 100%;
        }
        .meaning :deep(p:first-child) {
          margin-top: 0;
        }
        .meaning :deep(p:last-child) {
          margin-bottom: 0;
        }
        .related h2 {
          margin: 0 0 0.5rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Badge> {
    <template>
      <div class='fit'>
        <span class='f-seal'>{{if @model.icon @model.icon '🏆'}}</span>
        <span class='f-title'>{{@model.cardTitle}}</span>
        <span class='f-when'>{{#if @model.claimedAt}}<@fields.claimedAt
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
          justify-items: center;
          text-align: center;
          gap: var(--boxel-sp-4xs);
          overflow: hidden;
        }
        .f-seal {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 2.5rem;
          height: 2.5rem;
          border-radius: 50%;
          font-size: 1.25rem;
          background: color-mix(
            in oklch,
            var(--primary, var(--boxel-warning)) 18%,
            var(--card, var(--boxel-light))
          );
          box-shadow: inset 0 0 0 1.5px var(--primary, var(--boxel-warning));
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
        .f-when {
          align-self: end;
        }
        @container fitted-card (aspect-ratio > 2.0) and (height <= 90px) {
          .fit {
            grid-template-rows: none;
            grid-template-columns: auto minmax(0, 1fr);
            justify-items: start;
            text-align: left;
            align-items: center;
          }
          .f-seal {
            width: 1.75rem;
            height: 1.75rem;
            font-size: 0.875rem;
          }
          .f-title {
            -webkit-line-clamp: 1;
          }
          .f-when {
            display: none;
          }
        }
        @container fitted-card (width <= 150px) and (height <= 169px) {
          .f-when {
            display: none;
          }
        }
      </style>
    </template>
  };
}

export default Badge;
