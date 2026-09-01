import {
  CardDef,
  field,
  contains,
  containsMany,
  linksTo,
  StringField,
  Component,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import MarkdownField from '@cardstack/base/markdown';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import Tag from '@cardstack/base/tag';
import MultiImageSourceField from '@cardstack/catalog/fields/multi-image-source/multi-image-source';
import { tracked } from '@glimmer/tracking';
import {
  FittedCard,
  FieldContainer,
  Accordion,
} from '@cardstack/boxel-ui/components';
import PackageIcon from '@cardstack/boxel-icons/package';
import ImageOffIcon from '@cardstack/boxel-icons/image-off';
import TagIcon from '@cardstack/boxel-icons/tag';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import RulerIcon from '@cardstack/boxel-icons/ruler';
import NotebookPenIcon from '@cardstack/boxel-icons/notebook-pen';
import { formatMoney } from './money-format';

// CollectibleProduct — a catalogue entry for a manufactured collectible: the
// thing itself, not anyone's copy of it.
//
// NAMED `CollectibleProduct`, NOT `Product`, because `experiments-realm/product.gts`
// already exports a `Product` (an e-commerce demo card with seller/lead-time
// fields). Two `Product`s at one realm root would be a coin-flip for any importer.
// The matrix concept this fills is `l05-5-cm-product`.
//
// The split against CollectionItem is the whole point and is worth stating: this
// card is the CATALOGUE (one row per SKU, shared by everyone), CollectionItem is
// the OWNED COPY (one row per person per pair, with condition and acquisition).
// Retail price lives here because it is a fact about the product; what someone
// paid lives on their CollectionItem because it is a fact about their purchase.

export class CollectibleProduct extends CardDef {
  static displayName = 'Collectible Product';
  static icon = PackageIcon;
  // Image-led catalogue entry with a wide spec grid — a layout surface for a
  // single record, same call as the rest of the family (isolated-card Rule 1b).

  // The definitive identifier — a UPC-like code. Kept as its own field rather
  // than folded into the title because it is looked up, read aloud and typed
  // into other systems.
  //
  // `l05-ft-record-identifier` exists as a matrix concept but is unimplemented,
  // so there is nothing to consume yet. When it lands, this is the field to
  // repoint — say so here rather than leaving the next reader to guess.
  @field sku = contains(StringField);

  @field colorway = contains(StringField);

  // Taxonomy, deliberately links rather than strings: 'Air Jordan 1 High' and
  // 'Nike' are shared vocabulary, and the reuse decision was that Silhouette and
  // Brand are NOT their own matrix elements — they ride on Tag.
  @field silhouette = linksTo(Tag, { searchable: true });
  @field brand = linksTo(Tag, { searchable: true });

  @field releaseDate = contains(DateField);
  @field retailPrice = contains(AmountWithCurrency);

  @field images = contains(MultiImageSourceField);
  @field productDescription = contains(MarkdownField);

  // The manufacturer's size run. containsMany of a plain string because the
  // scale is the consumer's — see CollectionItem.variantScale for the same call.
  @field availableVariants = containsMany(StringField);

  @field collabPartner = contains(StringField);
  @field tags = containsMany(StringField);

  // NO `lowestPrice` AND NO `listingCount`, though the spec's computed-fields
  // table asks for both. They are unbounded rollups over active listings — a
  // live realm query belongs in a metrics component the app composes, never
  // link-arrayed or cached onto the hot catalogue card. The app reads them via a
  // reverse query on Listing; see sole-vault-collection-view-contract.md.

  @field displayTitle = contains(StringField, {
    computeVia: function (this: CollectibleProduct) {
      let base = this.cardInfo?.name ?? '';
      return this.colorway ? `${base} "${this.colorway}"` : base;
    },
  });

  // ISOLATED — the catalogue record's landing page.
  //
  // DOMAIN QUESTION: "what exactly is this, and what did it retail for?" This
  // card is the shared catalogue row (see the header note against
  // CollectionItem), so the answer is the product's own facts — never a rollup
  // over anyone's listings, which is deliberately absent (see the header note).
  //
  // Direction: Object (image-led — the photo carries the hero). Signature
  // element: the family's gold plaque (same device the app shell uses for its
  // collection-value figure), here filled with retail price instead of a
  // collector's own valuation, so the catalogue reads as the same app.
  static isolated = class Isolated extends Component<typeof CollectibleProduct> {
    get retail() {
      return formatMoney(this.args.model?.retailPrice);
    }

    get hasSpecifics() {
      let m = this.args.model;
      return Boolean(
        m?.collabPartner || (m?.availableVariants ?? []).filter(Boolean).length,
      );
    }

    <template>
      <article class='product'>
        <header class='hero'>
          <div class='hero-photo'>
            {{#if @model.images.primaryUrl}}
              <img src={{@model.images.primaryUrl}} alt={{@model.displayTitle}} />
            {{else}}
              <div class='photo-empty'>
                <ImageOffIcon width='30' height='30' aria-hidden='true' />
                <span>No photo yet</span>
              </div>
            {{/if}}
          </div>

          <div class='hero-body'>
            <h1 class='title'>{{if
                @model.displayTitle
                @model.displayTitle
                'Untitled product'
              }}</h1>

            <div class='badges'>
              {{#if @model.brand}}
                <span class='badge'><@fields.brand @format='atom' /></span>
              {{/if}}
              {{#if @model.silhouette}}
                <span class='badge'><@fields.silhouette @format='atom' /></span>
              {{/if}}
              {{#if @model.sku}}
                <span class='badge badge--sku'>{{@model.sku}}</span>
              {{/if}}
            </div>

            {{! THE PLAQUE — real gold surface area, not a hairline accent.
                Same device the app shell's collection-value figure uses. }}
            <div class='plaque'>
              {{#if this.retail}}
                <span class='plaque-value'>{{this.retail}}</span>
                <span class='plaque-label'>Retail price</span>
              {{else}}
                <span class='plaque-value plaque-value--unknown'>No retail
                  price recorded</span>
              {{/if}}
            </div>
          </div>
        </header>

        {{! AT A GLANCE — shape: a wide fact rail. Release date and collab status
            are the two facts a browsing collector scans for before reading the
            description. }}
        <section class='sec glance'>
          <h2><CalendarIcon class='sec-icon' aria-hidden='true' />At a
            glance</h2>
          <ul class='stats'>
            <li class='stat'>
              <span class='stat-k'>Released</span>
              <span class='stat-v'><@fields.releaseDate @format='atom' /></span>
            </li>
            <li class='stat'>
              <span class='stat-k'>Colorway</span>
              <span class='stat-v'>{{if
                  @model.colorway
                  @model.colorway
                  '—'
                }}</span>
            </li>
            <li class='stat'>
              <span class='stat-k'>Collab</span>
              <span class='stat-v'>{{if
                  @model.collabPartner
                  @model.collabPartner
                  'General release'
                }}</span>
            </li>
          </ul>
        </section>

        <div class='cols'>
          {{! shape: prose }}
          <section class='sec prose-sec'>
            <h2><NotebookPenIcon
                class='sec-icon'
                aria-hidden='true'
              />Description</h2>
            {{#if @model.productDescription}}
              <div class='prose'><@fields.productDescription /></div>
            {{else}}
              <p class='empty'>
                <NotebookPenIcon width='20' height='20' aria-hidden='true' />
                No description written yet.
              </p>
            {{/if}}
          </section>

          {{! shape: chip rows — a different shape from the prose block beside
              it }}
          <section class='sec'>
            <h2><RulerIcon class='sec-icon' aria-hidden='true' />Sizing &
              tags</h2>
            {{#if this.hasSpecifics}}
              <ul class='chips'>
                {{#each @model.availableVariants as |v|}}
                  {{#if v}}
                    <li><span class='chip-v'>{{v}}</span></li>
                  {{/if}}
                {{/each}}
              </ul>
              {{#if @model.tags.length}}
                <ul class='chips tags'>
                  {{#each @model.tags as |t|}}
                    {{#if t}}
                      <li><TagIcon
                          width='12'
                          height='12'
                          aria-hidden='true'
                        /><span class='chip-v'>{{t}}</span></li>
                    {{/if}}
                  {{/each}}
                </ul>
              {{/if}}
            {{else}}
              <p class='empty'>
                <RulerIcon width='20' height='20' aria-hidden='true' />
                No size run or tags recorded yet.
              </p>
            {{/if}}
          </section>
        </div>

        {{! NO ACTIONS ZONE — a deliberate gap, not an oversight. "Add to
            collection" and "Find listings" are unbuilt matrix elements
            (AddToCollection, the reverse Listing query); a control that looks
            live and does nothing teaches the user to distrust every other
            control on the card. The zone lands with the commands. }}
      </article>

      <style scoped>

        /* Rule 1: an isolated card gets NO host container — declaring our own
           is what makes every @container rule below live rather than inert.
           Literal colour values, not theme tokens — nothing here is meant to
           be swappable (this app dropped the theme-var pattern entirely). */
        .product {
          container-type: inline-size;
          container-name: product;
          width: 100%;
          height: 100%;
          overflow-y: auto;

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
          --shadow-1: 0 1px 2px oklch(0.05 0 0 / 0.08);
          --shadow-2: 0 8px 24px -8px oklch(0.05 0 0 / 0.14);
          --shadow-3: 0 20px 48px -16px oklch(0.05 0 0 / 0.18);

          --font-display: var(--font-serif, 'Playfair Display', Georgia, serif);
                    --font-mono: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;

          background: var(--ink-900);
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          padding: 2rem;
          display: flex;
          flex-direction: column;
          gap: 1.75rem;

          scrollbar-color: var(--gold) var(--ink-800);
        }
        .product::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .product::-webkit-scrollbar-track {
          background: var(--ink-800);
        }
        .product::-webkit-scrollbar-thumb {
          background: var(--gold);
          border-radius: 999px;
          border: 2px solid var(--ink-800);
        }
        .product ::selection {
          background: var(--gold);
          color: var(--ink-950);
        }
        .product *:focus-visible {
          outline: 2px solid var(--gold);
          outline-offset: 2px;
        }

        /* ---------- hero ---------- */
        .hero {
          display: grid;
          grid-template-columns: minmax(14rem, 34%) minmax(0, 1fr);
          gap: 1.75rem;
          align-items: stretch;
        }
        .hero-photo {
          aspect-ratio: 1;
          border-radius: 16px;
          overflow: hidden;
          background: var(--ink-700);
          display: grid;
          place-items: center;
          box-shadow: var(--shadow-2);
        }
        .hero-photo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .photo-empty {
          display: grid;
          justify-items: center;
          gap: 0.4rem;
          color: var(--smoke);
          font-size: 0.8125rem;
          text-align: center;
          padding: 1rem;
        }
        .hero-body {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.9rem;
        }
        .title {
          margin: 0;
          font-family: var(--font-display);
          font-size: clamp(1.75rem, 1.1rem + 2.4cqi, 2.75rem);
          line-height: 1.05;
          font-weight: 900;
          letter-spacing: -0.02em;
        }
        .badges {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 0.35em;
          padding: 0.3em 0.7em;
          border-radius: 999px;
          background: var(--ink-800);
          border: 1px solid var(--hairline);
          color: var(--smoke);
          font-size: 0.75rem;
          font-weight: 700;
          white-space: nowrap;
        }
        .badge--sku {
          font-family: var(--font-mono);
          font-weight: 500;
          letter-spacing: 0.02em;
        }

        /* THE PLAQUE — light translation of the family signature: gold
           top-rule over the serif ink value, matching the shell's
           ledger-hero. The dark-era filled slab reads orange on white. */
        .plaque {
          margin-top: auto;
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 0.3rem 0.7rem;
          background: var(--ink-800);
          border: 1px solid var(--hairline);
          border-top: 3px solid var(--gold);
          border-radius: 6px;
          padding: 1.1rem 1.4rem;
          box-shadow: var(--shadow-1);
        }
        .plaque-value {
          font-family: var(--font-display);
          font-size: clamp(1.875rem, 1rem + 3.4cqi, 3rem);
          line-height: 1;
          font-weight: 900;
          letter-spacing: -0.02em;
          color: var(--paper);
          font-variant-numeric: tabular-nums;
        }
        .plaque-value--unknown {
          font-size: 1.25rem;
          font-weight: 600;
        }
        .plaque-label {
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--gold-ink, var(--gold));
        }

        /* ---------- the one panel primitive ---------- */
        .sec {
          background: var(--ink-800);
          padding: 1.4rem 1.6rem;
          border-radius: 14px;
          border: 1px solid var(--hairline);
          box-shadow: var(--shadow-1);
          min-width: 0;
        }
        .sec h2 {
          margin: 0 0 1rem;
          display: flex;
          align-items: center;
          gap: 0.5em;
          font-size: 0.8125rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--smoke);
        }
        .sec-icon {
          width: max(14px, 1em);
          height: max(14px, 1em);
          flex: none;
          color: var(--gold-ink, var(--gold));
        }

        .cols {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1.5rem;
        }

        /* ---------- at a glance: a wide fact rail, distinct from the plaque
           and the panel grid below it ---------- */
        .stats {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 1.25rem;
        }
        .stat {
          display: grid;
          gap: 0.25rem;
          align-content: start;
          border-left: 1px solid var(--hairline);
          padding-left: 1rem;
        }
        .stat:first-child {
          border-left: 0;
          padding-left: 0;
        }
        .stat-k {
          font-size: 0.75rem;
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

        /* ---------- sizing & tags ---------- */
        .chips {
          list-style: none;
          margin: 0 0 0.6rem;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .chips:last-child {
          margin-bottom: 0;
        }
        .chips li {
          display: flex;
          align-items: center;
          gap: 0.3em;
          padding: 0.35rem 0.7rem;
          border-radius: 8px;
          background: var(--ink-700);
        }
        .tags li {
          color: var(--smoke);
        }
        .chip-v {
          font-size: 0.875rem;
          font-weight: 600;
        }
        .tags .chip-v {
          font-size: 0.75rem;
          font-weight: 500;
        }

        /* ---------- prose + empty ---------- */
        .prose {
          font-size: 0.9375rem;
          line-height: 1.65;
          max-width: 68ch;
          color: var(--paper);
        }
        .empty {
          margin: 0;
          display: flex;
          align-items: center;
          gap: 0.6rem;
          font-size: 0.9375rem;
          color: var(--smoke);
        }

        @container product (width < 720px) {
          .hero {
            grid-template-columns: minmax(0, 1fr);
          }
          .hero-photo {
            max-width: 260px;
          }
          .plaque-value {
            font-size: 2.25rem;
          }
        }
        @container product (width < 460px) {
          .stats {
            grid-template-columns: minmax(0, 1fr);
          }
          .stat {
            border-left: 0;
            padding-left: 0;
            border-top: 1px solid var(--hairline);
            padding-top: 0.75rem;
          }
          .stat:first-child {
            border-top: 0;
            padding-top: 0;
          }
          .plaque-value {
            font-size: 1.875rem;
          }
          .title {
            font-size: 1.5rem;
          }
        }
      </style>
    </template>
  };

  // EDIT — compact identity row (Rule 0: the fields glanced at every time),
  // everything else grouped into independently collapsible sections. Pricing
  // opens by default (the field most often changed); media/description/tags
  // start collapsed.
  static edit = class Edit extends Component<typeof CollectibleProduct> {
    @tracked pricingOpen = true;
    @tracked mediaOpen = false;
    @tracked descriptionOpen = false;
    @tracked specificsOpen = false;

    togglePricing = () => (this.pricingOpen = !this.pricingOpen);
    toggleMedia = () => (this.mediaOpen = !this.mediaOpen);
    toggleDescription = () => (this.descriptionOpen = !this.descriptionOpen);
    toggleSpecifics = () => (this.specificsOpen = !this.specificsOpen);

    <template>
      <div class='cp-edit'>
        <header class='ce-head'>
          <FieldContainer @label='SKU' @tag='label' @vertical={{true}}>
            <@fields.sku />
          </FieldContainer>
          <FieldContainer @label='Colorway' @tag='label' @vertical={{true}}>
            <@fields.colorway />
          </FieldContainer>
          <FieldContainer @label='Brand' @tag='label' @vertical={{true}}>
            <@fields.brand />
          </FieldContainer>
          <FieldContainer @label='Silhouette' @tag='label' @vertical={{true}}>
            <@fields.silhouette />
          </FieldContainer>
        </header>

        <Accordion class='ce-sections' @displayContainer={{false}} as |A|>
          <A.Item
            @id='pricing'
            @isOpen={{this.pricingOpen}}
            @onClick={{this.togglePricing}}
          >
            <:title>Pricing & release</:title>
            <:content>
              <div class='ce-body ce-grid-2'>
                <FieldContainer
                  @label='Retail price'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.retailPrice />
                </FieldContainer>
                <FieldContainer
                  @label='Release date'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.releaseDate />
                </FieldContainer>
              </div>
            </:content>
          </A.Item>

          <A.Item
            @id='media'
            @isOpen={{this.mediaOpen}}
            @onClick={{this.toggleMedia}}
          >
            <:title>Photos</:title>
            <:content>
              <div class='ce-body'>
                <@fields.images />
              </div>
            </:content>
          </A.Item>

          <A.Item
            @id='description'
            @isOpen={{this.descriptionOpen}}
            @onClick={{this.toggleDescription}}
          >
            <:title>Description</:title>
            <:content>
              <div class='ce-body'>
                <@fields.productDescription />
              </div>
            </:content>
          </A.Item>

          <A.Item
            @id='specifics'
            @isOpen={{this.specificsOpen}}
            @onClick={{this.toggleSpecifics}}
          >
            <:title>Sizing, collab & tags</:title>
            <:content>
              <div class='ce-body ce-grid-2'>
                <FieldContainer
                  @label='Available sizes'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.availableVariants />
                </FieldContainer>
                <FieldContainer
                  @label='Collab partner'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.collabPartner />
                </FieldContainer>
                <FieldContainer @label='Tags' @tag='label' @vertical={{true}}>
                  <@fields.tags />
                </FieldContainer>
              </div>
            </:content>
          </A.Item>
        </Accordion>
      </div>

      <style scoped>
        /* edit-card Rule 1: no ancestor declares a container for the edit
           format — named so a stray query elsewhere cannot claim it. Literal
           tokens, matching the isolated palette. */
        .cp-edit {
          container-type: inline-size;
          container-name: cp-edit;

          --background: oklch(0.985 0.001 106.42);

          --ink-900: var(--background);
          --card: oklch(1 0 0);
          --card-foreground: oklch(0.147 0.004 49.25);
          --accent: oklch(0.769 0.188 70.08);
          --accent-foreground: oklch(0.216 0.006 56.04);
          --ink-800: var(--card);
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

          background: var(--ink-900);
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          height: 100%;
          overflow-y: auto;
          padding: 1.75rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .cp-edit *:focus-visible {
          outline: 2px solid var(--gold);
          outline-offset: 2px;
        }
        .ce-head {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 1.25rem;
          padding-bottom: 1.25rem;
          border-bottom: 1px solid var(--hairline);
        }
        .ce-body {
          padding-top: 0.6rem;
        }
        .ce-grid-2 {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1.25rem;
        }
        @container cp-edit (width < 640px) {
          .ce-head {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof CollectibleProduct> {
    <template>
      <span class='p-atom'>
        <span class='p-name'>{{@model.displayTitle}}</span>
        {{#if @model.sku}}<span class='p-sku'>{{@model.sku}}</span>{{/if}}
      </span>
      <style scoped>
        .p-atom {
          display: inline-flex;
          align-items: baseline;
          gap: 0.4rem;
          max-width: 100%;
        }
        .p-name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .p-sku {
          font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;
          font-size: 0.75rem;
          color: var(--muted-foreground, oklch(0.709 0.01 56.26));
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<
    typeof CollectibleProduct
  > {
    get retail() {
      return formatMoney(this.args.model?.retailPrice);
    }

    <template>
      <div class='p-emb'>
        <div class='p-thumb'>
          {{#if @model.images.primaryUrl}}
            <img
              src={{@model.images.primaryUrl}}
              alt={{@model.displayTitle}}
              loading='lazy'
            />
          {{else}}
            <PackageIcon width='18' height='18' aria-hidden='true' />
          {{/if}}
        </div>
        <div class='p-body'>
          <div class='p-title'>{{@model.displayTitle}}</div>
          <div class='p-meta'>
            {{#if @model.sku}}<span class='p-sku'>{{@model.sku}}</span>{{/if}}
            {{#if this.retail}}<span class='p-rrp'>RRP
                {{this.retail}}</span>{{/if}}
          </div>
        </div>
      </div>
      <style scoped>
        /* A CardDef embedded is mounted inside the host's CardContainer, which
           draws a boundary and deliberately adds NO padding — so the inset has
           to come from here or the text sits flush against the pill. */
        .p-emb {
          display: grid;
          grid-template-columns: 2.75rem minmax(0, 1fr);
          gap: 0.75rem;
          align-items: center;
          padding: 0.6rem 0.85rem;
          background: var(--card, oklch(0.216 0.006 56.04));
          color: var(--foreground, oklch(0.985 0.001 106.42));
        }
        .p-thumb {
          width: 2.75rem;
          height: 2.75rem;
          display: grid;
          place-items: center;
          border-radius: 8px;
          overflow: hidden;
          background: color-mix(
            in oklch,
            var(--card, oklch(0.216 0.006 56.04)) 80%,
            var(--foreground, oklch(0.985 0.001 106.42)) 20%
          );
          color: var(--muted-foreground, oklch(0.709 0.01 56.26));
        }
        .p-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .p-body {
          min-width: 0;
        }
        .p-title {
          font-weight: 700;
          font-size: 0.9375rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .p-meta {
          display: flex;
          gap: 0.6rem;
          font-size: 0.75rem;
          color: var(--muted-foreground, oklch(0.709 0.01 56.26));
        }
        .p-sku {
          font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;
          white-space: nowrap;
        }
        .p-rrp {
          color: var(--accent, oklch(0.828 0.189 84.43));
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof CollectibleProduct> {
    get retail() {
      return formatMoney(this.args.model?.retailPrice);
    }

    <template>
      <FittedCard
        class='p-fit'
        @imageUrl={{@model.images.primaryUrl}}
        @imageAlt={{@model.displayTitle}}
        @titleTag='h3'
      >
        <:placeholder>
          <PackageIcon
            width='max(18px, 34%)'
            height='max(18px, 34%)'
            aria-hidden='true'
          />
        </:placeholder>
        <:eyebrow>{{@model.sku}}</:eyebrow>
        <:title>{{@model.displayTitle}}</:title>
        <:footer>
          {{#if this.retail}}<span class='p-rrp'>{{this.retail}}</span>{{/if}}
          {{#if @model.collabPartner}}<span
              class='p-collab'
            >{{@model.collabPartner}}</span>{{/if}}
        </:footer>
      </FittedCard>

      <style scoped>
        /* No container-type — FittedCard queries the host's fitted-card
           container. Literal dark-luxury tokens, matching the rest of the
           family. */
        .p-fit {
          --card: oklch(1 0 0);
          --card-foreground: oklch(0.147 0.004 49.25);
          --background: oklch(0.985 0.001 106.42);
          --border: oklch(0.869 0.005 56.37);
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
          background: var(--ink-800);
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          /* Miniature plaque: gold edge as an inset shadow, never a border —
             the host draws the chrome. */
          box-shadow: inset 2px 0 0 0 var(--gold);

          --fc-image-width: 42cqh;
          --fc-image-min-width: 3.5rem;
          --fc-image-max-width: 11rem;
          --fc-image-background: var(--ink-700);
          --fc-image-fade-color: var(--ink-800);
          --fc-content-padding: 0.4rem 0.7rem;
          --fc-header-gap: 0.15em;
          --fc-eyebrow-font-size: max(9px, 0.62em);
          --fc-eyebrow-line-height: 1.25;
          --fc-title-font-size: max(13px, 1.05em);
          --fc-title-line-height: 1.2;
          --fc-title-line-clamp: 2;
          --fc-footer-font-size: max(11px, 0.78em);
          --fc-footer-gap: 0.5rem;
          --fc-footer-justify: space-between;
          --fc-footer-flex-wrap: nowrap;
        }
        /* The SKU is an identifier: monospace, never wrapped, never
           ellipsised. */
        .p-fit :deep(.fc-eyebrow) {
          font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;
          letter-spacing: 0.02em;
          color: var(--smoke);
          white-space: nowrap;
        }
        .p-fit :deep(.fc-title) {
          font-family: 'Playfair Display', Georgia, serif;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .p-rrp {
          /* Plaque value: serif + gold. */
          font-family: 'Playfair Display', Georgia, serif;
          color: var(--gold-ink, var(--gold));
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .p-collab {
          color: var(--smoke);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        @container fitted-card (height <= 50px) {
          .p-fit {
            --fc-footer-display: none;
            --fc-title-line-clamp: 1;
            --fc-content-padding: 0.15rem 0.3rem;
          }
          .p-fit :deep(.fc-eyebrow) {
            display: none;
          }
        }
        /* The collab name is dropped whole rather than truncated to a stub. */
        @container fitted-card (width <= 200px) and (height <= 80px) {
          .p-fit .p-collab {
            display: none;
          }
        }
      </style>
    </template>
  };
}

export default CollectibleProduct;
