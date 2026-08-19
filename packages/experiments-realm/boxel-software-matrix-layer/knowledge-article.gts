import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import MarkdownField from '@cardstack/base/markdown';
import enumField from '@cardstack/base/enum';
import BookOpenIcon from '@cardstack/boxel-icons/book-open';
import GlobeIcon from '@cardstack/boxel-icons/globe';
import LockIcon from '@cardstack/boxel-icons/lock';

import { TicketCategory } from './ticket-category';
import { StatePill } from './components/state-pill';

export const ARTICLE_VISIBILITIES = ['Public', 'Internal'] as const;
export const ARTICLE_STATUSES = ['Draft', 'Published', 'Archived'] as const;

const VisibilityField = enumField(StringField, {
  displayName: 'Visibility',
  options: ARTICLE_VISIBILITIES as unknown as string[],
});

const ArticleStatusField = enumField(StringField, {
  displayName: 'Article Status',
  options: ARTICLE_STATUSES as unknown as string[],
});

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'to',
  'of',
  'in',
  'on',
  'at',
  'for',
  'with',
  'my',
  'i',
  'it',
  'this',
  'that',
  'cant',
  'cannot',
  'not',
  'have',
  'has',
  'get',
  'when',
  'why',
  'how',
]);

function tokens(text?: string | null): string[] {
  return (text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/**
 * A written answer.
 *
 * The spec puts the knowledge base in v1.1. It is here in v1 because the
 * workspace's suggestion panel is one of the three things that make the
 * workspace worth building, and a suggestion panel with nothing to suggest is
 * an empty box with a heading.
 */
export class KnowledgeArticle extends CardDef {
  static displayName = 'Knowledge Article';
  static icon = BookOpenIcon;

  @field headline = contains(StringField);
  @field body = contains(MarkdownField);
  @field category = linksTo(() => TicketCategory);
  @field visibility = contains(VisibilityField);
  @field status = contains(ArticleStatusField);
  @field keywords = containsMany(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: KnowledgeArticle) {
      return this.headline?.trim() || 'Untitled article';
    },
  });

  @field categoryName = contains(StringField, {
    computeVia: function (this: KnowledgeArticle) {
      return this.category?.title ?? '';
    },
  });

  @field excerpt = contains(StringField, {
    computeVia: function (this: KnowledgeArticle) {
      let text = (this.body ?? '')
        .replace(/[#*_`>[\]()]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return text.length > 180 ? `${text.slice(0, 177)}…` : text;
    },
  });

  /* The tall fitted quanta had a second slot that re-printed categoryName —
     the same word the body already showed, so 5 of the 16 sizes spent a row
     saying nothing new. Keywords were declared and never rendered anywhere,
     which made them the obvious thing to put there. Capped at 4 so the row
     stays one line at 150px. */
  @field keywordLabel = contains(StringField, {
    computeVia: function (this: KnowledgeArticle) {
      return (this.keywords ?? []).filter(Boolean).slice(0, 4).join(' · ');
    },
  });

  @field isInternal = contains(StringField, {
    computeVia: function (this: KnowledgeArticle) {
      return this.visibility === 'Internal' ? 'Internal' : '';
    },
  });

  /**
   * How well this article answers a ticket, 0–100.
   *
   * Deterministic keyword overlap, not a model call. A suggestion panel that
   * goes blank when the AI credits run out is worse than one that is merely
   * approximate, and support teams judge these suggestions constantly — a
   * wrong-but-explainable score survives that scrutiny, a black box does not.
   *
   * Weighting: an explicit keyword is worth three title words, and a title
   * word is worth three body words, because authors choose keywords precisely
   * and bodies mention everything in passing.
   */
  relevanceTo(subject?: string | null): number {
    let needles = new Set(tokens(subject));
    if (!needles.size) {
      return 0;
    }
    let score = 0;
    for (let keyword of this.keywords ?? []) {
      if (tokens(keyword).some((t) => needles.has(t))) {
        score += 9;
      }
    }
    for (let word of new Set(tokens(this.headline))) {
      if (needles.has(word)) {
        score += 3;
      }
    }
    for (let word of new Set(tokens(this.body).slice(0, 400))) {
      if (needles.has(word)) {
        score += 1;
      }
    }
    // Normalised against the size of the question, so a long ticket does not
    // make every article look like a better match than a short one does.
    return Math.min(100, Math.round((score / (needles.size * 3)) * 100));
  }

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='iso'>
        <header class='iso-head'>
          {{#if @model.categoryName}}
            <p class='trail'>{{@model.categoryName}}</p>
          {{/if}}
          <h1>{{@model.title}}</h1>
          <div class='badges'>
            <StatePill
              @label={{if @model.isInternal 'Internal only' 'Public'}}
              @hue={{if @model.isInternal 'amber' 'green'}}
            />
            {{#if @model.status}}
              <StatePill @label={{@model.status}} @hue='slate' />
            {{/if}}
          </div>
          {{#if @model.keywords.length}}
            <ul class='kw'>
              {{#each @model.keywords as |keyword|}}
                <li>{{keyword}}</li>
              {{/each}}
            </ul>
          {{/if}}
        </header>

        <div class='prose'><@fields.body /></div>
      </article>
      <style scoped>
        .iso {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
          min-height: 100%;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
        }
        .iso-head {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
          padding-bottom: var(--boxel-sp);
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .trail {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        h1 {
          margin: 0;
          font-family: var(--font-heading, inherit);
          font-size: var(--boxel-font-size-lg);
          font-weight: 700;
          letter-spacing: -0.01em;
          text-wrap: balance;
        }
        .badges {
          display: flex;
          gap: var(--boxel-sp-4xs);
        }
        .kw {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-4xs);
        }
        .kw li {
          padding: 0.05em 0.45em;
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: 999px;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        /* This is the one thing on the page meant to be READ rather than
           scanned, so it gets a reading measure instead of the full width. */
        .prose {
          max-width: 68ch;
          font-size: var(--boxel-font-size);
          line-height: 1.75;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <article class='emb'>
        <div class='emb-top'>
          <BookOpenIcon class='emb-icon' role='presentation' />
          <span class='emb-title'>{{@model.title}}</span>
          {{#if @model.isInternal}}
            <StatePill @label='Internal' @hue='amber' />
          {{/if}}
        </div>
        {{#if @model.categoryName}}
          <span class='emb-cat'>{{@model.categoryName}}</span>
        {{/if}}
        <p class='emb-ex'>{{@model.excerpt}}</p>
      </article>
      <style scoped>
        .emb {
          display: flex;
          flex-direction: column;
          gap: 3px;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius);
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
        }
        .emb-top {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          min-width: 0;
        }
        .emb-icon {
          width: 14px;
          height: 14px;
          flex: none;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .emb-title {
          font-weight: 700;
          font-size: var(--boxel-font-size-sm);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .emb-cat {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .emb-ex {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='atom'>
        {{! A drawn icon, never an emoji: emoji render differently on every
            platform and cannot take a theme colour. }}
        <BookOpenIcon class='atom-icon' role='presentation' />
        <span class='atom-title'>{{@model.title}}</span>
      </span>
      <style scoped>
        .atom {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          font-size: 0.8125rem;
          font-weight: 500;
        }
        .atom-icon {
          width: 13px;
          height: 13px;
          flex: none;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .atom-title {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <article class='fit'>
        <header class='r-head'>
          <BookOpenIcon class='fit-glyph' role='presentation' />
          <h3 class='title'>{{@model.title}}</h3>
          <span class='badge'>{{@model.status}}</span>
        </header>
        <div class='r-body'>
          <span class='line'>{{@model.categoryName}}</span>
          <p class='blurb'>{{@model.excerpt}}</p>
          <span class='tail'>{{@model.keywordLabel}}</span>
        </div>
        {{! The status badge above already says "Published". A bare "Public"
            under it, in the same size and the same muted colour, read as the
            SAME field wrapped onto two lines — and "Published / Internal" read
            as a contradiction. So the audience gets a glyph (a different kind of
            mark, not another grey word) and wording that cannot be mistaken for
            a lifecycle state. The pair is wrapped because the wide+short quantum
            turns .r-meta into a column, which would otherwise stack the icon
            above its own label. }}
        <footer class='r-meta'>
          <span class='aud'>
            {{#if @model.isInternal}}
              <LockIcon class='meta-glyph' role='presentation' />
              Internal only
            {{else}}
              <GlobeIcon class='meta-glyph' role='presentation' />
              Customer-facing
            {{/if}}
          </span>
        </footer>
      </article>
      <style scoped>
        /* Same skeleton as ticket.gts: one `.fit` grid, no container declared
           here (the host provides `fitted-card`), one continuous type scale,
           and tiers that ADD a row rather than un-crop one. */
        .fit {
          width: 100%;
          height: 100%;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          grid-template-areas: 'head' 'body' 'meta';
          gap: 2px;
          padding: 7px 9px;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
          --type-base: clamp(9.5px, 2.7cqi, 12px);
          --type-title: max(11px, calc(var(--type-base) * 1.25));
        }
        .fit > * {
          overflow: hidden;
          min-height: 0;
        }
        .r-head {
          grid-area: head;
          display: flex;
          align-items: baseline;
          gap: 5px;
          min-width: 0;
        }
        /* fitted-card Rule 2: the anchor. Without it these cells were a title at
           weight 600 plus a badge — no image, no glyph, and 600 is not the
           "decisively loud" type the rule accepts as a substitute, so all 16
           sizes read as bare text. This is the card's OWN icon, the same one its
           isolated section headers use, which is what makes it identity rather
           than decoration.

           Sized in em with a px floor so it never shrinks to a dot; `align-self`
           because the head is a baseline row and an SVG has no baseline; muted so
           the title stays the loudest thing in the cell. */
        .fit-glyph {
          flex: none;
          align-self: center;
          width: max(11px, 1.1em);
          height: max(11px, 1.1em);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .title {
          flex: 1;
          min-width: 0;
          margin: 0;
          font-size: var(--type-title);
          font-weight: 600;
          line-height: 1.25;
          letter-spacing: -0.01em;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .badge {
          flex: none;
          margin-left: auto;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--type-base);
          font-weight: 600;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .r-body {
          grid-area: body;
          display: none;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .aud {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
          white-space: nowrap;
        }
        .meta-glyph {
          flex: none;
          width: max(9px, 0.95em);
          height: max(9px, 0.95em);
        }

        .line {
          font-size: var(--type-base);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .blurb {
          display: none;
          margin: 0;
          font-size: var(--type-base);
          color: var(--muted-foreground, var(--boxel-450));
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .tail {
          display: none;
          margin-top: auto;
          font-size: var(--type-base);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .r-meta {
          grid-area: meta;
          display: none;
          align-items: center;
          gap: 6px;
          min-width: 0;
          font-size: var(--type-base);
          color: var(--muted-foreground, var(--boxel-450));
        }
        @container fitted-card (height <= 50px) {
          .fit {
            grid-template-rows: 1fr;
            align-content: center;
          }
          .title {
            -webkit-line-clamp: 1;
          }
        }
        @container fitted-card (height > 50px) {
          .r-meta {
            display: flex;
          }
        }
        @container fitted-card (height > 50px) and (height <= 105px) {
          .title {
            -webkit-line-clamp: 1;
          }
        }
        @container fitted-card (height > 80px) {
          .r-body {
            display: flex;
          }
        }
        @container fitted-card (height > 160px) {
          .blurb {
            display: -webkit-box;
          }
        }
        @container fitted-card (height > 240px) {
          .blurb {
            -webkit-line-clamp: 4;
          }
          .tail {
            display: block;
          }
        }
        @container fitted-card (width > 300px) and (height <= 130px) {
          .fit {
            grid-template-columns: minmax(200px, 1fr) auto;
            grid-template-areas: 'head meta' 'body meta';
            align-items: center;
          }
          .r-meta {
            flex-direction: column;
            align-items: flex-end;
            gap: 1px;
          }
        }
        @container fitted-card (width <= 170px) {
          .fit-glyph {
            display: none;
          }
          /* The glyph is dropped just above, so from here down the anchor is
             type alone — and fitted-card Rule 2's typographic path wants real
             weight. Weight only, never size: at 150px the title is one word from
             wrapping and Rule 1 (nothing clipped) outranks Rule 2. */
          .title {
            font-weight: 700;
          }
        }
      </style>
    </template>
  };
}
