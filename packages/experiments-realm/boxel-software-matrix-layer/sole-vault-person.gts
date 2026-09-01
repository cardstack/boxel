import {
  Component,
  field,
  contains,
  realmURL,
  getComponent,
  type BaseDefComponent,
} from '@cardstack/base/card-api';
import { tracked } from '@glimmer/tracking';
import UserIcon from '@cardstack/boxel-icons/user';
import MailIcon from '@cardstack/boxel-icons/mail';
import PhoneIcon from '@cardstack/boxel-icons/phone';
import TagIcon from '@cardstack/boxel-icons/tag';
import AlertTriangleIcon from '@cardstack/boxel-icons/alert-triangle';
import {
  FieldContainer,
  FittedCard,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { identifyCard } from '@cardstack/runtime-common';
import { PersonBase } from './person-base';
// NOT a static import of `./listing` on purpose. listing.gts now imports
// SellerProfile (seller-profile.gts), which imports THIS module — a 3-way
// cycle (SoleVaultPerson -> listing -> SellerProfile -> SoleVaultPerson).
// SellerProfile's `extends SoleVaultPerson` runs at module-evaluation time
// (unlike this file's own deferred `identifyCard` read), so a static import
// of Listing here can hand seller-profile.gts an undefined SoleVaultPerson
// mid-cycle ("Class extends value undefined"), depending on which module of
// the loop loads first. A dynamic import breaks the cycle: it is not part of
// the synchronous module graph, so nothing waits on it to finish loading.
import type { Listing as ListingType } from './listing';

// SoleVaultPerson — the Sole Vault app's own generic person profile, used
// wherever a plain identity is needed (a buyer, or anyone not specifically a
// seller). `SellerProfile` (`seller-profile.gts`) is a SIBLING extension of
// this same base for the seller role specifically — it is not a subclass of
// this file, because the seller-only `rating` field has no business showing
// up on a buyer.
//
// This is a SUBCLASS of the pulled `PersonBase` block, not a modification of
// it. `person-base.gts` is a matrix-layer building block cloned from
// realm-staging and is kept byte-identical to the pull — every field here is
// inherited, and everything Sole-Vault-specific (the isolated landing page,
// the edit/fitted views, the dark-luxury visual language) lives in this file
// instead. Extend, never overwrite.
export class SoleVaultPerson extends PersonBase {
  static displayName = 'Sole Vault Person';
  static icon = UserIcon;

  // ISOLATED — the person's landing page. Object direction: the portrait (or
  // the gold-filled initials plaque standing in for it) is the anchor.
  //
  // Domain question: "who is this, how do I reach them, what are they
  // selling, and how well do buyers trust them?" The first two are the hero;
  // the third is a REVERSE QUERY — listings point at their seller, not the
  // other way round. Same shape and the same cycle caveat as Order's
  // shipments query.
  static isolated: BaseDefComponent = class Isolated extends Component<
    typeof SoleVaultPerson
  > {
    get realms() {
      let realmUrl = this.args.model?.[realmURL];
      return realmUrl ? [realmUrl.href] : [];
    }

    // Resolved lazily via dynamic import (see the header comment on the
    // `ListingType` type-only import above) — reading `this.listingClass`
    // inside the query thunk below is what makes it reactive once this
    // resolves from undefined to the real class.
    @tracked private listingClass;

    constructor(owner: unknown, args: any) {
      super(owner, args);
      import('./listing').then((mod) => {
        this.listingClass = mod.Listing;
      });
    }

    private listingsQuery = this.args.context?.getCards(
      this,
      () => {
        let ref = this.listingClass && identifyCard(this.listingClass);
        let id = this.args.model?.id;
        return ref && id
          ? { filter: { on: ref, every: [{ eq: { 'seller.id': id } }] } }
          : undefined;
      },
      () => this.realms,
      { isLive: true },
    );

    get listings() {
      return (this.listingsQuery?.instances ?? []).filter(Boolean);
    }

    get listingsLoading() {
      return Boolean(this.listingsQuery) && !this.listingsQuery?.instances;
    }

    get listingsError() {
      return (this.listingsQuery as any)?.error;
    }

    <template>
      <article class='card'>
        <header class='hero'>
          {{#if @model.photo.resolvedUrl}}
            <img
              class='portrait'
              src={{@model.photo.resolvedUrl}}
              alt={{@model.title}}
            />
          {{else}}
            <div class='portrait portrait--plaque' aria-hidden='true'>
              {{#if @model.name}}
                <span class='init'>{{@model.initials}}</span>
              {{else}}
                <UserIcon width='40%' height='40%' />
              {{/if}}
            </div>
          {{/if}}

          <div class='hero-body'>
            <h1 class='name'>{{@model.title}}</h1>

            {{! Contact facts as quiet pills, each with its own glyph —
                identifiers, so the value itself never truncates. }}
            <ul class='contact'>
              {{#if @model.email}}
                <li class='c-pill'>
                  <MailIcon class='c-icon' aria-hidden='true' />
                  <a class='c-link' href='mailto:{{@model.email}}'>
                    {{@model.email}}</a>
                </li>
              {{/if}}
              {{#if @model.phone}}
                <li class='c-pill'>
                  <PhoneIcon class='c-icon' aria-hidden='true' />
                  <span class='c-val'>{{@model.phone}}</span>
                </li>
              {{/if}}
              {{#unless @model.email}}
                {{#unless @model.phone}}
                  <li class='c-none'>No contact details recorded.</li>
                {{/unless}}
              {{/unless}}
            </ul>
          </div>
        </header>

        {{! What they are selling — reverse query over Listing.seller. }}
        <section class='sec'>
          <h2><TagIcon class='sec-icon' aria-hidden='true' />Listings<span
              class='count'
            >{{this.listings.length}}</span></h2>

          {{#if this.listingsError}}
            <p class='err'>
              <AlertTriangleIcon
                width='18'
                height='18'
                aria-hidden='true'
              />Could not load listings.
            </p>
          {{else if this.listingsLoading}}
            <p class='wait'><LoadingIndicator />Looking for listings…</p>
          {{else if this.listings.length}}
            <ul class='links'>
              {{! getCards instances have no `.component` — getComponent(card)
                  is the API; the property renders an empty row silently. }}
              {{#each this.listings as |l|}}
                <li>{{#let (getComponent l) as |ListingCard|}}
                    <ListingCard @format='embedded' />
                  {{/let}}</li>
              {{/each}}
            </ul>
          {{else}}
            <p class='empty'>
              <TagIcon width='18' height='18' aria-hidden='true' />Nothing
              listed for sale by this person yet.
            </p>
          {{/if}}
        </section>
      </article>

      <style scoped>

        /* Rule 1: an isolated card gets NO host container — declaring our own
           is what makes every @container rule below live rather than inert.
           Literal colour values, not theme tokens — nothing here is meant to
           be swappable (this app family drops the theme-var pattern
           entirely). */
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
          
          background: var(--ink-900);
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          padding: 2rem;
          display: flex;
          flex-direction: column;
          gap: 1.75rem;
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

        /* ---------- hero: the portrait is the anchor ---------- */
        .hero {
          display: flex;
          gap: 1.75rem;
          align-items: center;
        }
        .portrait {
          width: min(9.5rem, 26cqi);
          aspect-ratio: 1;
          object-fit: cover;
          border-radius: 50%;
          flex: none;
          /* Real gold surface area — the family plaque ring around a photo. */
          box-shadow:
            0 0 0 3px var(--ink-900),
            0 0 0 5px var(--gold),
            var(--shadow-2);
        }
        .portrait--plaque {
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(
            155deg,
            var(--gold) 0%,
            var(--gold-bright) 100%
          );
          color: var(--ink-950);
        }
        /* Initials as the anchor when there is no photo: a FILLED gold plaque,
           not a hairline outline standing in for the missing portrait. */
        .init {
          font-family: var(--font-display);
          font-size: clamp(1.5rem, 0.6rem + 7cqi, 3rem);
          line-height: 1;
          font-weight: 900;
          letter-spacing: 0.01em;
        }
        .hero-body {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.9rem;
        }
        .name {
          margin: 0;
          font-family: var(--font-display);
          font-size: clamp(2rem, 1.35rem + 2.6cqi, 3rem);
          line-height: 1.05;
          font-weight: 900;
          letter-spacing: -0.02em;
        }
        .contact {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        /* Each identifier as its own quiet pill, with real hover motion — the
           one interactive surface this card offers besides the listing rows
           below. */
        .c-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.45em;
          padding: 0.4rem 0.8rem;
          border-radius: 999px;
          background: var(--ink-800);
          border: 1px solid var(--hairline);
          font-size: 0.875rem;
          box-shadow: var(--shadow-1);
          transition:
            transform 180ms cubic-bezier(0.16, 1, 0.3, 1),
            box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1),
            border-color 180ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .c-pill:has(.c-link):hover,
        .c-pill:has(.c-link):focus-within {
          transform: translateY(-3px);
          box-shadow: var(--shadow-3);
          border-color: color-mix(in oklch, var(--gold) 55%, var(--hairline));
        }
        @media (prefers-reduced-motion: reduce) {
          .c-pill {
            transition: none;
          }
          .c-pill:has(.c-link):hover,
          .c-pill:has(.c-link):focus-within {
            transform: none;
          }
        }
        .c-icon {
          width: max(14px, 1em);
          height: max(14px, 1em);
          flex: none;
          color: var(--gold-ink, var(--gold));
        }
        /* Identifiers: read aloud and typed elsewhere, never ellipsised. */
        .c-link,
        .c-val {
          white-space: nowrap;
          font-weight: 600;
          color: var(--paper);
        }
        .c-link {
          text-decoration: none;
        }
        .c-none {
          color: var(--smoke);
          font-size: 0.875rem;
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
        .count {
          margin-left: auto;
          font-variant-numeric: tabular-nums;
          color: var(--paper);
        }

        .links {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 0.6rem;
        }

        .empty,
        .wait,
        .err {
          margin: 0;
          display: flex;
          align-items: center;
          gap: 0.5em;
          font-size: 0.875rem;
          line-height: 1.45;
          color: var(--smoke);
        }
        .err {
          color: var(--paper);
        }

        @container card (width < 500px) {
          .hero {
            flex-direction: column;
            align-items: flex-start;
          }
          .portrait {
            width: 6.5rem;
          }
        }
      </style>
    </template>
  };

  // EDIT — four editable fields, so ONE section and no accordion (edit-card
  // Rule 0: a card with this few fields needs one section, not four). The
  // computed `initials`/`title` are deliberately absent.
  static edit: BaseDefComponent = class Edit extends Component<
    typeof SoleVaultPerson
  > {
    <template>
      <div class='p-edit'>
        <div class='pe-grid'>
          <FieldContainer @label='Name' @tag='label' @vertical={{true}}>
            <@fields.name />
            <p class='pe-help'>Initials and the display title derive from
              this.</p>
          </FieldContainer>
          <FieldContainer @label='Email' @tag='label' @vertical={{true}}>
            <@fields.email />
          </FieldContainer>
          <FieldContainer @label='Phone' @tag='label' @vertical={{true}}>
            <@fields.phone />
          </FieldContainer>
        </div>
        <FieldContainer @label='Photo' @tag='label' @vertical={{true}}>
          <@fields.photo />
          <p class='pe-help'>Paste a URL or upload a file — consumers read
            whichever wins as
            <code>photo.resolvedUrl</code>.</p>
        </FieldContainer>
      </div>

      <style scoped>

        /* edit-card Rule 1: the edit format has no host-provided container —
           declare our own, named. Literal dark-luxury tokens, matching the
           rest of the family. */
        .p-edit {
          container-type: inline-size;
          container-name: p-edit;

          --ink-950: var(--primary-foreground, oklch(0.216 0.006 56.04));
          --background: oklch(0.985 0.001 106.42);
          --ink-900: var(--background);
          --card: oklch(1 0 0);
          --card-foreground: oklch(0.147 0.004 49.25);
          --accent: oklch(0.769 0.188 70.08);
          --accent-foreground: oklch(0.216 0.006 56.04);
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

          background: var(--ink-900);
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          height: 100%;
          overflow-y: auto;
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          box-sizing: border-box;

          scrollbar-color: var(--gold) var(--ink-800);
        }
        .p-edit::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .p-edit::-webkit-scrollbar-track {
          background: var(--ink-800);
        }
        .p-edit::-webkit-scrollbar-thumb {
          background: var(--gold);
          border-radius: 999px;
          border: 2px solid var(--ink-800);
        }
        .p-edit ::selection {
          background: var(--gold);
          color: var(--ink-950);
        }
        .p-edit *:focus-visible {
          outline: 2px solid var(--gold);
          outline-offset: 2px;
        }
        .pe-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 1rem;
        }
        .pe-help {
          margin: 0.35rem 0 0;
          font-size: 0.75rem;
          line-height: 1.45;
          color: var(--smoke);
        }
        .pe-help code {
          font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;
          background: var(--ink-700);
          padding: 0.05em 0.3em;
          border-radius: 3px;
          color: var(--paper);
        }
        .p-edit :deep(.boxel-label) {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--smoke);
        }

        @container p-edit (width < 640px) {
          .pe-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  // FITTED — FittedCard, same fork and knobs as the rest of the Sole Vault
  // family.
  //
  // SLOT DISCIPLINE — two distinct facts, two slots. No eyebrow: the only
  // string left is the email, which is already the footer, and "Person" as a
  // literal eyebrow is chrome that costs the title a row at the badge quantum.
  static fitted: BaseDefComponent = class Fitted extends Component<
    typeof SoleVaultPerson
  > {
    <template>
      <FittedCard
        class='p-fit'
        @imageUrl={{@model.photo.resolvedUrl}}
        @imageAlt={{@model.title}}
        @titleTag='h3'
      >
        {{! Rule 2 anchor: tier 1 is the photo. The tier-2 fallback here is the
            INITIALS rather than the generic user glyph — a person's initials
            identify this record, where a placeholder avatar is exactly the
            "decoration where content should be" the rules warn against. The
            icon stays as the last resort for an unnamed person, where
            `initialsOf` yields '?'. }}
        <:placeholder>
          {{#if @model.name}}
            <span class='p-init'>{{@model.initials}}</span>
          {{else}}
            <UserIcon
              width='max(18px, 34%)'
              height='max(18px, 34%)'
              aria-hidden='true'
            />
          {{/if}}
        </:placeholder>

        <:title>{{@model.title}}</:title>

        <:footer>
          {{! An email is an identifier — it gets typed and read aloud — so it
              never ellipsises. It is hidden WHOLE at the narrow quanta below. }}
          {{#if @model.email}}
            <span class='p-mail'>{{@model.email}}</span>
          {{/if}}
        </:footer>
      </FittedCard>

      <style scoped>
        /* No container-type / container-name — FittedCard queries the host's
           `fitted-card` container. Literal dark-luxury tokens, matching the
           rest of the family. */
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
          /* The miniature vault plaque — inset shadow, not a border. */
          box-shadow: inset 2px 0 0 0 var(--gold);

          /* A person reads as a portrait, so the image is square and sits
             tighter than the product tiles' 11rem. */
          --fc-image-width: 42cqh;
          --fc-image-min-width: 3rem;
          --fc-image-max-width: 7rem;
          --fc-image-object-fit: cover;
          --fc-image-background: var(--ink-700);
          --fc-image-fade-color: var(--ink-800);

          --fc-content-padding: 0.4rem 0.7rem;
          --fc-header-gap: 0.15em;
          --fc-content-gap: 0.25rem;

          --fc-title-font-size: max(13px, 1.05em);
          --fc-title-line-height: 1.2;
          --fc-title-line-clamp: 2;
          --fc-footer-font-size: max(11px, 0.78em);
          --fc-footer-gap: 0.5rem;
          --fc-footer-justify: flex-start;
          --fc-footer-flex-wrap: nowrap;
        }

        /* Rule 2: the name is the anchor, so it is the loud thing at every
           size — there is no eyebrow competing with it. */
        .p-fit :deep(.fc-title) {
          font-family: 'Playfair Display', Georgia, serif;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .p-fit :deep(.fc-footer) {
          line-height: 1.25;
        }

        /* Initials as the anchor: serif gold, the family's plaque treatment, so
           a photo-less person still reads as this app rather than as a gap. */
        .p-init {
          font-family: 'Playfair Display', Georgia, serif;
          /* Rule 1: the scale is CAPPED, not just floored. A bare
             `max(14px, 30cqh)` reaches ~82px in the tallest quantum, and two
             capital letters at that size are wider than the 7rem image column —
             so it would overflow horizontally instead of clipping vertically,
             which is the same defect wearing a different axis. clamp() bounds
             both ends; 1.15 line-height keeps descenders intact at the floor. */
          font-size: clamp(14px, 30cqh, 40px);
          line-height: 1.15;
          font-weight: 700;
          letter-spacing: 0.02em;
          color: var(--gold-ink, var(--gold));
        }
        .p-mail {
          color: var(--smoke);
          white-space: nowrap;
        }

        /* ---- quanta: visibility only, never a shrink-into-a-clip ---- */
        @container fitted-card (height <= 50px) {
          .p-fit {
            --fc-footer-display: none;
            --fc-title-line-clamp: 1;
            --fc-content-padding: 0.15rem 0.3rem;
          }
        }

        /* The email is dropped WHOLE rather than truncated to a stub — a
           half-visible address is worse than an absent one. */
        @container fitted-card (width <= 220px) and (height <= 80px) {
          .p-fit .p-mail {
            display: none;
          }
        }

        @container fitted-card (width <= 150px) {
          .p-fit {
            --fc-image-max-width: 100%;
          }
        }
      </style>
    </template>
  };

  // Overrides the pulled base's plain boxel-theme embedded row with the Sole
  // Vault family's own literal ink/gold palette, so the row matches the rest
  // of the app instead of the pulled block's default theming.
  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof SoleVaultPerson
  > {
    <template>
      <div class='person-row'>
        {{#if @model.photo.resolvedUrl}}
          <img class='person-avatar' src={{@model.photo.resolvedUrl}} alt='' />
        {{else}}
          <span class='person-avatar person-initials'>{{@model.initials}}</span>
        {{/if}}
        <span class='person-main'>
          <span class='person-name'>{{@model.title}}</span>
          {{#if @model.email}}
            <span class='person-sub'>{{@model.email}}</span>
          {{/if}}
        </span>
      </div>
      <style scoped>
        /* A CardDef embedded is mounted inside the host's CardContainer, which
           draws a boundary and adds no padding, so the inset comes from here.
           Literal dark-luxury tokens, matching the rest of the family. */
        .person-row {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.5rem 0.7rem;
          background: var(--card, oklch(0.216 0.006 56.04));
          color: var(--foreground, oklch(0.985 0.001 106.42));
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
        }
        .person-avatar {
          width: 2.375rem;
          height: 2.375rem;
          border-radius: 50%;
          flex: none;
          object-fit: cover;
        }
        .person-initials {
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Playfair Display', Georgia, serif;
          font-weight: 700;
          font-size: 0.875rem;
          line-height: 1;
          color: var(--background, oklch(0.1 0.004 49.25));
          background: linear-gradient(
            155deg,
            var(--primary, oklch(0.769 0.188 70.08)) 0%,
            var(--accent, oklch(0.828 0.189 84.43)) 100%
          );
        }
        .person-main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .person-name {
          font-size: 0.875rem;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .person-sub {
          font-size: 0.75rem;
          color: var(--muted-foreground, oklch(0.709 0.01 56.26));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
    </template>
  };
}

export default SoleVaultPerson;
