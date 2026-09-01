import {
  Component,
  field,
  contains,
  getComponent,
  type BaseDefComponent,
} from '@cardstack/base/card-api';
import UserIcon from '@cardstack/boxel-icons/user';
import MailIcon from '@cardstack/boxel-icons/mail';
import PhoneIcon from '@cardstack/boxel-icons/phone';
import TagIcon from '@cardstack/boxel-icons/tag';
import AlertTriangleIcon from '@cardstack/boxel-icons/alert-triangle';
import StarIcon from '@cardstack/boxel-icons/star';
import {
  FieldContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { SoleVaultPerson } from './sole-vault-person';
import { ScoreField } from './score-field';

// SellerProfile — a genuinely reusable marketplace-seller building block, not
// a Sole Vault–specific concept. Split out from `SoleVaultPerson` on purpose:
// `rating` has no meaning on a buyer, and `sole-vault-person.gts` is used for
// both roles (`Order.buyer` as well as `Order.seller`). Every other Sole
// Vault "person" link keeps using plain `SoleVaultPerson`; only
// `Order.seller` / `Listing.seller` narrow to this.
//
// NO MATCHING MATRIX CONCEPT EXISTS. The matrix's `Vendor`/`Vendor Profile`
// (`l05-5-cm-vendor`, `l05-5-cm-vendor-profile`) looked like a candidate and
// was checked first — its own `whereImplemented` note
// (`vendor.gts — contractStart / contractEnd`) and its `reference` field
// (`institutional-meerkat/legal + audited kit realms`) show it is a B2B
// contract-vendor concept (a supplier under a legal agreement), not a P2P
// marketplace seller. Not a match by *kind*, so this is a build, not a
// consume — and it should be filed as its own new matrix concept (a generic
// "Seller Profile": identity + rating + review count), reusable by any
// marketplace app, not named after Sole Vault.
//
// Extends `SoleVaultPerson`, not `PersonBase` directly, to inherit the
// dark-luxury isolated/edit/fitted views for free rather than duplicating
// ~400 lines of near-identical template — the reusable ESSENCE of this block
// is the schema (PersonBase + rating), and a consuming app in a different
// visual world would override these formats the same way any card override
// works, same as `SoleVaultPerson` itself overrides `PersonBase`'s plain
// `embedded`.
export class SellerProfile extends SoleVaultPerson {
  static displayName = 'Seller Profile';
  static icon = UserIcon;

  // The spec's "Seller Profiles/Rating" need (Should-Have). An unrated
  // seller (no reviews yet) renders an em-dash, per ScoreField's own
  // contract — never a fabricated default score.
  @field rating = contains(ScoreField);

  // ISOLATED — same layout as SoleVaultPerson's, with the rating added to the
  // hero as the one additional fact a seller's landing page needs over a
  // plain person's. Glimmer templates cannot call a parent's `<template>`,
  // so this re-declares the hero markup rather than composing it — the CSS
  // block is identical to the parent's on purpose (one family, one token
  // set), not copied by accident.
  static isolated: BaseDefComponent = class Isolated extends (
    SoleVaultPerson.isolated as any
  ) {
    get hasRating() {
      return (this.args.model as SellerProfile)?.rating != null;
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

            {{#if this.hasRating}}
              <p class='rating'>
                <StarIcon
                  class='rating-icon'
                  width='max(14px, 1em)'
                  height='max(14px, 1em)'
                  aria-hidden='true'
                />
                <@fields.rating @format='atom' />
              </p>
            {{/if}}

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

        {{! What they are selling — reverse query over Listing.seller,
            inherited from SoleVaultPerson.isolated's own getters. }}
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
              {{#each this.listings as |l|}}
                <li>{{#let (getComponent l) as |ListingCard|}}
                    <ListingCard @format='embedded' />
                  {{/let}}</li>
              {{/each}}
            </ul>
          {{else}}
            <p class='empty'>
              <TagIcon width='18' height='18' aria-hidden='true' />Nothing
              listed for sale by this seller yet.
            </p>
          {{/if}}
        </section>
      </article>

      <style scoped>

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
          --shadow-2: 0 8px 24px -8px oklch(0.05 0 0 / 0.14);

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
        .card ::selection {
          background: var(--gold);
          color: var(--ink-950);
        }
        .card *:focus-visible {
          outline: 2px solid var(--gold);
          outline-offset: 2px;
        }
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
        .rating {
          margin: 0;
          display: inline-flex;
          align-items: center;
          gap: 0.4em;
          width: fit-content;
          font-size: 0.9375rem;
          font-weight: 600;
          color: var(--gold-ink, var(--gold));
        }
        .rating-icon {
          color: var(--gold-ink, var(--gold));
        }
        .contact {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .c-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.45em;
          padding: 0.4rem 0.8rem;
          border-radius: 999px;
          background: var(--ink-800);
          border: 1px solid var(--hairline);
          font-size: 0.875rem;
        }
        .c-icon {
          width: max(14px, 1em);
          height: max(14px, 1em);
          flex: none;
          color: var(--gold-ink, var(--gold));
        }
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

  // EDIT — the four inherited fields plus rating; still one section, no
  // accordion (edit-card Rule 0 — five fields is still light).
  static edit: BaseDefComponent = class Edit extends Component<
    typeof SellerProfile
  > {
    <template>
      <div class='sp-edit'>
        <div class='se-grid'>
          <FieldContainer @label='Name' @tag='label' @vertical={{true}}>
            <@fields.name />
          </FieldContainer>
          <FieldContainer @label='Email' @tag='label' @vertical={{true}}>
            <@fields.email />
          </FieldContainer>
          <FieldContainer @label='Phone' @tag='label' @vertical={{true}}>
            <@fields.phone />
          </FieldContainer>
          <FieldContainer @label='Rating' @tag='label' @vertical={{true}}>
            <@fields.rating />
          </FieldContainer>
        </div>
        <FieldContainer @label='Photo' @tag='label' @vertical={{true}}>
          <@fields.photo />
        </FieldContainer>
      </div>

      <style scoped>

        .sp-edit {
          container-type: inline-size;
          container-name: sp-edit;

          --background: oklch(0.985 0.001 106.42);

          --ink-900: var(--background);
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
        }
        .se-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 1rem;
        }
        .sp-edit :deep(.boxel-label) {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--smoke);
        }
        @container sp-edit (width < 640px) {
          .se-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  // FITTED — inherited from SoleVaultPerson unchanged: at fitted sizes the
  // seller's name and photo carry the tile; a star rating at badge scale
  // would compete with the name for the one row a 150×40 tile has.
  static fitted: BaseDefComponent = SoleVaultPerson.fitted;
}

export default SellerProfile;
