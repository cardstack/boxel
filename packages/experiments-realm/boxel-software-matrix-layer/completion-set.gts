import {
  CardDef,
  field,
  contains,
  linksToMany,
  StringField,
  Component,
  realmURL,
} from '@cardstack/base/card-api';
import BooleanField from '@cardstack/base/boolean';
import MarkdownField from '@cardstack/base/markdown';
import NumberField from '@cardstack/base/number';
import enumField from '@cardstack/base/enum';
import ImageSourceField from '@cardstack/catalog/fields/image-source/image-source';
import { CollectibleProduct } from './collectible-product';
import TargetArrowIcon from '@cardstack/boxel-icons/target-arrow';
import BadgeCheckIcon from '@cardstack/boxel-icons/badge-check';
import FileTextIcon from '@cardstack/boxel-icons/file-text';
import NotebookPenIcon from '@cardstack/boxel-icons/notebook-pen';
import { tracked } from '@glimmer/tracking';
import {
  FittedCard,
  LoadingIndicator,
  Pill,
  ProgressBar,
  FieldContainer,
  Accordion,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { identifyCard } from '@cardstack/runtime-common';
// CollectionItem is read ONLY inside the isolated component's methods, never at
// module-evaluation time. That is what keeps this import cycle legal —
// collection-item.gts does not import this module today, but the reverse query
// below is the shape that creates one, so do not hoist this usage to the top
// level "for clarity".
import { CollectionItem } from './collection-item';

// CompletionSet — a curated collecting goal and the arithmetic for how far along
// it is. "All Travis Scott x Nike", "every Chicago colourway", "my top 10 grails".
//
// THE ONE DECISION THAT SHAPES THIS BLOCK: membership is DATA, progress is
// DERIVED. Those are opposite answers to the same-looking question, so both are
// spelled out:
//
//   `products` is a curated linksToMany, NOT a query. A collecting set is not
//   "everything matching a rule" — the spec is explicit that sneaker sets are
//   emergent and personal, and the user hand-confirms the list. Ordering is
//   meaningful. That is textbook curated membership, so it is a link.
//
//   `progress` / `ownedCount` / `missingProducts` are NOT stored and are NOT
//   fields. They are a rollup over the owner's CollectionItems intersected with
//   this list — unbounded, owner-dependent, and different for every viewer of a
//   public set. Storing them guarantees drift the moment a pair is bought or
//   sold. The arithmetic ships as the exported pure function below so the app,
//   the card and any future consumer share ONE implementation instead of three
//   subtly different ones.

export type CompletionRule = 'own-any' | 'own-all';

export const COMPLETION_RULES = [
  {
    value: 'own-any',
    label: 'Own any variant',
  },
  {
    value: 'own-all',
    label: 'Own every variant',
  },
];

const CompletionRuleField = enumField(StringField, {
  options: COMPLETION_RULES,
  displayName: 'Completion Rule',
});

export interface CompletionResult {
  ownedCount: number;
  targetCount: number;
  /** 0–100, rounded. 0 when the set is empty — never NaN. */
  percent: number;
  /** Product ids in the set that the owner does not have. Order preserved. */
  missingProductIds: string[];
}

/**
 * The single implementation of set completion.
 *
 * Pure on purpose: it takes the ids rather than the cards, so it needs no store,
 * no query and no realm — which is what lets the app, a command and a test all
 * call the same function. `ownedProductIds` is whatever the caller's own query
 * resolved (typically `CollectionItem.item.id` for one owner).
 *
 * Guards the two cases that silently produce a wrong number rather than an error:
 * a set with no products (percent must be 0, not NaN from a divide-by-zero), and
 * dead link slots (a deleted product leaves an `undefined` in the array while
 * `.length` still counts it, so a raw length would inflate the denominator).
 */
export function computeCompletion(
  setProductIds: (string | undefined | null)[],
  ownedProductIds: Iterable<string>,
): CompletionResult {
  let target = setProductIds.filter(Boolean) as string[];
  let owned = new Set(ownedProductIds);
  let missing = target.filter((id) => !owned.has(id));
  let ownedCount = target.length - missing.length;
  return {
    ownedCount,
    targetCount: target.length,
    percent:
      target.length === 0 ? 0 : Math.round((ownedCount / target.length) * 100),
    missingProductIds: missing,
  };
}

export class CompletionSet extends CardDef {
  static displayName = 'Completion Set';
  static icon = TargetArrowIcon;

  @field goal = contains(MarkdownField);
  @field coverImage = contains(ImageSourceField);

  // Curated membership. See the header note — this is deliberately a link.
  @field products = linksToMany(() => CollectibleProduct, { searchable: true });

  @field completionRule = contains(CompletionRuleField);
  @field isPublic = contains(BooleanField);

  // The DENOMINATOR is safe to store as a computed field: it depends only on this
  // card's own link array, not on any owner's collection. The numerator is not,
  // which is exactly why only one of the two lives here.
  @field targetCount = contains(NumberField, {
    computeVia: function (this: CompletionSet) {
      return (this.products ?? []).filter(Boolean).length;
    },
  });

  // ISOLATED — the goal's landing page.
  //
  // DOMAIN QUESTION: "how close am I, and what is still missing?" Neither half
  // is a field on this card, and that is deliberate — see the header note:
  // progress is a rollup over the owner's CollectionItems, so storing it here
  // would let it drift from the collection it describes.
  //
  // So the answer is a REVERSE QUERY, which is what an isolated view can do and
  // the embedded view cannot. The embedded template's comment says a bar drawn
  // without owner context "would be asserting a number this card cannot know" —
  // that remains true there. Here the card asks, gets the collection, and
  // intersects it through the block's OWN exported `computeCompletion`, so there
  // is still exactly one definition of "80% complete" in the realm.
  //
  // Direction: Instrument, same as the rest of the family. Signature element:
  // the vault plaque (gold hairline over the headline figure) plus the shared
  // ProgressBar meter the app already uses for this same number.
  // EDIT — only five editable fields total, so Rule 0's grouping stays light:
  // one compact identity row (name lives on cardInfo, rendered by the default
  // schema chrome) plus two sections, both open by default since there is
  // nothing here dense enough to want collapsing away.
  static edit = class Edit extends Component<typeof CompletionSet> {
    @tracked goalOpen = true;
    @tracked membersOpen = true;

    toggleGoal = () => (this.goalOpen = !this.goalOpen);
    toggleMembers = () => (this.membersOpen = !this.membersOpen);

    <template>
      <div class='cs-edit'>
        <Accordion class='ce-sections' @displayContainer={{false}} as |A|>
          <A.Item
            @id='goal'
            @isOpen={{this.goalOpen}}
            @onClick={{this.toggleGoal}}
          >
            <:title>Goal & cover image</:title>
            <:content>
              <div class='ce-body ce-grid-2'>
                <FieldContainer @label='Goal' @tag='label' @vertical={{true}}>
                  <@fields.goal />
                </FieldContainer>
                <FieldContainer
                  @label='Cover image'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.coverImage />
                </FieldContainer>
              </div>
            </:content>
          </A.Item>

          <A.Item
            @id='members'
            @isOpen={{this.membersOpen}}
            @onClick={{this.toggleMembers}}
          >
            <:title>Membership & visibility</:title>
            <:content>
              <div class='ce-body ce-grid-2'>
                <FieldContainer
                  @label='Products in this set'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.products />
                </FieldContainer>
                <FieldContainer
                  @label='Completion rule'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.completionRule />
                </FieldContainer>
                <FieldContainer
                  @label='Public'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.isPublic />
                  <p class='ce-help'>Public sets can show on a profile; private
                    ones stay just for tracking.</p>
                </FieldContainer>
              </div>
            </:content>
          </A.Item>
        </Accordion>
      </div>

      <style scoped>

        /* edit-card Rule 1: no ancestor declares a container for the edit
           format — named so a stray query elsewhere cannot claim it. Literal
           family palette, same tokens as the isolated root and the app shell —
           not theme-var fallbacks. */
        .cs-edit {
          container-type: inline-size;
          container-name: cs-edit;

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

          --font-display: var(--font-serif, 'Playfair Display', Georgia, serif);
          
          background: var(--ink-900);
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp-lg);

          scrollbar-color: var(--gold) var(--ink-800);
        }
        .cs-edit::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .cs-edit::-webkit-scrollbar-track {
          background: var(--ink-800);
        }
        .cs-edit::-webkit-scrollbar-thumb {
          background: var(--gold);
          border-radius: 999px;
          border: 2px solid var(--ink-800);
        }
        .cs-edit ::selection {
          background: var(--gold);
          color: var(--ink-950);
        }
        .cs-edit *:focus-visible {
          outline: 2px solid var(--gold);
          outline-offset: 2px;
        }
        /* Accordion re-skinned through its own knobs, panel-primitive shadow
           instead of a flat border. */
        .ce-sections :deep(.accordion-item) {
          background: var(--ink-800);
          border: 1px solid var(--hairline);
          border-radius: 10px;
          box-shadow: var(--shadow-1);
          margin-bottom: var(--boxel-sp-sm);
        }
        .ce-sections :deep(.accordion-item__title) {
          font-family: var(--font-display);
          font-weight: 700;
          color: var(--paper);
        }
        .ce-body {
          padding-top: var(--boxel-sp-xs);
        }
        .ce-grid-2 {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: var(--boxel-sp);
        }
        .ce-help {
          margin: var(--boxel-sp-4xs) 0 0;
          font-size: 0.75rem;
          color: var(--smoke);
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof CompletionSet> {
    get realms() {
      let realmUrl = this.args.model?.[realmURL];
      return realmUrl ? [realmUrl.href] : [];
    }

    // The reverse query: every CollectionItem in the realm, intersected against
    // this set's curated product links below.
    //
    // A plain `type` filter, so it needs no `on:` anchor — that requirement
    // belongs to eq/contains/range filters, where an unanchored field path
    // resolves against CardDef and 500s. Worth stating because the obvious
    // "optimisation" here is to push the intersection into the query as
    // `eq: { 'item.id': ... }`, and THAT form does need the anchor.
    //
    // `isLive` so acquiring or selling a pair moves the percentage without a
    // reload — the number is only trustworthy if it cannot go stale.
    private itemsQuery = this.args.context?.getCards(
      this,
      () => {
        let ref = identifyCard(CollectionItem);
        return ref ? { filter: { type: ref } } : undefined;
      },
      () => this.realms,
      { isLive: true },
    );

    // Read `.instances` at the point of use and filter dead slots: a deleted
    // target leaves its slot in place, so a raw iteration renders an empty row
    // and a raw `.length` counts members that no longer exist.
    get ownedProductIds(): Set<string> {
      let ids = new Set<string>();
      for (let item of (this.itemsQuery?.instances ?? []) as CollectionItem[]) {
        let id = item?.item?.id;
        if (id) {
          ids.add(id);
        }
      }
      return ids;
    }

    get products(): CollectibleProduct[] {
      return ((this.args.model?.products ?? []) as CollectibleProduct[]).filter(
        Boolean,
      );
    }

    get result() {
      return computeCompletion(
        this.products.map((p) => p?.id),
        this.ownedProductIds,
      );
    }

    get owned(): CollectibleProduct[] {
      let ids = this.ownedProductIds;
      return this.products.filter((p) => p?.id && ids.has(p.id));
    }

    get missing(): CollectibleProduct[] {
      let ids = this.ownedProductIds;
      return this.products.filter((p) => !p?.id || !ids.has(p.id));
    }

    // The query is absent when there is no `context` (some render modes have
    // none) and empty before it resolves. Those are different states and only
    // one of them should paint a "0% complete" claim.
    get isLoading() {
      return Boolean(this.itemsQuery) && !this.itemsQuery?.instances;
    }

    <template>
      <article class='card'>
        <header class='hero'>
          {{! `resolvedUrl`, NOT `url`. ImageSourceField accepts either a pasted
              URL or a file uploaded into the realm and exposes the winner as
              `resolvedUrl` — reading `.url` silently renders nothing for every
              uploaded cover, which is the majority case once someone uses the
              file picker. Decorative here (the title names the set), so alt=''. }}
          {{#if @model.coverImage.resolvedUrl}}
            <div class='hero-photo'>
              <img src={{@model.coverImage.resolvedUrl}} alt='' />
            </div>
          {{/if}}

          <div class='hero-body'>
            <p class='eyebrow'>
              <TargetArrowIcon
                width='max(12px, 0.9em)'
                height='max(12px, 0.9em)'
                aria-hidden='true'
              />
              Completion set
              {{#if @model.isPublic}}
                <span class='eyebrow-sep'>·</span>Public
              {{/if}}
            </p>

            <h1 class='hero-title'>{{if
                @model.cardTitle
                @model.cardTitle
                'Untitled set'
              }}</h1>

            {{! THE VAULT PLAQUE. Gold covers real surface area here, not a
                thin accent — a filled gold slab carrying the dominant
                figure, matching the ledger-hero treatment the app shell
                commits to for its own headline number. }}
            {{#if this.isLoading}}
              <p class='plaque plaque--wait'>
                <LoadingIndicator />
                Reading your collection…
              </p>
            {{else}}
              <div class='plaque'>
                <p class='plaque-pct'>{{this.result.percent}}<span
                    class='plaque-pct-sym'
                  >%</span></p>
                <p class='plaque-frac'>
                  {{this.result.ownedCount}}
                  of
                  {{this.result.targetCount}}
                  <span class='plaque-frac-k'>owned</span>
                </p>
                {{! aria-label attribute, not @label — @label renders as
                    visible text inside this 6px meter and shears. }}
                <ProgressBar
                  class='meter'
                  @value={{this.result.percent}}
                  @max={{100}}
                  aria-label='Set completion'
                />
              </div>
            {{/if}}
          </div>
        </header>

        {{! DETAIL — shape: prose. The goal in the owner's own words. }}
        {{#if @model.goal}}
          <section class='sec'>
            <h2><NotebookPenIcon class='sec-icon' aria-hidden='true' />The goal</h2>
            <div class='prose'><@fields.goal /></div>
          </section>
        {{/if}}

        <div class='cols'>
          {{! DETAIL — shape: ul of linked cards. Distinct from the prose above
              and from the dl below, so the sections do not read as one shape
              three times. }}
          <section class='sec'>
            <h2><BadgeCheckIcon class='sec-icon' aria-hidden='true' />Owned<span
                class='count'
              >{{this.owned.length}}</span></h2>
            {{#if this.owned.length}}
              <ul class='plist'>
                {{#each this.owned as |p|}}
                  <li><span class='pname'>{{p.displayTitle}}</span></li>
                {{/each}}
              </ul>
            {{else}}
              <p class='empty'>
                <BadgeCheckIcon
                  width='18'
                  height='18'
                  aria-hidden='true'
                />Nothing from this set is in your collection yet.
              </p>
            {{/if}}
          </section>

          {{! The half a collector actually opens this card for — what is left
              to hunt. Same shape as Owned on purpose: they are two halves of
              one list, and reading them side by side is the point. }}
          <section class='sec'>
            <h2><TargetArrowIcon class='sec-icon' aria-hidden='true' />Still
              needed<span class='count'>{{this.missing.length}}</span></h2>
            {{#if this.missing.length}}
              <ul class='plist'>
                {{#each this.missing as |p|}}
                  <li><span
                      class='pname pname--want'
                    >{{p.displayTitle}}</span></li>
                {{/each}}
              </ul>
            {{else}}
              <p class='empty empty--done'>
                <BadgeCheckIcon width='18' height='18' aria-hidden='true' />Set
                complete — every pair accounted for.
              </p>
            {{/if}}
          </section>
        </div>

        {{! DETAIL — shape: dl. The rule the arithmetic above obeys, which is
            otherwise invisible and is the first thing questioned when a
            percentage looks wrong. }}
        <section class='sec'>
          <h2><FileTextIcon class='sec-icon' aria-hidden='true' />How this is
            counted</h2>
          <dl class='rules'>
            <div class='rule-row'>
              <dt>Completion rule</dt>
              <dd>{{if
                  @model.completionRule
                  @model.completionRule
                  'Own any'
                }}</dd>
            </div>
            <div class='rule-row'>
              <dt>Products tracked</dt>
              <dd>{{this.result.targetCount}}</dd>
            </div>
            <div class='rule-row'>
              <dt>Visibility</dt>
              <dd>{{if @model.isPublic 'Public' 'Private'}}</dd>
            </div>
          </dl>
        </section>
      </article>

      <style scoped>

        /* Rule 1: isolated gets NO host container, so this template declares its
           own, NAMED — otherwise every @container rule below is inert CSS.
           `inline-size`, not `size`: this column scrolls. Literal committed
           palette — the same tokens the app shell and every Sole Vault block
           use — not theme-var fallbacks. */
        .card {
          container-type: inline-size;
          container-name: card;
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
          background-image: radial-gradient(
            ellipse 1100px 600px at 15% -10%,
            var(--ink-800) 0%,
            transparent 60%
          );
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          padding: var(--boxel-sp-lg);
          /* ONE rhythm mechanism: the parent's gap, no child margin-top. */
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
          box-sizing: border-box;

          scrollbar-color: var(--gold) var(--ink-800);
        }
        .card::-webkit-scrollbar {
          width: 10px;
          height: 10px;
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
        /* No cover image field set? The photo column is not rendered at all
           rather than reserving an empty grey square — a decorative box where
           content should be reads as unfinished. */
        .hero:not(:has(.hero-photo)) {
          grid-template-columns: minmax(0, 1fr);
        }
        .hero-photo {
          aspect-ratio: 1;
          border-radius: 12px;
          overflow: hidden;
          background: var(--ink-700);
          box-shadow: var(--shadow-2);
        }
        .hero-photo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .hero-body {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
        }
        .eyebrow {
          margin: 0;
          display: flex;
          align-items: center;
          gap: 0.4em;
          font-size: 0.6875rem; /* 11px floor */
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
          font-size: clamp(1.75rem, 1.3rem + 1.6cqi, 2.5rem);
          line-height: 1.1;
          font-weight: 700;
          letter-spacing: -0.01em;
        }

        /* THE VAULT PLAQUE — light-mode translation of the family signature:
           a gold hairline TOP-RULE over a serif ink figure, matching the app
           shell's ledger-hero. The old filled gradient slab was designed for
           the dark ground and reads as a solid orange block on white. */
        .plaque {
          margin-top: auto;
          display: grid;
          gap: 0.15rem;
          background: var(--ink-800);
          border: 1px solid var(--hairline);
          border-top: 3px solid var(--gold);
          border-radius: 6px;
          padding: 1rem 1.25rem 1.15rem;
          box-shadow: var(--shadow-1);
        }
        .plaque-pct {
          margin: 0;
          font-family: var(--font-display);
          /* The dominant element on this whole card — genuinely large,
             dramatic, container-scaled. */
          font-size: clamp(2.75rem, 1.6rem + 5.5cqi, 4.5rem);
          line-height: 1;
          font-weight: 900;
          letter-spacing: -0.02em;
          color: var(--paper);
          font-variant-numeric: tabular-nums;
          /* One-time fill-in reveal on first paint — the family's signature
             motion moment for its headline figure. */
          animation: plaque-reveal 640ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .plaque-pct-sym {
          font-size: 0.55em;
          font-weight: 700;
          opacity: 0.75;
        }
        @keyframes plaque-reveal {
          from {
            opacity: 0;
            transform: translateY(0.35em);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .plaque-frac {
          margin: 0;
          font-size: 0.9375rem;
          font-weight: 700;
          color: var(--paper);
          font-variant-numeric: tabular-nums;
        }
        .plaque-frac-k {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--gold-ink, var(--gold));
        }
        .plaque--wait {
          display: inline-flex;
          align-items: center;
          gap: 0.5em;
          margin-top: auto;
          font-size: 1rem;
          font-weight: 500;
          color: var(--smoke);
          background: none;
          box-shadow: none;
          padding: 0;
        }
        /* ProgressBar re-skinned through its own knobs, sitting inside the
           plaque itself — ink meter over the gold fill. */
        .meter {
          margin-top: 0.6rem;
          --boxel-progress-bar-height: 6px;
          --boxel-progress-bar-border-radius: 999px;
          --boxel-progress-bar-background-color: var(--muted, var(--ink-700));
          --boxel-progress-bar-fill-color: var(--gold-ink, var(--gold));
          --boxel-progress-bar-border-color: transparent;
        }
        @media (prefers-reduced-motion: reduce) {
          .plaque-pct {
            animation: none;
          }
        }

        /* ---------- the one panel primitive ---------- */
        .sec {
          background: var(--ink-800);
          padding: var(--boxel-sp) var(--boxel-sp-lg) var(--boxel-sp-lg);
          border-radius: 12px;
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
        .sec-icon {
          width: max(14px, 1em);
          height: max(14px, 1em);
          color: var(--gold-ink, var(--gold));
          flex: none;
        }
        .count {
          margin-left: auto;
          font-variant-numeric: tabular-nums;
          color: var(--paper);
        }

        .cols {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: var(--boxel-sp-lg);
        }

        .prose {
          font-size: 0.875rem;
          line-height: 1.55;
        }

        .plist {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: var(--boxel-sp-4xs);
        }
        .pname {
          font-size: 0.875rem;
          font-weight: 600;
        }
        /* A wanted pair is the hunt — gold, the value axis of this family. */
        .pname--want {
          color: var(--gold-ink, var(--gold));
        }

        .rules {
          display: grid;
          gap: var(--boxel-sp-xs);
          margin: 0;
        }
        .rule-row {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          justify-content: space-between;
          gap: var(--boxel-sp-xs);
          font-size: 0.875rem;
        }
        .rule-row dt {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--smoke);
        }
        .rule-row dd {
          margin: 0;
          font-weight: 600;
          text-transform: capitalize;
          font-family: var(--font-mono);
        }

        .empty {
          margin: 0;
          display: flex;
          align-items: center;
          gap: 0.5em;
          font-size: 0.8125rem;
          color: var(--smoke);
        }
        .empty--done {
          color: var(--gold-ink, var(--gold));
          font-weight: 600;
        }

        @container card (width < 640px) {
          .hero {
            grid-template-columns: minmax(0, 1fr);
          }
          .cols {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  // FITTED — FittedCard, same fork and same knobs as the rest of the family.
  //
  // NO PROGRESS BAR HERE, and this is the important decision rather than an
  // omission. Progress needs the owner's collection, which means a query, and a
  // prerendered fitted tile can neither run a query nor resolve a link — so any
  // percentage drawn here would be an invented number. The isolated view runs
  // that query; the tile shows only what this card actually owns.
  //
  // SLOT DISCIPLINE — three distinct facts, three slots. `<:subtitle>` and
  // `<:meta>` are not rendered: the remaining values are the rule (already the
  // eyebrow) and the count (already the footer).
  static fitted = class Fitted extends Component<typeof CompletionSet> {
    get countLabel() {
      let n = this.args.model?.targetCount ?? 0;
      return n === 1 ? '1 product' : `${n} products`;
    }

    <template>
      <FittedCard
        class='s-fit'
        @imageUrl={{@model.coverImage.resolvedUrl}}
        @imageAlt={{@model.cardTitle}}
        @titleTag='h3'
      >
        {{! Rule 2 anchor: tier 1 is the cover image; tier 2 is the card's own
            static icon, the same one its isolated view and atom use. }}
        <:placeholder>
          <TargetArrowIcon
            width='max(18px, 34%)'
            height='max(18px, 34%)'
            aria-hidden='true'
          />
        </:placeholder>

        <:eyebrow>{{if
            (eq @model.completionRule 'own-all')
            'Own every variant'
            'Own any variant'
          }}</:eyebrow>

        <:title>{{if @model.cardTitle @model.cardTitle 'Untitled set'}}</:title>

        <:badgeRight>
          {{#if @model.isPublic}}
            <Pill class='s-pub' @size='extra-small'>Public</Pill>
          {{/if}}
        </:badgeRight>

        <:footer>
          {{! The one real number this card owns without a query. Rendered in
              full or not at all — never ellipsised. }}
          <span class='s-count'>{{this.countLabel}}</span>
        </:footer>
      </FittedCard>

      <style scoped>

        /* No container-type / container-name — FittedCard queries the HOST's
           `fitted-card` container. Literal committed tokens, same family
           palette as every other Sole Vault surface — not theme-var
           fallbacks. */
        .s-fit {
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
          /* The miniature vault plaque — inset shadow, not a border. */
          box-shadow: inset 2px 0 0 0 var(--gold);

          --fc-image-width: 42cqh;
          --fc-image-min-width: 3.5rem;
          --fc-image-max-width: 11rem;
          --fc-image-object-fit: cover;
          --fc-image-background: var(--ink-700);
          --fc-image-fade-color: var(--ink-800);

          --fc-content-padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          --fc-header-gap: 0.15em;
          --fc-content-gap: var(--boxel-sp-xxs);

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

        .s-fit :deep(.fc-eyebrow) {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--smoke);
          font-weight: 600;
        }
        .s-fit :deep(.fc-title) {
          font-family: 'Playfair Display', Georgia, serif;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .s-fit :deep(.fc-footer) {
          line-height: 1.25;
        }

        /* Visibility is chrome, not a state hue: a diluted neutral chip rather
           than a colour that would compete with the gold plaque edge. */
        .s-pub {
          --pill-background-color: color-mix(
            in oklch,
            var(--paper) 12%,
            transparent
          );
          --pill-font-color: var(--smoke);
          --pill-border-color: transparent;
          font-weight: 700;
        }
        .s-count {
          font-family: 'Playfair Display', Georgia, serif;
          color: var(--gold-ink, var(--gold));
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }

        /* ---- quanta: visibility only ---- */
        @container fitted-card (height <= 50px) {
          .s-fit {
            --fc-footer-display: none;
            --fc-badge-right-display: none;
            --fc-title-line-clamp: 1;
            --fc-content-padding: var(--boxel-sp-4xs) var(--boxel-sp-xxs);
          }
          .s-fit :deep(.fc-eyebrow) {
            display: none;
          }
        }

        @container fitted-card (width <= 150px) {
          .s-fit {
            --fc-image-max-width: 100%;
          }
          .s-fit :deep(.fc-eyebrow) {
            display: none;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof CompletionSet> {
    <template>
      <span class='s-atom'>
        <TargetArrowIcon width='13' height='13' aria-hidden='true' />
        <span class='s-name'>{{@model.cardTitle}}</span>
        {{#if @model.targetCount}}
          <span class='s-count'>{{@model.targetCount}}</span>
        {{/if}}
      </span>
      <style scoped>
        .s-atom {
          --muted: oklch(0.97 0.001 106.42);
          --secondary: oklch(0.923 0.003 48.72);
          --secondary-foreground: oklch(0.216 0.006 56.04);
          --input: oklch(1 0 0);
          --popover: oklch(1 0 0);
          --popover-foreground: oklch(0.147 0.004 49.25);
          --muted-foreground: oklch(0.553 0.013 58.07);
          --smoke: var(--muted-foreground);

          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xxs);
          max-width: 100%;
        }
        .s-name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .s-count {
          font-size: var(--boxel-font-size-xs);
          color: var(--smoke);
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof CompletionSet> {
    <template>
      <div class='s-emb'>
        <div class='s-head'>
          <TargetArrowIcon width='16' height='16' aria-hidden='true' />
          <span class='s-title'>{{@model.cardTitle}}</span>
          {{#if @model.isPublic}}<span class='s-pub'>Public</span>{{/if}}
        </div>
        {{! No progress bar here. An embedded CompletionSet has no owner context —
            whose collection would it measure? A bar rendered without that would
            be asserting a number this card cannot know. The app draws progress,
            because the app knows who is looking. }}
        <p class='s-sub'>{{if @model.targetCount @model.targetCount 0}}
          products tracked</p>
      </div>
      <style scoped>
        /* Own inset — the host's CardContainer adds none. */
        .s-emb {
          --muted: oklch(0.97 0.001 106.42);
          --secondary: oklch(0.923 0.003 48.72);
          --secondary-foreground: oklch(0.216 0.006 56.04);
          --input: oklch(1 0 0);
          --popover: oklch(1 0 0);
          --popover-foreground: oklch(0.147 0.004 49.25);
          --muted-foreground: oklch(0.553 0.013 58.07);
          --smoke: var(--muted-foreground);

          display: grid;
          gap: var(--boxel-sp-4xs);
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .s-head {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xxs);
          min-width: 0;
        }
        .s-title {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .s-pub {
          flex: none;
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--smoke);
        }
        .s-sub {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          color: var(--smoke);
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };
}

export default CompletionSet;
