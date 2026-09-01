import {
  CardDef,
  field,
  contains,
  linksTo,
  StringField,
  Component,
} from '@cardstack/base/card-api';
import BooleanField from '@cardstack/base/boolean';
import DateField from '@cardstack/base/date';
import MarkdownField from '@cardstack/base/markdown';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
// NOTE (unverified in this realm): the `@cardstack/catalog/*` prefix is a
// registered realm alias resolved at runtime by the loader/fetcher
// (see runtime-common/fetcher.ts), NOT a package.json dependency. No module in
// experiments-realm imports it yet, so this is the first use here — confirm it
// resolves in the `type='instance'` index rows before building on it. If the
// prefix is not registered for this realm, the fallback is the absolute realm URL
// of the catalog module.
import MultiImageSourceField from '@cardstack/catalog/fields/multi-image-source/multi-image-source';
import { SoleVaultPerson } from './sole-vault-person';
import { ConditionGrade } from './condition-grade';
import { Acquisition } from './acquisition';
import ArchiveIcon from '@cardstack/boxel-icons/archive';
import BadgeCheckIcon from '@cardstack/boxel-icons/badge-check';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import ReceiptIcon from '@cardstack/boxel-icons/receipt';
import CoinsIcon from '@cardstack/boxel-icons/coins';
import RulerIcon from '@cardstack/boxel-icons/ruler';
import NotebookPenIcon from '@cardstack/boxel-icons/notebook-pen';
import TrendingUpIcon from '@cardstack/boxel-icons/trending-up';
import TrendingDownIcon from '@cardstack/boxel-icons/trending-down';
import ImageOffIcon from '@cardstack/boxel-icons/image-off';
import ShoppingBagIcon from '@cardstack/boxel-icons/shopping-bag';
import { tracked } from '@glimmer/tracking';
import {
  Accordion,
  FieldContainer,
  FittedCard,
  Pill,
  ProgressBar,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { formatMoney, formatMoneyDelta } from './money-format';

// CollectionItem — one physical thing someone owns, catalogued.
//
// The block is deliberately NOT about sneakers. `item` links to any CardDef, so
// the same block catalogues a sneaker, a watch, a record, or a first edition; the
// consumer narrows the link type and supplies the grading vocabulary. Nothing in
// this module names a domain.
//
// Two schema decisions worth reading before changing them:
//
// 1. THRESHOLD FLAGS ARE EVENT FACTS. `verified` and `forSale` are computed from
//    `verifiedOn` and `listedAt`. Storing either boolean lets it drift from the
//    thing that caused it — the classic failure is a card that reads "not for
//    sale" while an active listing points at it. Dates are also attributes, so
//    they survive prerendered fitted views, where a linksTo would not resolve.
//
// 2. NO CURRENT-MARKET-VALUE FIELD. "What is this worth right now" is a
//    reporting rollup over active listings — unbounded, and a live realm query
//    belongs in a metrics component a consumer composes, never link-arrayed onto
//    the hot card. `lastKnownValue` + `valuedOn` is the fitted-safe snapshot: an
//    attribute a tile can render without running a query.

export class CollectionItem extends CardDef {
  static displayName = 'Collection Item';
  // Image-led hero + wide detail grid genuinely wants the full stack width,
  // not the ~800px single-record cap — see isolated-card Rule 1b.
  static icon = ArchiveIcon;

  // The catalogued thing. Consumers narrow this (linksTo(() => Product)).
  //
  // `searchable: true` pulls the linked card's fields into this card's search
  // document, which is what lets a collection view filter and sort by the thing
  // owned ("all my Jordan 1s") instead of only by this card's own attributes.
  @field item = linksTo(CardDef, { searchable: true });

  // The size/edition/variant label, and the scale it is expressed on.
  // Checked and rejected as substitutes: catalog `quantity` is a bounded count,
  // catalog `discrete-range-field` is a range. A single graded value on a named
  // scale is neither, and the scale is the consumer's ('US', 'UK', 'EU', 'cm').
  @field variant = contains(StringField);
  @field variantScale = contains(StringField);

  @field condition = contains(ConditionGrade);

  // 'OG All', 'Replacement Box', 'No Box' — a fixed list per domain, so the
  // consumer supplies enum options on its own override of this field.
  @field packaging = contains(StringField);

  @field acquisition = contains(Acquisition);

  // The owner's own photos. Takes a pasted URL or a file uploaded into the
  // realm; `photos.primaryUrl` is the fitted visual anchor.
  @field photos = contains(MultiImageSourceField);

  // --- authentication, as event facts ---
  @field verifiedOn = contains(DateField);
  @field verifiedBy = contains(StringField);
  @field verificationReference = contains(StringField);
  @field verified = contains(BooleanField, {
    computeVia: function (this: CollectionItem) {
      return this.verifiedOn != null;
    },
  });

  // --- for-sale state, as an event fact ---
  @field listedAt = contains(DateField);
  @field forSale = contains(BooleanField, {
    computeVia: function (this: CollectionItem) {
      return this.listedAt != null;
    },
  });

  // Fitted-safe valuation snapshot. See note 2 above.
  @field lastKnownValue = contains(AmountWithCurrency);
  @field valuedOn = contains(DateField);

  // Whose copy this is. Previously omitted because the source was undecided
  // between three candidates; settled by pulling the matrix's Person block into
  // this realm, so it is consumed rather than re-modelled here.
  @field owner = linksTo(() => SoleVaultPerson, { searchable: true });

  @field notes = contains(MarkdownField);

  // DENORMALIZED FOR PRERENDERED FITTED — do not "simplify" this to
  // `@model.item.title` in a template.
  //
  // A collection view draws its grid and list from prerendered fitted HTML, and
  // prerendered fitted cannot resolve linksTo/linksToMany. A tile that reads the
  // linked card directly renders blank — which is every tile in the grid, since
  // the thing owned is the tile's headline. A computed field is resolved at INDEX
  // time and stored in the search document, so it is a plain attribute by the time
  // fitted renders and survives the trip.
  //
  // Defensive on purpose: `item` may be unlinked (the block is neutral, the link
  // is optional) or not yet loaded, so this optional-chains and falls back to the
  // card's own title rather than rendering 'undefined'.
  @field itemTitle = contains(StringField, {
    computeVia: function (this: CollectionItem) {
      return this.item?.cardInfo?.name ?? this.cardInfo?.name ?? '';
    },
  });

  @field variantLabel = contains(StringField, {
    computeVia: function (this: CollectionItem) {
      if (!this.variant) {
        return '';
      }
      return this.variantScale
        ? `${this.variantScale} ${this.variant}`
        : this.variant;
    },
  });

  // EDIT — grouped sections, not the schema wearing input boxes (edit-card
  // Rule 0). The fields glanced at every time sit compact up top; everything
  // else is an independently collapsible section. `verified`, `forSale`,
  // `itemTitle`, `variantLabel` are computed and deliberately absent.
  static edit = class Edit extends Component<typeof CollectionItem> {
    @tracked valuationOpen = true;
    @tracked conditionOpen = true;
    @tracked acquisitionOpen = false;
    @tracked authOpen = false;
    @tracked photosOpen = false;
    @tracked notesOpen = false;

    toggleValuation = () => (this.valuationOpen = !this.valuationOpen);
    toggleCondition = () => (this.conditionOpen = !this.conditionOpen);
    toggleAcquisition = () => (this.acquisitionOpen = !this.acquisitionOpen);
    toggleAuth = () => (this.authOpen = !this.authOpen);
    togglePhotos = () => (this.photosOpen = !this.photosOpen);
    toggleNotes = () => (this.notesOpen = !this.notesOpen);

    <template>
      <div class='ci-edit'>
        <header class='ce-head'>
          <FieldContainer
            @label='Item'
            @tag='label'
            @vertical={{true}}
            class='ce-item'
          >
            <@fields.item />
          </FieldContainer>
          <div class='ce-identity'>
            <FieldContainer @label='Variant' @tag='label' @vertical={{true}}>
              <@fields.variant />
            </FieldContainer>
            <FieldContainer @label='Scale' @tag='label' @vertical={{true}}>
              <@fields.variantScale />
            </FieldContainer>
            <FieldContainer @label='Packaging' @tag='label' @vertical={{true}}>
              <@fields.packaging />
            </FieldContainer>
            <FieldContainer @label='Owner' @tag='label' @vertical={{true}}>
              <@fields.owner />
            </FieldContainer>
          </div>
        </header>

        <Accordion class='ce-sections' @displayContainer={{false}} as |A|>
          <A.Item
            @id='valuation'
            @isOpen={{this.valuationOpen}}
            @onClick={{this.toggleValuation}}
          >
            <:title>Valuation & sale</:title>
            <:content>
              <div class='ce-body ce-grid-3'>
                <FieldContainer
                  @label='Last known value'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.lastKnownValue />
                </FieldContainer>
                <FieldContainer
                  @label='Valued on'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.valuedOn />
                </FieldContainer>
                <FieldContainer
                  @label='Listed at'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.listedAt />
                  <p class='ce-help'>Setting a listed date marks this item as
                    for sale; clearing it withdraws it.</p>
                </FieldContainer>
              </div>
            </:content>
          </A.Item>

          <A.Item
            @id='condition'
            @isOpen={{this.conditionOpen}}
            @onClick={{this.toggleCondition}}
          >
            <:title>Condition</:title>
            <:content>
              <div class='ce-body'>
                <@fields.condition />
              </div>
            </:content>
          </A.Item>

          <A.Item
            @id='acquisition'
            @isOpen={{this.acquisitionOpen}}
            @onClick={{this.toggleAcquisition}}
          >
            <:title>Acquisition</:title>
            <:content>
              <div class='ce-body'>
                <@fields.acquisition />
              </div>
            </:content>
          </A.Item>

          <A.Item
            @id='authentication'
            @isOpen={{this.authOpen}}
            @onClick={{this.toggleAuth}}
          >
            <:title>Authentication</:title>
            <:content>
              <div class='ce-body ce-grid-3'>
                <FieldContainer
                  @label='Verified on'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.verifiedOn />
                  <p class='ce-help'>A verification date is what marks the item
                    authenticated.</p>
                </FieldContainer>
                <FieldContainer
                  @label='Verified by'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.verifiedBy />
                </FieldContainer>
                <FieldContainer
                  @label='Reference'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.verificationReference />
                </FieldContainer>
              </div>
            </:content>
          </A.Item>

          <A.Item
            @id='photos'
            @isOpen={{this.photosOpen}}
            @onClick={{this.togglePhotos}}
          >
            <:title>Photos</:title>
            <:content>
              <div class='ce-body'>
                <@fields.photos />
              </div>
            </:content>
          </A.Item>

          <A.Item
            @id='notes'
            @isOpen={{this.notesOpen}}
            @onClick={{this.toggleNotes}}
          >
            <:title>Notes</:title>
            <:content>
              <div class='ce-body'>
                <@fields.notes />
              </div>
            </:content>
          </A.Item>
        </Accordion>
      </div>

      <style scoped>

        /* edit-card Rule 1: no ancestor declares a container for the edit
           format, so @container below is dead CSS unless we declare our own —
           named, so a stray query elsewhere cannot claim it. */
        .ci-edit {
          container-type: inline-size;
          container-name: ci-edit;

          /* Committed vault palette — literal values, no theme-var chain. */
          --background: oklch(0.985 0.001 106.42);
          --ink-900: var(--background);
          --card: oklch(1 0 0);
          --card-foreground: oklch(0.147 0.004 49.25);
          --ink-800: var(--card);
          --ink-700: color-mix(in oklch, var(--card, oklch(0.216 0.006 56.04)) 80%, var(--foreground, white) 20%);
          --foreground: oklch(0.147 0.004 49.25);
          --paper: var(--foreground);
          --muted: oklch(0.97 0.001 106.42);
          --secondary: oklch(0.923 0.003 48.72);
          --secondary-foreground: oklch(0.216 0.006 56.04);
          --input: oklch(1 0 0);
          --popover: oklch(1 0 0);
          --popover-foreground: oklch(0.147 0.004 49.25);
          --muted-foreground: oklch(0.553 0.013 58.07);
          --smoke: var(--muted-foreground);
          --border: oklch(0.869 0.005 56.37);
          --hairline: color-mix(in oklch, var(--border) 55%, transparent);
          --primary: oklch(0.666 0.179 58.32);
          --primary-foreground: oklch(0.216 0.006 56.04);
          --destructive: oklch(0.577 0.245 27.32);
          --destructive-foreground: oklch(0.985 0.001 106.42);
          --ring: var(--primary);
          --gold: var(--primary);
          /* Text-grade gold for sub-18px strings: bare --gold on white sits under
             AA. oklab, not oklch (hue-rotates against achromatic endpoints). */
          --gold-ink: color-mix(in oklab, var(--gold) 72%, var(--foreground));
          --accent: oklch(0.769 0.188 70.08);
          --accent-foreground: oklch(0.216 0.006 56.04);
          --gold-bright: var(--accent);
          --shadow-1: 0 1px 2px oklch(0.05 0 0 / 0.08);

          --font-display: var(--font-serif, 'Playfair Display', Georgia, serif);
          
          background: var(--ink-900);
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp-lg);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
          box-sizing: border-box;

          scrollbar-color: var(--gold) var(--ink-800);
        }
        .ci-edit::-webkit-scrollbar {
          width: 10px;
        }
        .ci-edit::-webkit-scrollbar-track {
          background: var(--ink-800);
        }
        .ci-edit::-webkit-scrollbar-thumb {
          background: var(--gold);
          border-radius: 999px;
          border: 2px solid var(--ink-800);
        }
        .ci-edit ::selection {
          background: var(--gold);
          color: var(--ink-900);
        }
        .ci-edit *:focus-visible {
          outline: 2px solid var(--gold);
          outline-offset: 2px;
        }
        .ce-head {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
          border-bottom: 1px solid var(--hairline);
          padding-bottom: var(--boxel-sp);
        }
        .ce-identity {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: var(--boxel-sp-sm);
        }
        .ce-body {
          padding: var(--boxel-sp-sm) var(--boxel-sp-xs);
        }
        .ce-grid-3 {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: var(--boxel-sp-sm);
        }
        .ce-help {
          margin: var(--boxel-sp-4xs) 0 0;
          font-size: var(--boxel-font-size-xs);
          line-height: 1.4;
          color: var(--smoke);
        }
        .ci-edit :deep(.boxel-label) {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: var(--boxel-font-size-xs);
          font-weight: 500;
          color: var(--smoke);
        }
        /* Accordion sections restyled as gold-hairline panels, real depth
           rather than a flat divider. */
        .ce-sections :deep(.boxel-accordion-item) {
          background: var(--ink-800);
          border: 1px solid var(--hairline);
          border-radius: 10px;
          box-shadow: var(--shadow-1);
          overflow: hidden;
        }
        .ce-sections :deep(.boxel-accordion-item + .boxel-accordion-item) {
          margin-top: var(--boxel-sp-sm);
        }

        @container ci-edit (width < 640px) {
          .ce-identity,
          .ce-grid-3 {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof CollectionItem> {
    <template>
      <span class='item-atom'>
        <span class='name'>{{@model.itemTitle}}</span>
        {{#if @model.variantLabel}}
          <span class='variant'>{{@model.variantLabel}}</span>
        {{/if}}
        <@fields.condition @format='atom' />
      </span>
      <style scoped>
        .item-atom {
          display: inline-flex;
          align-items: baseline;
          gap: var(--boxel-sp-xxs);
          max-width: 100%;
        }
        .name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .variant {
          font-size: var(--boxel-font-size-xs);
          color: var(--boxel-500);
          white-space: nowrap;
        }
      </style>
    </template>
  };

  // Row-shaped embedded, for lists a consumer builds.
  //
  // Every trailing data slot is ALWAYS rendered at a constant width, em-dash when
  // empty, so a consumer's list column-aligns regardless of which rows happen to
  // carry a value or a per-row action.
  static embedded = class Embedded extends Component<typeof CollectionItem> {
    <template>
      <div class='row'>
        <div class='thumb'>
          {{#if @model.photos.primaryUrl}}
            <img
              src={{@model.photos.primaryUrl}}
              alt={{@model.itemTitle}}
              loading='lazy'
            />
          {{else}}
            <ArchiveIcon width='18' height='18' />
          {{/if}}
        </div>

        <div class='identity'>
          <div class='name'>{{if
              @model.itemTitle
              @model.itemTitle
              'Untitled item'
            }}</div>
          <div class='sub'>
            {{#if @model.variantLabel}}{{@model.variantLabel}}{{else}}—{{/if}}
            {{#if @model.packaging}}
              <span class='dot'>·</span>{{@model.packaging}}
            {{/if}}
          </div>
        </div>

        <div class='slot slot--condition'>
          <@fields.condition @format='atom' />
        </div>

        <div class='slot slot--state'>
          {{#if @model.verified}}
            <span class='chip chip--verified'>Verified</span>
          {{else if @model.forSale}}
            <span class='chip chip--sale'>For sale</span>
          {{else}}
            <span class='chip chip--none'>—</span>
          {{/if}}
        </div>

        <div class='slot slot--value'>
          {{#if @model.lastKnownValue}}
            <@fields.lastKnownValue @format='atom' />
          {{else}}
            <span class='muted'>—</span>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .row {
          display: grid;
          grid-template-columns: 2.5rem minmax(0, 1fr) 6rem 6rem 7rem;
          gap: var(--boxel-sp-sm);
          align-items: center;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          color: var(--boxel-dark);
        }
        .thumb {
          width: 2.5rem;
          height: 2.5rem;
          display: grid;
          place-items: center;
          border-radius: var(--boxel-border-radius-sm);
          overflow: hidden;
          background: var(--boxel-100);
          color: var(--boxel-400);
        }
        .thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .identity {
          min-width: 0;
        }
        .name {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sub {
          font-size: var(--boxel-font-size-xs);
          color: var(--boxel-500);
        }
        .dot {
          margin: 0 0.25em;
        }
        .slot {
          font-size: var(--boxel-font-size-sm);
        }
        .slot--value {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        .chip {
          display: inline-block;
          padding: 0.1em 0.5em;
          border-radius: 999px;
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
        }
        .chip--verified {
          background: var(--boxel-100);
          color: var(--boxel-dark);
        }
        .chip--sale {
          background: var(--boxel-100);
          color: var(--boxel-dark);
        }
        .chip--none {
          color: var(--boxel-400);
        }
        .muted {
          color: var(--boxel-400);
        }
      </style>
    </template>
  };

  // THE DOMAIN QUESTION this view answers, above the fold:
  //   "Is it genuine, and what is it worth against what I paid?"
  //
  // Not "show me the item". A collector opens an owned item to check its
  // authentication state and its position versus cost — the spec's own framing is
  // that the collection IS the inventory and the storefront. Both halves of that
  // answer are attributes already on the card (`verifiedOn`, `lastKnownValue`,
  // `acquisition.price`), so the hero needs no reverse query.
  //
  // DIRECTION: Object (image-led — the thing itself first), per the family
  // decision in `sole-vault-design-system.md`.
  // SIGNATURE ELEMENT for the family: the provenance rail. It is drawn from the
  // three lifecycle dates this schema deliberately stores as event facts
  // (`acquisition.acquiredOn`, `verifiedOn`, `listedAt`), so it is the shape of
  // this particular record made visible rather than decoration laid over it — and
  // every card in the Sole Vault family has those dates, which is what makes it a
  // family signature instead of a per-card marquee.
  static isolated = class Isolated extends Component<typeof CollectionItem> {
    get worthNow() {
      return formatMoney(this.args.model?.lastKnownValue);
    }

    get paid() {
      return formatMoney(this.args.model?.acquisition?.price);
    }

    get delta() {
      return formatMoneyDelta(
        this.args.model?.lastKnownValue,
        this.args.model?.acquisition?.price,
      );
    }

    get retention() {
      let v = this.args.model?.condition?.valueRetention;
      return v == null ? null : Math.max(0, Math.min(100, v));
    }

    get hasProvenance() {
      let m = this.args.model;
      return Boolean(
        m.acquisition?.acquiredOnDay || m.verifiedOn || m.listedAt,
      );
    }

    <template>
      <article class='card'>
        <header class='hero'>
          <div class='hero-photo'>
            {{#if @model.photos.primaryUrl}}
              <img src={{@model.photos.primaryUrl}} alt={{@model.itemTitle}} />
            {{else}}
              {{! Empty state, not a decorative placeholder box — it says the
                  photo is missing rather than filling the slot with grey. }}
              <div class='photo-empty'>
                <ImageOffIcon width='28' height='28' aria-hidden='true' />
                <span>No photo yet</span>
              </div>
            {{/if}}
          </div>

          <div class='hero-body'>
            <p class='eyebrow'>
              <ArchiveIcon
                width='max(12px, 0.9em)'
                height='max(12px, 0.9em)'
                aria-hidden='true'
              />
              Collection item
              {{#if @model.variantLabel}}
                <span class='eyebrow-sep'>·</span>{{@model.variantLabel}}
              {{/if}}
            </p>

            <h1 class='hero-title'>{{if
                @model.itemTitle
                @model.itemTitle
                'Untitled item'
              }}</h1>

            <div class='answer'>
              {{#if this.worthNow}}
                <p class='worth'>{{this.worthNow}}</p>
                {{#if this.delta}}
                  <p class='delta delta--{{this.delta.direction}}'>
                    {{#if (eq this.delta.direction 'up')}}
                      <TrendingUpIcon
                        width='max(14px, 1em)'
                        height='max(14px, 1em)'
                        aria-hidden='true'
                      />
                    {{else if (eq this.delta.direction 'down')}}
                      <TrendingDownIcon
                        width='max(14px, 1em)'
                        height='max(14px, 1em)'
                        aria-hidden='true'
                      />
                    {{/if}}
                    {{this.delta.text}}
                    {{#if this.delta.percent}}
                      <span class='delta-pct'>({{this.delta.percent}})</span>
                    {{/if}}
                    <span class='delta-vs'>vs paid</span>
                  </p>
                {{/if}}
              {{else}}
                <p class='worth worth--unknown'>Not valued</p>
              {{/if}}

              <div class='badges'>
                {{#if @model.verified}}
                  <span class='badge badge--verified'>
                    <BadgeCheckIcon
                      width='max(13px, 0.95em)'
                      height='max(13px, 0.95em)'
                      aria-hidden='true'
                    />
                    Authenticated
                  </span>
                {{else}}
                  <span class='badge badge--plain'>Not authenticated</span>
                {{/if}}
                {{#if @model.forSale}}
                  <span class='badge badge--sale'>
                    <ShoppingBagIcon
                      width='max(13px, 0.95em)'
                      height='max(13px, 0.95em)'
                      aria-hidden='true'
                    />
                    Listed
                  </span>
                {{/if}}
              </div>
            </div>
          </div>
        </header>

        {{! AT A GLANCE — shape: ul. Three figures, and the only mark on the card
            is a proportion rail, because valueRetention IS a proportion of a
            whole. The paid→worth relationship is a single delta, so it is a
            figure with an arrow, not a chart. }}
        <section class='sec glance'>
          <h2><CoinsIcon class='sec-icon' aria-hidden='true' />At a glance</h2>
          <ul class='stats'>
            <li class='stat'>
              <span class='stat-k'>Paid</span>
              <span class='stat-v'>{{if this.paid this.paid '—'}}</span>
            </li>
            <li class='stat'>
              <span class='stat-k'>Worth now</span>
              <span class='stat-v'>{{if this.worthNow this.worthNow '—'}}</span>
            </li>
            <li class='stat stat--rail'>
              <span class='stat-k'>Condition</span>
              <span class='stat-v'>
                {{#if
                  @model.condition.code
                }}{{@model.condition.code}}{{else}}—{{/if}}
                {{#if this.retention}}
                  <span class='stat-sub'>{{this.retention}}% of market</span>
                {{/if}}
              </span>
              {{! boxel-ui ProgressBar, not a hand-rolled rail. It carries
                  role='progressbar' with aria-valuenow/min/max/valuetext, which
                  is strictly better semantics than the role='img' + aria-label
                  this used to be — a screen reader announces the value, not a
                  sentence someone remembered to write. It also removes the
                  htmlSafe style-string getter this needed; the component owns
                  its own fill width. Skinned to the vault hairline via its
                  published knobs below. }}
              {{#if this.retention}}
                {{! aria-label attribute, not @label — @label renders as
                    visible text inside this 5px rail and shears. }}
                <ProgressBar
                  class='rail'
                  @value={{this.retention}}
                  @max={{100}}
                  aria-label='Market value retained'
                />
              {{/if}}
            </li>
          </ul>
        </section>

        <div class='cols'>
          {{! SIGNATURE ELEMENT — shape: ol. The record's own lifecycle, drawn
              from the event-fact dates. }}
          <section class='sec'>
            <h2><CalendarIcon
                class='sec-icon'
                aria-hidden='true'
              />Provenance</h2>
            {{#if this.hasProvenance}}
              <ol class='prov'>
                {{#if @model.acquisition.acquiredOnDay}}
                  <li class='prov-step prov-step--done'>
                    <span class='prov-label'>Acquired</span>
                    <span
                      class='prov-when'
                    >{{@model.acquisition.acquiredOnDay}}</span>
                    {{#if @model.acquisition.source}}
                      <span
                        class='prov-note'
                      >{{@model.acquisition.source}}</span>
                    {{/if}}
                  </li>
                {{/if}}
                {{#if @model.verified}}
                  <li class='prov-step prov-step--done'>
                    <span class='prov-label'>Authenticated</span>
                    <span class='prov-when'><@fields.verifiedOn
                        @format='atom'
                      /></span>
                    {{#if @model.verifiedBy}}
                      <span class='prov-note'>{{@model.verifiedBy}}</span>
                    {{/if}}
                  </li>
                {{else}}
                  <li class='prov-step prov-step--todo'>
                    <span class='prov-label'>Authentication</span>
                    <span class='prov-when'>Not submitted</span>
                  </li>
                {{/if}}
                {{#if @model.forSale}}
                  <li class='prov-step prov-step--done'>
                    <span class='prov-label'>Listed for sale</span>
                    <span class='prov-when'><@fields.listedAt
                        @format='atom'
                      /></span>
                  </li>
                {{/if}}
              </ol>
            {{else}}
              <p class='empty'>
                <CalendarIcon width='20' height='20' aria-hidden='true' />
                No dates recorded yet — an acquisition date starts the trail.
              </p>
            {{/if}}
          </section>

          {{! shape: dl }}
          <section class='sec'>
            <h2><ReceiptIcon
                class='sec-icon'
                aria-hidden='true'
              />Acquisition</h2>
            <@fields.acquisition @format='embedded' />
          </section>
        </div>

        {{! shape: ul of chips — identity, deliberately a different shape from the dl above }}
        <section class='sec'>
          <h2><RulerIcon class='sec-icon' aria-hidden='true' />Specifics</h2>
          <ul class='chips'>
            <li><span class='chip-k'>Variant</span><span class='chip-v'>{{if
                  @model.variantLabel
                  @model.variantLabel
                  '—'
                }}</span></li>
            <li><span class='chip-k'>Packaging</span><span class='chip-v'>{{if
                  @model.packaging
                  @model.packaging
                  '—'
                }}</span></li>
            <li><span class='chip-k'>Cert. ref</span><span
                class='chip-v chip-v--id'
              >{{if
                  @model.verificationReference
                  @model.verificationReference
                  '—'
                }}</span></li>
            <li><span class='chip-k'>Receipt ref</span><span
                class='chip-v chip-v--id'
              >{{if
                  @model.acquisition.reference
                  @model.acquisition.reference
                  '—'
                }}</span></li>
          </ul>
        </section>

        {{! shape: prose }}
        <section class='sec'>
          <h2><NotebookPenIcon class='sec-icon' aria-hidden='true' />Notes</h2>
          {{#if @model.notes}}
            <div class='prose'><@fields.notes /></div>
          {{else}}
            <p class='empty'>
              <NotebookPenIcon width='20' height='20' aria-hidden='true' />
              Nothing written down about this one yet.
            </p>
          {{/if}}
        </section>

        {{! NO ACTIONS ZONE — a deliberate, named gap, not an oversight.
            The actions this view wants (List for sale, Submit for authentication,
            Log a valuation) are unbuilt matrix elements: `PlaceOrder`,
            `AuthenticateItem` and `CreateListing` are all on the BUILD list in
            sole-vault-matrix-inventory.md. Rendering buttons for them now would be
            lying affordances — a control that looks live and does nothing teaches
            the user to distrust every other control on the card. The zone lands
            with the commands. }}
      </article>

      <style scoped>

        /* --- Rule 1: an isolated card gets NO host container. Declaring our own
           is the one line that makes every @container rule below live rather than
           inert CSS. `inline-size`, not `size`: this column scrolls vertically and
           `size` needs a definite block size, which would collapse it. --- */
        .card {
          container-type: inline-size;
          container-name: card;
          width: 100%;
          height: 100%;
          overflow-y: auto;

          /* Committed vault palette — literal values, no theme-var fallback
             chain (this app dropped the swappable-theme pattern). Same names
             and values the family shell (sole-vault-app.gts) uses, so the
             flagship record card reads as one app with it. */
          --ink-950: var(--primary-foreground, oklch(0.216 0.006 56.04));
          --background: oklch(0.985 0.001 106.42);
          --ink-900: var(--background);
          --card: oklch(1 0 0);
          --card-foreground: oklch(0.147 0.004 49.25);
          --ink-800: var(--card);
          --ink-700: color-mix(in oklch, var(--card, oklch(0.216 0.006 56.04)) 80%, var(--foreground, white) 20%);
          --foreground: oklch(0.147 0.004 49.25);
          --paper: var(--foreground);
          --muted: oklch(0.97 0.001 106.42);
          --secondary: oklch(0.923 0.003 48.72);
          --secondary-foreground: oklch(0.216 0.006 56.04);
          --input: oklch(1 0 0);
          --popover: oklch(1 0 0);
          --popover-foreground: oklch(0.147 0.004 49.25);
          --muted-foreground: oklch(0.553 0.013 58.07);
          --smoke: var(--muted-foreground);
          --border: oklch(0.869 0.005 56.37);
          --hairline: color-mix(in oklch, var(--border) 55%, transparent);
          --primary: oklch(0.666 0.179 58.32);
          --primary-foreground: oklch(0.216 0.006 56.04);
          --destructive: oklch(0.577 0.245 27.32);
          --destructive-foreground: oklch(0.985 0.001 106.42);
          --ring: var(--primary);
          --gold: var(--primary);
          /* Text-grade gold for sub-18px strings: bare --gold on white sits under
             AA. oklab, not oklch (hue-rotates against achromatic endpoints). */
          --gold-ink: color-mix(in oklab, var(--gold) 72%, var(--foreground));
          --accent: oklch(0.769 0.188 70.08);
          --accent-foreground: oklch(0.216 0.006 56.04);
          --gold-bright: var(--accent);
          --verified: oklch(0.72 0.16 152);
          --for-sale: var(--gold);
          --on-for-sale: var(--ink-950);
          /* TEXT-on-dark red, not the fill red — the value-delta IS text, and a
             filled chip here would out-shout the gold plaque figure. Lightened
             off the raw danger hue so it clears 4.5:1 against --ink-900. */
          --down: oklch(0.7 0.19 25);
          /* Darker siblings of the two hues above, for text ON THE GOLD PLAQUE
             (the delta lives inside the filled `.answer` panel, not on the dark
             ground) — the light on-dark shades above measure below 4.5:1
             against gold's own lightness, so the delta needs its own pair. */
          --verified-on-gold: oklch(0.32 0.1 152);
          --down-on-gold: oklch(0.38 0.16 25);

          --shadow-1: 0 1px 2px oklch(0.05 0 0 / 0.08);
          --shadow-2: 0 8px 24px -8px oklch(0.05 0 0 / 0.14);
          --shadow-3: 0 20px 48px -16px oklch(0.05 0 0 / 0.18);

          --font-display: var(--font-serif, 'Playfair Display', Georgia, serif);
                    --font-mono: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;

          /* Rule 4: ONE panel primitive. Tint may differ per block; padding and
             radius may not — that is what keeps blocks registered with each other. */
          --panel-pad: var(--boxel-sp) var(--boxel-sp-lg) var(--boxel-sp-lg);
          /* 14px — the family's one shared plaque/panel radius (matches
             CompletionSet, AuthenticationRecord, Payment, Offer, Listing,
             CollectibleProduct exactly; do not drift this value locally). */
          --panel-radius: 14px;

          background: var(--ink-900);
          background-image: radial-gradient(
            ellipse 1100px 600px at 15% -10%,
            var(--ink-800) 0%,
            transparent 60%
          );
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          padding: var(--boxel-sp-lg);
          /* Rule 4 corollary: ONE vertical rhythm mechanism — the parent's gap.
             No child margin-top anywhere, so there is no override to undo it. */
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);

          scrollbar-color: var(--gold) var(--ink-800);
        }
        .card::-webkit-scrollbar {
          width: 10px;
        }
        .card::-webkit-scrollbar-track {
          background: var(--ink-800);
        }
        .card::-webkit-scrollbar-thumb {
          background: var(--gold);
          border-radius: 999px;
          border: 2px solid var(--ink-800);
        }
        .card ::selection {
          background: var(--gold);
          color: var(--ink-950);
        }
        .card *:focus-visible {
          outline: 2px solid var(--gold);
          outline-offset: 2px;
        }

        /* ---------- hero ---------- */
        .hero {
          display: grid;
          grid-template-columns: min(240px, 28%) minmax(0, 1fr);
          gap: var(--boxel-sp-lg);
          align-items: start;
        }
        /* Rule 5: the photo is the anchor at real width, never a thumbnail. */
        .hero-photo {
          aspect-ratio: 1;
          border-radius: var(--panel-radius);
          overflow: hidden;
          background: var(--ink-700);
          box-shadow: var(--shadow-2);
          display: grid;
          place-items: center;
        }
        .hero-photo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .photo-empty {
          display: grid;
          justify-items: center;
          gap: var(--boxel-sp-4xs);
          color: var(--smoke);
          font-size: 0.75rem;
          text-align: center;
          padding: var(--boxel-sp-sm);
        }
        .hero-body {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }
        .eyebrow {
          margin: 0;
          display: flex;
          align-items: center;
          gap: 0.4em;
          font-size: 0.6875rem; /* 11px floor — never smaller */
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--smoke);
        }
        .eyebrow-sep {
          opacity: 0.6;
        }
        .hero-title {
          margin: 0;
          font-family: var(--font-display);
          font-size: 1.75rem;
          line-height: 1.15;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        /* THE VAULT PLAQUE — light translation of the family signature:
           gold top-rule over the serif ink worth figure, matching the shell's
           ledger-hero. The dark-era filled gold panel reads as an orange slab
           on white. */
        .answer {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: var(--boxel-sp-xs) var(--boxel-sp);
          margin-top: auto;
          background: var(--ink-800);
          border: 1px solid var(--hairline);
          border-top: 3px solid var(--gold);
          border-radius: 6px;
          box-shadow: var(--shadow-1);
          padding: var(--boxel-sp) var(--boxel-sp-lg);
        }
        /* The dominant element: clamp()'d genuinely large against a 0.875rem
           body — >3x it, and well past the title — so there is exactly one
           focal point, and it is the plaque's own value, dark-on-gold. */
        .worth {
          margin: 0;
          font-family: var(--font-display);
          color: var(--paper);
          font-size: clamp(2rem, 1.3rem + 3cqi, 3rem);
          line-height: 1.02;
          font-weight: 900;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.02em;
          /* The signature moment: the figure settles into place once, not a
             scattering of fades across the page. */
          animation: worth-reveal 640ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @keyframes worth-reveal {
          from {
            opacity: 0;
            transform: translateY(0.3em);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .worth--unknown {
          font-size: 1.5rem;
          font-weight: 600;
          color: var(--smoke);
        }
        .delta {
          margin: 0;
          display: inline-flex;
          align-items: center;
          gap: 0.3em;
          font-size: 0.9375rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--paper);
        }
        .delta--up {
          color: var(--verified-on-gold);
        }
        .delta--down {
          color: var(--down-on-gold);
        }
        .delta--flat {
          opacity: 0.7;
        }
        .delta-pct {
          opacity: 0.85;
        }
        /* The spec leaves green doing double duty (authenticated AND price-up).
           This label is what disambiguates the axis, so it is not optional. */
        .delta-vs {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          opacity: 0.75;
        }
        .badges {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-4xs);
          flex-basis: 100%;
        }
        /* Trust state as DILUTED chips (boxel-theming's self-diluting pattern):
           an 18% fill of the state's own hue with the full 400-weight hue as
           text. A solid block here would out-shout the gold plaque figure —
           in the dark-luxury register the hero has exactly one loud element. */
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 0.35em;
          padding: 0.25em 0.6em;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 700;
          white-space: nowrap;
        }
        .badge--verified {
          background: color-mix(in oklch, var(--verified) 18%, transparent);
          color: var(--verified);
        }
        .badge--sale {
          background: color-mix(in oklch, var(--for-sale) 18%, transparent);
          color: var(--gold-ink, var(--gold));
        }
        .badge--plain {
          background: var(--ink-700);
          color: var(--smoke);
        }

        /* ---------- the one panel primitive ---------- */
        .sec {
          background: var(--ink-800);
          padding: var(--panel-pad);
          border-radius: var(--panel-radius);
          border: 1px solid var(--hairline);
          box-shadow: var(--shadow-1);
          min-width: 0;
        }
        .sec h2 {
          margin: 0 0 var(--boxel-sp-sm);
          display: flex;
          align-items: center;
          gap: 0.5em;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.09em;
          color: var(--smoke);
        }
        /* Rule 5: section icons are muted and identical in size across every
           header — one loud thing per card, and it is the hero figure. */
        .sec-icon {
          width: max(14px, 1em);
          height: max(14px, 1em);
          flex: none;
        }

        .cols {
          display: grid;
          /* Content-sized, not 1fr 1fr: the rail column is short rows and the
             acquisition column is a dl — a fixed split gives them equal width for
             unequal content. */
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: var(--boxel-sp-lg);
        }

        /* ---------- at a glance ---------- */
        .stats {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: var(--boxel-sp);
        }
        .stat {
          display: grid;
          gap: 0.2em;
          align-content: start;
        }
        .stat-k {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--smoke);
        }
        .stat-v {
          font-family: var(--font-display);
          font-size: 1.375rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .stat-sub {
          display: block;
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--smoke);
        }
        /* Re-skin ProgressBar through its OWN published knobs rather than a
           specificity war against .progress-bar-container — a plain
           `background:` here would lose to the component's own rule.
           Gold fill, not green: the rail measures VALUE retention, and value is
           the gold axis on this card — green stays reserved for trust. */
        .rail {
          --boxel-progress-bar-height: 5px;
          --boxel-progress-bar-border-radius: 999px;
          --boxel-progress-bar-background-color: var(--ink-700);
          --boxel-progress-bar-fill-color: var(--gold-ink, var(--gold));
          --boxel-progress-bar-border-color: transparent;
          display: block;
          margin-top: 0.35em;
        }

        /* ---------- provenance (signature) ---------- */
        .prov {
          list-style: none;
          margin: 0;
          padding: 0 0 0 var(--boxel-sp);
          border-left: 2px solid var(--hairline);
          display: grid;
          gap: var(--boxel-sp);
        }
        .prov-step {
          position: relative;
          display: grid;
          gap: 0.1em;
          font-size: 0.875rem;
        }
        .prov-step::before {
          content: '';
          position: absolute;
          left: calc(-1 * var(--boxel-sp) - 6px);
          top: 0.45em;
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--ink-700);
          border: 2px solid var(--ink-800);
        }
        .prov-step--done::before {
          /* A completed provenance milestone is a vault mark — gold. */
          background: var(--gold);
        }
        .prov-label {
          font-weight: 600;
        }
        .prov-when {
          font-size: 0.8125rem;
          color: var(--paper);
          font-variant-numeric: tabular-nums;
        }
        .prov-note {
          font-size: 0.75rem;
          color: var(--smoke);
        }
        .prov-step--todo .prov-label,
        .prov-step--todo .prov-when {
          color: var(--smoke);
        }

        /* ---------- specifics ---------- */
        .chips {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
        }
        .chips li {
          display: grid;
          gap: 0.15em;
          padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
          border-radius: 6px;
          background: var(--ink-700);
        }
        .chip-k {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--smoke);
        }
        .chip-v {
          font-size: 0.875rem;
          font-weight: 600;
        }
        /* Rule 3b: identifiers are read aloud and typed into other systems —
           they never ellipsis and never wrap mid-token. */
        .chip-v--id {
          font-family: var(--font-mono);
          font-weight: 500;
          white-space: nowrap;
        }

        /* ---------- prose + empty ---------- */
        .prose {
          font-size: 0.875rem;
          line-height: 1.6;
          max-width: 68ch;
          color: var(--paper);
        }
        .empty {
          margin: 0;
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp);
          font-size: 0.875rem;
          color: var(--smoke);
          background: var(--ink-800);
          border: 1px solid var(--hairline);
          border-radius: var(--panel-radius);
        }

        /* --- Rule 1 in use: these query the container declared above, and they
           style DESCENDANTS of .card. .card's own padding is deliberately not
           touched here — a container element cannot be sized by its own query.
           `.worth`'s own clamp() already tracks container width via cqi, so
           only layout reflow is handled here, not the type scale. --- */
        @container card (width < 720px) {
          .hero {
            grid-template-columns: minmax(0, 1fr);
          }
          .hero-photo {
            max-width: 240px;
          }
        }
        @container card (width < 460px) {
          .stats {
            grid-template-columns: minmax(0, 1fr);
          }
          .hero-title {
            font-size: 1.25rem;
          }
          .answer {
            padding: var(--boxel-sp-sm) var(--boxel-sp);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .worth {
            animation: none;
          }
        }
      </style>
    </template>
  };

  // STEP 0 FORK — FittedCard, not hand-rolled. This reverses the instinct the
  // design brief creates ("dark identity-bearing card → hand-roll"), and it is
  // reversed on evidence read out of the component, not on taste:
  //
  //   1. `FittedCard`'s root is `<article class='fitted-card' ...attributes>`, so
  //      a wrapper class of ours lands on the real root — the dark ground and
  //      every `--fc-*` override apply without forking anything.
  //   2. It declares NO `container-type`/`container-name` — it queries the host's
  //      `fitted-card` container, which is exactly the rule a hand-rolled
  //      template has to obey anyway.
  //   3. It already carries ~20 debugged `@container fitted-card` rules covering
  //      the whole aspect-ratio × width × height matrix. Hand-rolling means
  //      reimplementing the 16-size quanta that already exist and work.
  //
  // The content here IS the standard composition (image + eyebrow + title + badge
  // + footer), which is precisely the case the fork rule sends to FittedCard. The
  // identity we need is palette plus the photo carrying real width, and both are
  // `--fc-*` knobs.
  //
  // SLOT DISCIPLINE — six distinct facts, six slots, zero repeats.
  // `<:subtitle>` and `<:meta>` are deliberately NOT rendered. They are the two
  // slots that would have to be padded with a value already shown elsewhere
  // (variant, or the condition code), which is the documented failure mode: one
  // nine-card family had a value duplicated across slots in 6 of 9 templates,
  // and it survives source review because the repeat only appears at the quanta
  // where both slots happen to be visible. A slot with nothing distinct to say is
  // deleted, not filled.
  //
  // ONE BADGE, NOT TWO. `verified` and `forSale` are both badge-worthy, but two
  // badges at the 150×40 quantum is two loud things and therefore no anchor. The
  // split follows the spec's own collection mockup: `[FOR SALE]` is the tile
  // marker, while `DS ✓Auth` sits inline in the text row — so for-sale takes the
  // badge and verification rides as a glyph beside the condition in the footer.
  static fitted = class Fitted extends Component<typeof CollectionItem> {
    get worth() {
      return formatMoney(this.args.model?.lastKnownValue);
    }

    <template>
      <FittedCard
        class='ci-fit'
        @imageUrl={{@model.photos.primaryUrl}}
        @imageAlt={{@model.itemTitle}}
        @titleTag='h3'
      >
        {{! Rule 2 anchor, tier 1 is the image; this is the tier-2 fallback and it
            is the card's OWN static icon — the same one its isolated view and its
            breadcrumb use, which is what makes it identity rather than filler.
            Never an empty grey square. }}
        <:placeholder>
          <ArchiveIcon
            width='max(18px, 34%)'
            height='max(18px, 34%)'
            aria-hidden='true'
          />
        </:placeholder>

        <:eyebrow>{{@model.variantLabel}}</:eyebrow>

        <:title>{{if
            @model.itemTitle
            @model.itemTitle
            'Untitled item'
          }}</:title>

        <:badgeRight>
          {{#if @model.forSale}}
            <Pill class='ci-sale' @size='extra-small'>For sale</Pill>
          {{/if}}
        </:badgeRight>

        <:footer>
          {{#if @model.condition.code}}
            <span class='ci-grade'>
              {{@model.condition.code}}
              {{#if @model.verified}}
                <BadgeCheckIcon class='ci-check' aria-label='Authenticated' />
              {{/if}}
            </span>
          {{/if}}
          {{! Rule 1, data is all-or-nothing: routed through the one money
              formatter so minor units always render, and `nowrap` so the value is
              never ellipsised into an unreadable price. It is hidden wholesale at
              the narrow quanta below rather than truncated. }}
          {{#if this.worth}}
            <span class='ci-worth'>{{this.worth}}</span>
          {{/if}}
        </:footer>
      </FittedCard>

      <style scoped>

        /* NO container-type / container-name here — FittedCard queries the HOST's
           `fitted-card` container, and declaring one would capture those queries.
           Everything below is either a --fc-* knob or a visibility change. */
        .ci-fit {
          /* Family palette — same literal tokens and values the isolated view
             and the app shell (sole-vault-app.gts) use, so the family reads as
             one app. No theme-var fallback chain — this app dropped the
             swappable-theme pattern. */
          --card: oklch(1 0 0);
          --card-foreground: oklch(0.147 0.004 49.25);
          --background: oklch(0.985 0.001 106.42);
          --border: oklch(0.869 0.005 56.37);
          --ink-800: var(--card);
          --ink-700: color-mix(in oklch, var(--card, oklch(0.216 0.006 56.04)) 80%, var(--foreground, white) 20%);
          --ink-950: var(--primary-foreground, oklch(0.216 0.006 56.04));
          --foreground: oklch(0.147 0.004 49.25);
          --paper: var(--foreground);
          --muted: oklch(0.97 0.001 106.42);
          --secondary: oklch(0.923 0.003 48.72);
          --secondary-foreground: oklch(0.216 0.006 56.04);
          --input: oklch(1 0 0);
          --popover: oklch(1 0 0);
          --popover-foreground: oklch(0.147 0.004 49.25);
          --muted-foreground: oklch(0.553 0.013 58.07);
          --smoke: var(--muted-foreground);
          --primary: oklch(0.666 0.179 58.32);
          --primary-foreground: oklch(0.216 0.006 56.04);
          --destructive: oklch(0.577 0.245 27.32);
          --destructive-foreground: oklch(0.985 0.001 106.42);
          --ring: var(--primary);
          --gold: var(--primary);
          /* Text-grade gold for sub-18px strings: bare --gold on white sits under
             AA. oklab, not oklch (hue-rotates against achromatic endpoints). */
          --gold-ink: color-mix(in oklab, var(--gold) 72%, var(--foreground));
          --accent: oklch(0.769 0.188 70.08);
          --accent-foreground: oklch(0.216 0.006 56.04);
          --gold-bright: var(--accent);
          --verified: oklch(0.72 0.16 152);
          --for-sale: var(--gold);
          --on-for-sale: var(--ink-950);
          --font-display: var(--font-serif, 'Playfair Display', Georgia, serif);
          
          background: var(--ink-800);
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          /* The miniature vault plaque: a 2px gold edge as an inset shadow, not
             a border — the host draws the chrome and this must not fight it. */
          box-shadow: inset 2px 0 0 0 var(--gold);

          /* The photo carries real width — the design direction is Object, and a
             thumbnail-sized hero is the documented anti-pattern. */
          --fc-image-width: 42cqh;
          --fc-image-min-width: 3.5rem;
          --fc-image-max-width: 11rem;
          --fc-image-object-fit: cover;
          --fc-image-background: var(--ink-700);
          --fc-image-fade-color: var(--ink-800);

          --fc-content-padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          --fc-header-gap: 0.15em;
          --fc-content-gap: var(--boxel-sp-xxs);

          /* Rule 1: line-height >= 1.15 on every text role, so a descender is
             never sheared even when the clamp math "fits". */
          --fc-eyebrow-font-size: max(9px, 0.62em);
          --fc-eyebrow-line-height: 1.25;
          --fc-title-font-size: max(13px, 1.05em);
          --fc-title-line-height: 1.2;
          --fc-title-line-clamp: 2;
          --fc-footer-font-size: max(11px, 0.78em);
          --fc-footer-gap: var(--boxel-sp-xs);
          --fc-footer-justify: space-between;
          --fc-footer-flex-wrap: nowrap;
          --fc-badge-offset: var(--boxel-sp-xxs);
        }

        /* Rule 2: the eyebrow stays quiet so the title wins by CONTRAST, not only
           by size. Two loud things would mean no anchor. */
        .ci-fit :deep(.fc-eyebrow) {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--smoke);
          font-weight: 600;
        }
        .ci-fit :deep(.fc-title) {
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        /* Rule 1: line-height on the footer row is set here, NOT via a
           `--fc-footer-line-height` knob — that name does not exist. The real
           knobs are font-size / gap / justify / align-items / flex-wrap /
           display; an invented --fc-* name is valid CSS that silently does
           nothing, which is the worst kind of miss in this file. */
        .ci-fit :deep(.fc-footer) {
          line-height: 1.25;
        }
        /* Same reason: there is no `--fc-eyebrow-display`. The eyebrow is hidden
           per-quantum by a `:deep()` rule placed INSIDE the @container blocks
           below — a container query cannot toggle a class, so a state-class
           variant would never fire. */

        /* State colours are FILLS with dark text (colors.csv "On accent"), never
           coloured text on the dark ground. */
        .ci-sale {
          --pill-background-color: var(--for-sale);
          --pill-font-color: var(--on-for-sale);
          --pill-border-color: transparent;
          font-weight: 700;
        }

        .ci-grade {
          display: inline-flex;
          align-items: center;
          gap: 0.3em;
          font-weight: 700;
          white-space: nowrap;
        }
        .ci-check {
          width: max(11px, 0.95em);
          height: max(11px, 0.95em);
          color: var(--verified);
          flex: none;
        }
        .ci-worth {
          /* Plaque value: serif + gold — the collector-catalog mark. */
          font-family: var(--font-display);
          color: var(--gold-ink, var(--gold));
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          /* never ellipsis a value — it is hidden whole at narrow quanta instead */
          white-space: nowrap;
        }

        /* ---- quanta: visibility only, never a shrink-into-a-clip ----
           The type scale itself does not step; these rules hide whole rows. */

        /* Badge tier (h <= 50): the title is usually the only survivor, and it
           must still be the loudest thing. Everything else goes. */
        @container fitted-card (height <= 50px) {
          .ci-fit {
            --fc-footer-display: none;
            --fc-badge-right-display: none;
            --fc-title-line-clamp: 1;
            --fc-content-padding: var(--boxel-sp-4xs) var(--boxel-sp-xxs);
          }
          .ci-fit :deep(.fc-eyebrow) {
            display: none;
          }
        }

        /* Very narrow strips: the money value is dropped WHOLE rather than
           truncated, leaving the grade — a half-visible price is worse than an
           absent one. */
        @container fitted-card (width <= 200px) and (height <= 80px) {
          .ci-fit .ci-worth {
            display: none;
          }
        }

        /* Narrow tiles: the image would starve the text column below the ~200px
           content-column rule, so it yields width rather than the title clipping. */
        @container fitted-card (width <= 150px) {
          .ci-fit {
            --fc-image-max-width: 100%;
          }
          .ci-fit :deep(.fc-eyebrow) {
            display: none;
          }
        }
      </style>
    </template>
  };
}

export default CollectionItem;

 