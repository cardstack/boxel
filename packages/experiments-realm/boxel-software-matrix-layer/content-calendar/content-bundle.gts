import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  linksToMany,
  NumberField,
  StringField,
} from '@cardstack/base/card-api';
import LayersIcon from '@cardstack/boxel-icons/layers';

import { Campaign } from '../campaign';
import StatePill from '../components/state-pill';
import { Event } from '../event';
import { ContentPiece } from './content-piece';
import { isDoneStatus, platformStyle } from './content-fields';

export class ContentBundle extends CardDef {
  static displayName = 'Content Bundle';
  static icon = LayersIcon;

  @field title = contains(StringField);
  @field anchor = linksTo(ContentPiece);
  @field supporting = linksToMany(ContentPiece);
  @field campaign = linksTo(Campaign);
  @field promotes = linksTo(Event);

  // Linked slots read undefined while loading and forever if broken, so every
  // count filters first — otherwise a dead link inflates the denominator.
  @field pieceCount = contains(NumberField, {
    computeVia: function (this: ContentBundle) {
      let supporting = (this.supporting ?? []).filter(Boolean);
      return (this.anchor ? 1 : 0) + supporting.length;
    },
  });

  @field doneCount = contains(NumberField, {
    computeVia: function (this: ContentBundle) {
      let pieces = [this.anchor, ...(this.supporting ?? [])].filter(Boolean);
      return pieces.filter((p) => isDoneStatus(p?.status)).length;
    },
  });

  @field completion = contains(StringField, {
    computeVia: function (this: ContentBundle) {
      return `${this.doneCount ?? 0}/${this.pieceCount ?? 0}`;
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ContentBundle) {
      return this.title?.trim()?.length ? this.title : 'Untitled bundle';
    },
  });

  static atom = class Atom extends Component<typeof ContentBundle> {
    <template>
      <span class='bundle-atom'>
        <LayersIcon class='ba-icon' />
        <span class='ba-name'>{{@model.cardTitle}}</span>
        <span class='ba-count'>{{@model.completion}}</span>
      </span>
      <style scoped>
        .bundle-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .ba-icon {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .ba-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ba-count {
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof ContentBundle> {
    get pieces(): ContentPiece[] {
      let model = this.args.model;
      return [model?.anchor, ...(model?.supporting ?? [])].filter(
        Boolean,
      ) as ContentPiece[];
    }
    get isComplete(): boolean {
      let total = this.args.model?.pieceCount ?? 0;
      return total > 0 && (this.args.model?.doneCount ?? 0) === total;
    }
    platformShort = (piece: ContentPiece) => platformStyle(piece?.platform).short;
    isDone = (piece: ContentPiece) => isDoneStatus(piece?.status);
    <template>
      <div class='bundle'>
        <header class='bh'>
          <LayersIcon class='bh-icon' />
          <span class='bh-title'>{{@model.cardTitle}}</span>
          <StatePill
            @label={{@model.completion}}
            @hue={{if this.isComplete 'green' 'amber'}}
          />
        </header>
        {{#if this.pieces.length}}
          <ul class='pieces'>
            {{#each this.pieces as |piece|}}
              <li class='piece'>
                <span class='p-plat'>{{this.platformShort piece}}</span>
                <span class='p-title'>{{piece.cardTitle}}</span>
                <span class='p-state {{if piece.status piece.status}}'>
                  {{if (this.isDone piece) '✓' '○'}}
                </span>
              </li>
            {{/each}}
          </ul>
        {{else}}
          <p class='empty'>No pieces yet.</p>
        {{/if}}
      </div>
      <style scoped>
        .bundle {
          display: grid;
          gap: 0.5rem;
          padding: 0.75rem 0.875rem;
          color: var(--foreground, var(--boxel-dark));
        }
        .bh {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .bh-icon {
          width: 16px;
          height: 16px;
          flex: none;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .bh-title {
          flex: 1;
          min-width: 0;
          font-weight: 600;
          font-size: 0.8125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pieces {
          display: grid;
          gap: 0.2rem;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .piece {
          display: grid;
          grid-template-columns: 1.75rem minmax(0, 1fr) 1rem;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.75rem;
        }
        .p-plat {
          font-size: 0.625rem;
          font-weight: 700;
          letter-spacing: 0.03em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .p-title {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .p-state {
          text-align: right;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .p-state.done {
          color: var(--boxel-success);
        }
        .empty {
          margin: 0;
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof ContentBundle> {
    get isComplete(): boolean {
      let total = this.args.model?.pieceCount ?? 0;
      return total > 0 && (this.args.model?.doneCount ?? 0) === total;
    }
    <template>
      <div class='fitted'>
        <div class='top'>
          <LayersIcon class='icon' />
          <span class='count'>{{@model.completion}}</span>
        </div>
        <span class='title'>{{@model.cardTitle}}</span>
        <span class='line-state'>
          <StatePill
            @label={{if this.isComplete 'Complete' 'In flight'}}
            @hue={{if this.isComplete 'green' 'amber'}}
            @dot={{true}}
          />
        </span>
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
        .count {
          font-size: 0.6875rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .title {
          font-weight: 600;
          font-size: 0.8125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .line-state {
          display: none;
        }
        @container fitted-card (min-height: 115px) {
          .line-state {
            display: block;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof ContentBundle> {
    get isComplete(): boolean {
      let total = this.args.model?.pieceCount ?? 0;
      return total > 0 && (this.args.model?.doneCount ?? 0) === total;
    }
    <template>
      <article class='bundle-page'>
        <header class='bph'>
          <span class='marker'><LayersIcon class='m-icon' /></span>
          <div class='bph-text'>
            <p class='kind'>Content bundle</p>
            <h1>{{@model.cardTitle}}</h1>
          </div>
          <StatePill
            @label={{@model.completion}}
            @hue={{if this.isComplete 'green' 'amber'}}
            @emphatic={{this.isComplete}}
          />
        </header>

        <section class='sec'>
          <h2>Anchor</h2>
          {{#if @model.anchor}}
            <@fields.anchor @format='embedded' />
          {{else}}
            <p class='empty'>No anchor piece linked yet.</p>
          {{/if}}
        </section>

        <section class='sec'>
          <h2>Supporting</h2>
          {{#if @model.supporting.length}}
            <div class='support-list'>
              <@fields.supporting @format='embedded' />
            </div>
          {{else}}
            <p class='empty'>No supporting pieces yet.</p>
          {{/if}}
        </section>

        {{#if @model.promotes}}
          <section class='sec'>
            <h2>Promotes</h2>
            <@fields.promotes @format='atom' />
          </section>
        {{/if}}
        {{#if @model.campaign}}
          <section class='sec'>
            <h2>Campaign</h2>
            <@fields.campaign @format='atom' />
          </section>
        {{/if}}
      </article>
      <style scoped>
        .bundle-page {
          display: grid;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
        }
        .bph {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .bph-text {
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
        .sec {
          display: grid;
          gap: 0.5rem;
          padding-top: var(--boxel-sp);
          border-top: 1px solid var(--border, var(--boxel-200));
        }
        h2 {
          margin: 0;
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .support-list {
          display: grid;
          gap: 0.375rem;
        }
        .support-list > :deep(.containsMany-field),
        .support-list > :deep(.linksToMany-field) {
          display: grid;
          gap: 0.375rem;
        }
        .empty {
          margin: 0;
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}

export default ContentBundle;
