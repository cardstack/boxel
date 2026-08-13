import {
  CardDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import MarkdownField from '@cardstack/base/markdown';
import FileTextIcon from '@cardstack/boxel-icons/file-text';

// The merge vocabulary GenerateOfferLetterCommand understands. Kept here —
// next to the card whose body carries the placeholders — so the template's
// legend and the command's interpolation can never drift apart.
export const MERGE_FIELDS: Array<{ token: string; source: string }> = [
  { token: '{{candidateName}}', source: "the offer's linked candidate" },
  { token: '{{jobTitle}}', source: 'offer.offeredTitle (or position title)' },
  { token: '{{salary}}', source: 'offer.salary, formatted as dollars' },
  { token: '{{startDate}}', source: 'offer.startDate' },
  { token: '{{expiresDate}}', source: 'offer.expirationDate' },
  { token: '{{companyName}}', source: 'the company name given to the command' },
];

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g;

export function placeholdersIn(body?: string | null): string[] {
  if (!body) {
    return [];
  }
  let found = new Set<string>();
  for (let match of body.matchAll(PLACEHOLDER_RE)) {
    found.add(match[1]);
  }
  return [...found];
}

export class OfferLetterTemplate extends CardDef {
  static displayName = 'Offer Letter Template';
  static icon = FileTextIcon;

  @field name = contains(StringField);
  @field body = contains(MarkdownField, {
    description:
      'Letter body in markdown with merge placeholders like {{candidateName}}',
  });

  @field title = contains(StringField, {
    computeVia: function (this: OfferLetterTemplate) {
      return this.name?.trim() || 'Untitled Template';
    },
  });

  // Denormalized for fitted — a cheap own attribute the tile reads instead
  // of re-scanning the body at render time.
  @field placeholderTally = contains(StringField, {
    computeVia: function (this: OfferLetterTemplate) {
      let n = placeholdersIn(this.body).length;
      return n === 0 ? '' : String(n);
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get usedPlaceholders(): string[] {
      return placeholdersIn(this.args.model?.body);
    }

    get mergeFields() {
      let used = new Set(this.usedPlaceholders);
      return MERGE_FIELDS.map((f) => ({
        ...f,
        used: used.has(f.token.replace(/[{}]/g, '')),
      }));
    }

    <template>
      <article class='template-isolated'>
        <header class='hero'>
          <span class='avatar' aria-hidden='true'><FileTextIcon
              class='avatar-icon'
            /></span>
          <div class='hero-text'>
            <h1>{{@model.title}}</h1>
            <p class='byline'>Offer letter template
              {{#if @model.placeholderTally}}
                <span class='sep-dot'>&middot;</span>
                {{@model.placeholderTally}}
                merge fields
              {{/if}}
            </p>
          </div>
        </header>

        <div class='body'>
          <div class='main'>
            <h2 class='panel-title'>Letter body</h2>
            {{#if @model.body}}
              <div class='letter'>
                <@fields.body />
              </div>
            {{else}}
              <p class='empty'>No body yet — write the letter in markdown and
                drop in merge placeholders from the legend.</p>
            {{/if}}
          </div>

          <aside class='side'>
            <h2 class='panel-title'>Merge fields</h2>
            <p class='side-note'>Generate Offer Letter replaces these with the
              offer's real values. Fields marked in use appear in this
              template's body.</p>
            <ul class='legend'>
              {{#each this.mergeFields as |f|}}
                <li class='legend-row {{if f.used "used"}}'>
                  <code>{{f.token}}</code>
                  <span class='legend-src'>{{f.source}}</span>
                </li>
              {{/each}}
            </ul>
          </aside>
        </div>
      </article>
      <style scoped>
        .template-isolated {
          container-type: inline-size;
          container-name: iso;
          height: 100%;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          --tpl-id: var(--primary, var(--boxel-highlight));
          --tpl-strong: color-mix(
            in oklch,
            var(--tpl-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
        }
        .hero {
          flex: none;
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .avatar {
          flex: none;
          width: 3.25rem;
          height: 3.25rem;
          border-radius: 50%;
          display: grid;
          place-items: center;
          background: var(--tpl-strong);
          color: var(--background, var(--boxel-light));
        }
        .avatar-icon {
          width: 1.5rem;
          height: 1.5rem;
        }
        .hero-text {
          flex: 1;
          min-width: 0;
        }
        h1 {
          margin: 0;
          font-size: var(--boxel-font-size-xl);
          font-weight: 750;
          letter-spacing: -0.02em;
          line-height: 1.2;
          overflow-wrap: anywhere;
          font-family: var(--font-heading, inherit);
        }
        .byline {
          margin: var(--boxel-sp-5xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .sep-dot {
          margin: 0 0.25rem;
        }
        .body {
          display: grid;
          grid-template-columns: 1fr 17rem;
          flex: 1;
          min-height: 0;
          align-content: start;
        }
        .main {
          padding: var(--boxel-sp-lg);
          min-width: 0;
        }
        .side {
          padding: var(--boxel-sp-lg);
          border-left: 1px solid var(--border, var(--boxel-200));
          background: var(--muted, var(--boxel-100));
        }
        .panel-title {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
        }
        .letter {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius-sm);
          padding: var(--boxel-sp);
          background: var(--card, var(--boxel-light));
          font-size: var(--boxel-font-size-sm);
          line-height: 1.65;
          max-width: 62ch;
        }
        .side-note {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-xs);
          line-height: 1.5;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .legend {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .legend-row {
          display: flex;
          flex-direction: column;
          gap: 0.05rem;
          padding: 0.4rem 0;
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .legend-row:last-child {
          border-bottom: 0;
        }
        .legend-row code {
          font-family: var(--boxel-font-family-mono, ui-monospace, monospace);
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .legend-row.used code {
          color: var(--tpl-strong);
        }
        .legend-src {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .empty {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        @container iso (max-width: 40rem) {
          .body {
            grid-template-columns: 1fr;
          }
          .side {
            border-left: 0;
            border-top: 1px solid var(--border, var(--boxel-200));
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='template-embedded'>
        <span class='te-icon'><FileTextIcon class='te-icon-svg' /></span>
        <div class='te-main'>
          <span class='te-name'>{{@model.title}}</span>
          {{#if @model.placeholderTally}}
            <span class='te-sub'>{{@model.placeholderTally}}
              merge fields</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .template-embedded {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.75rem;
          font-size: 0.8125rem;
        }
        .te-icon {
          display: inline-flex;
          width: 28px;
          height: 28px;
          flex-shrink: 0;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
        }
        .te-icon-svg {
          width: 14px;
          height: 14px;
        }
        .te-main {
          display: flex;
          flex-direction: column;
          gap: 0.0625rem;
          min-width: 0;
          flex: 1;
        }
        .te-name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .te-sub {
          font-size: 0.6875rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='template-atom'>
        <FileTextIcon class='template-atom-icon' />
        <span class='template-atom-name'>{{@model.title}}</span>
      </span>
      <style scoped>
        .template-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .template-atom-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, var(--boxel-450));
          flex-shrink: 0;
        }
        .template-atom-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    // First ~30 words of the body with markdown syntax stripped — an own
    // attribute derivation, no link reads in this prerendered format.
    get bodyPreview(): string | undefined {
      let body = this.args.model?.body;
      if (!body) {
        return undefined;
      }
      let plain = body
        .replace(/[#*_>`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return plain.length > 160 ? `${plain.slice(0, 160)}…` : plain;
    }

    <template>
      <article class='fit'>
        <div class='fit-top'>
          <span class='avatar' aria-hidden='true'><FileTextIcon
              class='avatar-icon'
            /></span>
          <div class='fit-head'>
            <h3 class='fit-name'>{{@model.title}}</h3>
            <span class='fit-eb'>Offer letter template</span>
          </div>
        </div>

        <div class='fit-mid'>
          {{#if @model.placeholderTally}}
            <span class='money'>{{@model.placeholderTally}} merge fields</span>
          {{/if}}
        </div>

        {{#if this.bodyPreview}}
          <p class='fit-preview'>{{this.bodyPreview}}</p>
        {{/if}}
      </article>
      <style scoped>
        /* Tiers ADD content: name → field count → body preview. 11px floor. */
        .fit {
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 0.28rem;
          padding: 0.55rem 0.6rem;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
          --tpl-id: var(--primary, var(--boxel-highlight));
          --tpl-strong: color-mix(
            in oklch,
            var(--tpl-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
          --fit-name: clamp(11px, 3.2cqi, 15px);
          --fit-small: clamp(11px, 2.6cqi, 12px);
        }
        .fit > * {
          min-height: 0;
          overflow: hidden;
        }
        .fit-top {
          flex: none;
          display: flex;
          align-items: flex-start;
          gap: 0.4rem;
          flex-wrap: wrap;
        }
        .avatar {
          flex: none;
          width: 1.6rem;
          height: 1.6rem;
          border-radius: 50%;
          display: grid;
          place-items: center;
          background: var(--tpl-strong);
          color: var(--background, var(--boxel-light));
        }
        .avatar-icon {
          width: 0.85rem;
          height: 0.85rem;
        }
        .fit-head {
          flex: 1;
          min-width: 0;
        }
        .fit-name {
          margin: 0;
          font-size: var(--fit-name);
          font-weight: 700;
          line-height: 1.25;
          letter-spacing: -0.01em;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .fit-eb {
          display: none;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-mid {
          flex: none;
          display: none;
        }
        .money {
          font-size: calc(var(--fit-name) * 1.05);
          font-weight: 800;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
        }
        .fit-preview {
          display: none;
          margin: 0;
          margin-top: auto;
          padding-top: 0.3rem;
          border-top: 1px dashed var(--border, var(--boxel-200));
          font-size: var(--fit-small);
          line-height: 1.4;
          color: var(--muted-foreground, var(--boxel-450));
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 3;
          overflow: hidden;
        }

        /* TIER 2 — add the kind line. Two rules: no `or` in CQ. */
        @container fitted-card (height > 80px) {
          .fit-eb {
            display: block;
          }
        }
        @container fitted-card (width > 240px) {
          .fit-eb {
            display: block;
          }
        }
        /* TIER 3 — add the merge-field count. */
        @container fitted-card (height > 130px) and (width > 180px) {
          .fit-mid {
            display: block;
          }
        }
        /* TIER 4 — add the body preview. */
        @container fitted-card (height > 150px) and (width > 180px) {
          .fit-preview {
            display: -webkit-box;
          }
        }
        @container fitted-card (height <= 90px) {
          .fit-top {
            align-items: center;
            flex-wrap: nowrap;
          }
          .fit-name {
            -webkit-line-clamp: 1;
          }
        }
        @container fitted-card (height <= 50px) {
          .fit-eb {
            display: none;
          }
        }
      </style>
    </template>
  };
}
