import {
  CardDef,
  field,
  contains,
  linksTo,
  StringField,
  Component,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import TextAreaField from '@cardstack/base/text-area';
import { statusField, statusOption } from './status-field';
import MultiImageSourceField from '@cardstack/catalog/fields/multi-image-source/multi-image-source';
import { CollectionItem } from './collection-item';
import ShieldCheckIcon from '@cardstack/boxel-icons/shield-check';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import CalendarClockIcon from '@cardstack/boxel-icons/calendar-clock';
import FileTextIcon from '@cardstack/boxel-icons/file-text';
import NotebookPenIcon from '@cardstack/boxel-icons/notebook-pen';
import ArchiveIcon from '@cardstack/boxel-icons/archive';
import { tracked } from '@glimmer/tracking';
import {
  FittedCard,
  FieldContainer,
  Accordion,
} from '@cardstack/boxel-ui/components';

// AuthenticationRecord — one legit-check on one item: who checked it, when, the
// verdict, and the certificate reference.
//
// A NEW matrix element, checked against the near-misses first:
// `l04-cm-certification-authority` is the authority, not the check;
// `l04-tc-verify-signature` is a cryptographic signature, not a physical
// inspection; `l03-ft-trust-metadata` is a field, not a record. None of them is
// an authentication event, so this is a build rather than a consume.
//
// THE SPLIT AGAINST CollectionItem is deliberate and is the reason both exist:
// this card is the full RECORD (submitted photos, authenticator notes, the
// service, the certificate id — everything a dispute needs), while
// CollectionItem keeps only the OUTCOME (`verifiedOn`, `verifiedBy`,
// `verificationReference`). The outcome is duplicated on purpose: a collection
// grid is prerendered fitted, which cannot resolve a link to this record, so a
// tile could not show a verified badge otherwise. That is denormalization for the
// one legitimate reason — a rendering constraint — not to avoid a query.

export type AuthOutcome = 'pending' | 'passed' | 'failed';

// CONSUMED, not rebuilt — the matrix Status block, pulled into this realm.
// An authentication outcome is a genuine lifecycle, so the transition graph is
// the point: a verdict must not be edited from `passed` to `failed` in a
// dropdown, because a reversal is a new inspection with its own certificate,
// not a correction to this record. Both verdicts are therefore terminal.
export const AuthOutcomeField = statusField({
  displayName: 'Authentication Outcome',
  options: [
    {
      value: 'pending',
      label: 'Pending',
      hue: 'amber',
      meaning: 'Submitted and awaiting a verdict.',
    },
    {
      value: 'passed',
      label: 'Passed',
      hue: 'green',
      terminal: true,
      holds: true,
      meaning: 'Verified genuine. This is the badge a listing shows.',
    },
    {
      value: 'failed',
      label: 'Failed',
      hue: 'red',
      terminal: true,
      holds: true,
      meaning: 'Judged not genuine. In an escrow flow this refunds the buyer.',
    },
  ],
  transitions: {
    pending: ['passed', 'failed'],
    passed: [],
    failed: [],
  },
});

export class AuthenticationRecord extends CardDef {
  static displayName = 'Authentication Record';
  static icon = ShieldCheckIcon;

  @field item = linksTo(() => CollectionItem, { searchable: true });

  // The transaction this check belongs to, when it is part of an escrow flow.
  // Typed as CardDef because Order is a PULL from the matrix realm
  // (`l05-5-cm-order`, Done + Spec) rather than something this lane rebuilds —
  // narrow it to that module once the pull has happened.
  @field order = linksTo(CardDef, { searchable: true });

  // 'Check Check', 'GOAT', 'In-house'. The consumer supplies enum options if it
  // wants a select; the block does not name anyone's list of services.
  @field service = contains(StringField);

  @field outcome = contains(AuthOutcomeField);

  @field submittedAt = contains(DateField);
  @field completedAt = contains(DateField);

  @field certificateId = contains(StringField);
  @field authenticator = contains(StringField);
  @field authenticatorNotes = contains(TextAreaField);
  @field submittedPhotos = contains(MultiImageSourceField);

  // Denormalized for fitted, same reason as everywhere else in this family.
  @field itemTitle = contains(StringField, {
    computeVia: function (this: AuthenticationRecord) {
      return this.item?.itemTitle ?? this.cardInfo?.name ?? '';
    },
  });

  // Turnaround is a real fact a queue view wants, and it is cheap and bounded —
  // both dates are on this card, so it is safe as a computed field. Calendar-day
  // arithmetic, not instants: both sides are read as local Y/M/D by DateField.
  @field turnaroundDays = contains(StringField, {
    computeVia: function (this: AuthenticationRecord) {
      let a = this.submittedAt;
      let b = this.completedAt;
      if (!a || !b) {
        return '';
      }
      let ms = b.getTime() - a.getTime();
      if (ms < 0) {
        return '';
      }
      let days = Math.round(ms / 86400000);
      return days === 1 ? '1 day' : `${days} days`;
    },
  });

  // EDIT — compact identity row (item / order / outcome, Rule 0's "glanced at
  // every time" set), everything else grouped into independently collapsible
  // sections. Timeline opens by default (the fields most often touched while a
  // check is in flight); certificate and evidence start collapsed.
  static edit = class Edit extends Component<typeof AuthenticationRecord> {
    @tracked timelineOpen = true;
    @tracked certificateOpen = false;
    @tracked evidenceOpen = false;

    toggleTimeline = () => (this.timelineOpen = !this.timelineOpen);
    toggleCertificate = () => (this.certificateOpen = !this.certificateOpen);
    toggleEvidence = () => (this.evidenceOpen = !this.evidenceOpen);

    <template>
      <div class='ar-edit'>
        <header class='ce-head'>
          <FieldContainer @label='Item' @tag='label' @vertical={{true}}>
            <@fields.item />
          </FieldContainer>
          <FieldContainer @label='Order' @tag='label' @vertical={{true}}>
            <@fields.order />
          </FieldContainer>
          <FieldContainer @label='Outcome' @tag='label' @vertical={{true}}>
            <@fields.outcome />
          </FieldContainer>
        </header>

        <Accordion class='ce-sections' @displayContainer={{false}} as |A|>
          <A.Item
            @id='timeline'
            @isOpen={{this.timelineOpen}}
            @onClick={{this.toggleTimeline}}
          >
            <:title>Service & timeline</:title>
            <:content>
              <div class='ce-body ce-grid-3'>
                <FieldContainer @label='Service' @tag='label' @vertical={{true}}>
                  <@fields.service />
                </FieldContainer>
                <FieldContainer
                  @label='Submitted'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.submittedAt />
                </FieldContainer>
                <FieldContainer
                  @label='Completed'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.completedAt />
                  <p class='ce-help'>A completion date is what marks the check
                    concluded.</p>
                </FieldContainer>
              </div>
            </:content>
          </A.Item>

          <A.Item
            @id='certificate'
            @isOpen={{this.certificateOpen}}
            @onClick={{this.toggleCertificate}}
          >
            <:title>Certificate</:title>
            <:content>
              <div class='ce-body ce-grid-2'>
                <FieldContainer
                  @label='Certificate ID'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.certificateId />
                </FieldContainer>
                <FieldContainer
                  @label='Authenticator'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.authenticator />
                </FieldContainer>
              </div>
            </:content>
          </A.Item>

          <A.Item
            @id='evidence'
            @isOpen={{this.evidenceOpen}}
            @onClick={{this.toggleEvidence}}
          >
            <:title>Notes & submitted photos</:title>
            <:content>
              <div class='ce-body'>
                <FieldContainer
                  @label='Authenticator notes'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.authenticatorNotes />
                </FieldContainer>
                <FieldContainer
                  @label='Submitted photos'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.submittedPhotos />
                </FieldContainer>
              </div>
            </:content>
          </A.Item>
        </Accordion>
      </div>

      <style scoped>

        /* edit-card Rule 1: no ancestor declares a container for the edit
           format — named so a stray query elsewhere cannot claim it. */
        .ar-edit {
          container-type: inline-size;
          container-name: ar-edit;

          /* Family palette, defined locally — scoped styles do not share
             custom properties across components, so every root in this file
             carries its own copy of the same literal values. */
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
          
          /* Feed the literal values into boxel-ui's own theming knobs
             (BoxelInput, Label, Accordion all read --background /
             --foreground / --border / --ring) rather than restyling their
             internals directly — this is "restyle via their own knobs". */
          --background: var(--ink-800);
          --foreground: var(--paper);
          --border: var(--hairline);
          --ring: var(--gold);
          --boxel-label-color: var(--smoke);

          background: var(--ink-900);
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp-lg);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);

          scrollbar-color: var(--gold) var(--ink-800);
        }
        .ar-edit::-webkit-scrollbar {
          width: 10px;
        }
        .ar-edit::-webkit-scrollbar-track {
          background: var(--ink-800);
        }
        .ar-edit::-webkit-scrollbar-thumb {
          background: var(--gold);
          border-radius: 999px;
          border: 2px solid var(--ink-800);
        }
        .ar-edit ::selection {
          background: var(--gold);
          color: var(--ink-900);
        }
        .ar-edit *:focus-visible {
          outline: 2px solid var(--gold);
          outline-offset: 2px;
        }
        .ce-head {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: var(--boxel-sp);
          padding-bottom: var(--boxel-sp);
          border-bottom: 1px solid var(--hairline);
        }
        .ce-sections {
          background: var(--ink-800);
          border-radius: 10px;
          padding-inline: var(--boxel-sp);
        }
        .ce-body {
          padding-top: var(--boxel-sp-xs);
          padding-bottom: var(--boxel-sp-sm);
          display: grid;
          gap: var(--boxel-sp);
        }
        .ce-grid-2 {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: var(--boxel-sp);
        }
        .ce-grid-3 {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: var(--boxel-sp);
        }
        .ce-help {
          margin: var(--boxel-sp-4xs) 0 0;
          font-size: 0.75rem;
          color: var(--smoke);
        }
        @container ar-edit (width < 640px) {
          .ce-head {
            grid-template-columns: repeat(1, minmax(0, 1fr));
          }
        }
      </style>
    </template>
  };

  // ISOLATED — the record's landing page.
  //
  // DOMAIN QUESTION: "did this pass, and how long did it take?" A dispute or a
  // buyer opens this card for the verdict and the paper trail, so the verdict is
  // the hero and the certificate id is the thing they copy into another system.
  //
  // Direction: Instrument (the family's operational register) — hairline rules,
  // tabular figures, status as colour. The signature element is the family's
  // vault plaque: a gold hairline over the headline value, matching
  // CollectionItem's worth figure and the fitted tiles' gold edge.
  static isolated = class Isolated extends Component<
    typeof AuthenticationRecord
  > {
    // The check's own lifecycle, drawn from the two dates this card owns. Same
    // rail shape as CollectionItem's provenance section — one signature element
    // reused across the family, not a new marquee per card.
    //
    // In review = submitted but not yet concluded. Reading it off the dates
    // rather than storing it keeps it from drifting, the same rule the schema
    // applies to `verified` / `forSale` on CollectionItem.
    get isUnderReview() {
      let m = this.args.model;
      return Boolean(m?.submittedAt) && !m?.completedAt;
    }

    get verdictLabel() {
      let outcome = this.args.model?.outcome;
      if (outcome === 'passed') {
        return 'Verdict — passed';
      }
      if (outcome === 'failed') {
        return 'Verdict — failed';
      }
      return 'Verdict';
    }

    // The plaque's own big label + colour, derived from the SAME option list
    // AuthOutcomeField already exports — no second hand-mapped status→colour
    // list to drift from it. `passed` gets the family's gold treatment
    // (the brand's positive colour, reused everywhere else); `failed` gets
    // the rose Payment's refund plaque uses, so "negative" reads the same
    // hue across the whole app; `pending` stays a neutral ink panel, since
    // an undecided verdict has not earned a colour commitment yet.
    get verdictOption() {
      return statusOption(AuthOutcomeField, this.args.model?.outcome);
    }

    get verdictModifierClass() {
      let outcome = this.args.model?.outcome;
      if (outcome === 'passed') {
        return 'plaque--passed';
      }
      if (outcome === 'failed') {
        return 'plaque--failed';
      }
      return 'plaque--pending';
    }

    get hasPaperTrail() {
      let m = this.args.model;
      return Boolean(m?.certificateId || m?.authenticator || m?.service);
    }

    <template>
      <article class='card'>
        <header class='hero'>
          <div class='hero-head'>
            <h1 class='hero-title'>
              <ShieldCheckIcon
                class='hero-glyph'
                width='max(18px, 0.85em)'
                height='max(18px, 0.85em)'
                aria-hidden='true'
              />{{if @model.itemTitle @model.itemTitle 'Unlinked item'}}
            </h1>
            {{#if @model.service}}
              <p class='hero-service'>{{@model.service}}</p>
            {{/if}}
          </div>

          {{! THE PLAQUE — the family's filled-panel hero device (same
              radius/shadow as CollectionItem's worth figure, CompletionSet's
              percentage, Listing's price), recoloured per verdict rather than
              rendered as a small inline pill. The verdict is the one loud
              thing; turnaround is its quiet annotation, stepping DOWN in
              weight beside the figure it modifies. }}
          <div class='plaque {{this.verdictModifierClass}}'>
            <p class='plaque-value'>{{if
                @model.outcome
                this.verdictOption.label
                'Not submitted'
              }}</p>
            {{#if @model.turnaroundDays}}
              <p class='turnaround'>
                <CalendarClockIcon
                  width='max(13px, 0.95em)'
                  height='max(13px, 0.95em)'
                  aria-hidden='true'
                />
                {{@model.turnaroundDays}}
                <span class='turnaround-k'>turnaround</span>
              </p>
            {{/if}}
          </div>
        </header>

        {{! AT A GLANCE — shape: ol. The lifecycle rail, the family signature.
            The three steps are written out rather than looped: each row needs
            its OWN date field, and a loop over a getter forced one shared
            `<@fields.x>` into every row — which rendered the submission date
            beside the verdict. Three explicit rows carrying one fact each beats
            a loop that has to lie about one of them. }}
        <section class='sec'>
          <h2><CalendarIcon class='sec-icon' aria-hidden='true' />Progress</h2>
          <ol class='steps'>
            <li class='step {{if @model.submittedAt "step--done"}}'>
              <span class='step-label'>Submitted</span>
              {{#if @model.submittedAt}}
                <span class='step-when'><@fields.submittedAt
                    @format='atom'
                  /></span>
              {{/if}}
            </li>
            <li class='step {{if this.isUnderReview "step--done"}}'>
              <span class='step-label'>Under review</span>
            </li>
            <li class='step {{if @model.completedAt "step--done"}}'>
              <span class='step-label'>{{this.verdictLabel}}</span>
              {{#if @model.completedAt}}
                <span class='step-when'><@fields.completedAt
                    @format='atom'
                  /></span>
              {{/if}}
            </li>
          </ol>
        </section>

        <div class='cols'>
          {{! DETAIL — shape: dl. The paper trail: the values someone types into
              another system, so identifiers never ellipsis. }}
          <section class='sec'>
            <h2><FileTextIcon class='sec-icon' aria-hidden='true' />Paper trail</h2>
            {{#if this.hasPaperTrail}}
              <dl class='trail'>
                {{#if @model.certificateId}}
                  <div class='trail-row'>
                    <dt>Certificate</dt>
                    <dd class='trail-id'>{{@model.certificateId}}</dd>
                  </div>
                {{/if}}
                {{#if @model.service}}
                  <div class='trail-row'>
                    <dt>Service</dt>
                    <dd>{{@model.service}}</dd>
                  </div>
                {{/if}}
                {{#if @model.authenticator}}
                  <div class='trail-row'>
                    <dt>Authenticator</dt>
                    <dd>{{@model.authenticator}}</dd>
                  </div>
                {{/if}}
              </dl>
            {{else}}
              {{! Rule 5: an empty section with a muted glyph reads as designed;
                  the same sentence alone reads as a bug. }}
              <p class='empty'>
                <FileTextIcon width='18' height='18' aria-hidden='true' />No
                certificate recorded yet.
              </p>
            {{/if}}
          </section>

          {{! DETAIL — shape: prose. Deliberately a different shape from the dl
              beside it, so the two sections do not read as one list twice. }}
          <section class='sec'>
            <h2><NotebookPenIcon
                class='sec-icon'
                aria-hidden='true'
              />Authenticator notes</h2>
            {{#if @model.authenticatorNotes}}
              <div class='notes'><@fields.authenticatorNotes /></div>
            {{else}}
              <p class='empty'>
                <NotebookPenIcon width='18' height='18' aria-hidden='true' />No
                notes from the authenticator.
              </p>
            {{/if}}
          </section>
        </div>

        {{! DETAIL — shape: linked card + gallery. Third distinct shape. }}
        <section class='sec'>
          <h2><ArchiveIcon class='sec-icon' aria-hidden='true' />Item checked</h2>
          {{#if @model.item}}
            <@fields.item @format='embedded' @displayContainer={{false}} />
          {{else}}
            <p class='empty'>
              <ArchiveIcon width='18' height='18' aria-hidden='true' />This
              record is not linked to a collection item.
            </p>
          {{/if}}
        </section>
      </article>

      <style scoped>

        /* Rule 1: an isolated card gets NO host container — nothing up the chain
           declares one — so this template declares its own, NAMED, or every
           @container rule below is inert CSS. `inline-size`, not `size`: this
           column scrolls, and `size` needs a definite block size. */
        .card {
          container-type: inline-size;
          container-name: card;
          width: 100%;
          height: 100%;
          overflow-y: auto;

          /* Family palette — literal values, defined locally in every scoped
             style block in this file (scoped styles do not share custom
             properties across components). Matches sole-vault-app.gts
             exactly, so the record reads as one app with its shell. */
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
          /* Verdict hues — passed/failed get the same bold filled-panel
             treatment as the rest of the family's plaques, just recoloured;
             rose matches Payment's outflow tone so "negative" reads the same
             across the app. */
          --green: oklch(0.72 0.16 145);
          --green-bright: oklch(0.78 0.17 150);
          --rose: oklch(0.7 0.16 24);
          --rose-bright: oklch(0.76 0.17 27);
          --shadow-1: 0 1px 2px oklch(0.05 0 0 / 0.08);
          --shadow-2: 0 8px 24px -8px oklch(0.05 0 0 / 0.14);
          --shadow-3: 0 20px 48px -16px oklch(0.05 0 0 / 0.18);

          --font-display: var(--font-serif, 'Playfair Display', Georgia, serif);
                    --font-mono: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;

          background: var(--ink-900);
          background-image: radial-gradient(
            ellipse 1200px 640px at 15% -10%,
            var(--ink-800) 0%,
            transparent 60%
          );
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          padding: var(--boxel-sp-lg);
          /* ONE vertical rhythm mechanism — the parent's gap. No child
             margin-top anywhere, so there is no override to undo it. */
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
          box-sizing: border-box;

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
          display: flex;
          flex-wrap: wrap;
          align-items: flex-end;
          justify-content: space-between;
          gap: var(--boxel-sp);
        }
        .hero-head {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-4xs);
        }
        /* No kicker above the heading — the glyph sits IN the heading, and the
           service is a quiet line BELOW the title rather than a caps label
           above it. */
        .hero-title {
          margin: 0;
          display: flex;
          align-items: center;
          gap: 0.4em;
          font-family: var(--font-display);
          font-size: clamp(1.75rem, 1.3rem + 1.6cqi, 2.375rem);
          line-height: 1.15;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .hero-glyph {
          color: var(--gold-ink, var(--gold));
          flex: none;
        }
        .hero-service {
          margin: 0;
          font-size: 0.875rem;
          color: var(--smoke);
        }
        /* THE VAULT PLAQUE — the family signature: a gold hairline over the
           headline value. Same mark as CollectionItem's worth figure. */
        /* Same filled-panel device as the rest of the family (radius/shadow
           match CollectionItem's --panel-radius convention), recoloured by
           verdict rather than left as a bare hairline + small inline pill —
           this IS the dominant element on the card, so it needs the same
           committed surface area as everyone else's hero figure. */
        /* Light translation: white ground, the top-rule carrying the
           VERDICT's hue — gold while pending, green passed, rose failed. The
           dark-era filled verdict slabs read as solid colour blocks on
           white. */
        .plaque {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: var(--boxel-sp-4xs);
          margin-top: auto;
          background: var(--ink-800);
          border: 1px solid var(--hairline);
          border-top: 3px dashed var(--gold);
          border-radius: 6px;
          padding: 1.1rem 1.4rem;
          box-shadow: var(--shadow-1);
        }
        .plaque--passed {
          border-top: 3px solid var(--green);
        }
        .plaque--failed {
          border-top: 3px solid var(--rose);
        }
        .plaque-value {
          margin: 0;
          font-family: var(--font-display);
          font-size: clamp(2rem, 1.5rem + 2cqi, 2.75rem);
          line-height: 1.1;
          font-weight: 900;
          color: var(--paper);
        }
        .plaque--passed .plaque-value,
        .plaque--failed .plaque-value {
          color: var(--paper);
        }
        .turnaround {
          margin: 0;
          display: inline-flex;
          align-items: center;
          gap: 0.35em;
          font-size: 0.8125rem;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          color: var(--smoke);
        }
        .turnaround-k {
          font-size: 0.6875rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: color-mix(in oklch, var(--paper) 65%, transparent);
        }
        .plaque--passed .turnaround,
        .plaque--passed .turnaround-k,
        .plaque--failed .turnaround,
        .plaque--failed .turnaround-k {
          color: color-mix(in oklch, var(--ink-950) 75%, transparent);
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
        /* Rule 5: section icons are muted and identical in size across every
           header — one loud thing per card, and it is the verdict. */
        .sec-icon {
          width: max(14px, 1em);
          height: max(14px, 1em);
          flex: none;
        }

        .cols {
          display: grid;
          /* Content-sized, not 1fr 1fr: a dl of short rows and a prose block
             should not be forced to equal widths. */
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: var(--boxel-sp-lg);
        }

        /* ---------- lifecycle rail (signature) ---------- */
        .steps {
          list-style: none;
          margin: 0;
          padding: 0 0 0 var(--boxel-sp);
          border-left: 2px solid var(--hairline);
          display: grid;
          gap: var(--boxel-sp);
        }
        .step {
          position: relative;
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          font-size: 0.875rem;
        }
        .step::before {
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
        /* A reached milestone is a vault mark — gold, same as the provenance
           rail on CollectionItem. */
        .step--done::before {
          background: var(--gold);
        }
        .step-label {
          font-weight: 600;
        }
        .step-when {
          font-size: 0.8125rem;
          font-variant-numeric: tabular-nums;
          color: var(--smoke);
        }

        /* ---------- paper trail ---------- */
        .trail {
          display: grid;
          gap: var(--boxel-sp-xs);
          margin: 0;
        }
        .trail-row {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          justify-content: space-between;
          gap: var(--boxel-sp-xs);
          font-size: 0.875rem;
        }
        .trail-row dt {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--smoke);
        }
        .trail-row dd {
          margin: 0;
          font-weight: 600;
        }
        /* An identifier is read aloud and typed into other systems: it never
           ellipsises, and it is monospace + tabular so digits line up. */
        .trail-id {
          font-family: var(--font-mono);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }

        .notes {
          font-size: 0.875rem;
          line-height: 1.55;
        }

        .empty {
          margin: 0;
          display: flex;
          align-items: center;
          gap: 0.5em;
          padding: var(--boxel-sp-sm) var(--boxel-sp);
          font-size: 0.8125rem;
          color: var(--smoke);
        }

        /* Rule 1: these fire because .card declares the container above. */
        @container card (width < 640px) {
          .cols {
            grid-template-columns: 1fr;
          }
          .hero {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      </style>
    </template>
  };

  // FITTED — Step 0 fork: FittedCard, not hand-rolled. This is a standard
  // composition (image/placeholder + eyebrow + title + badge + footer) and the
  // three fitted templates already shipped in this family use it, so forking a
  // fourth idiom here would break the family for no gain.
  //
  // SLOT DISCIPLINE — four distinct facts, four slots, zero repeats.
  // `<:subtitle>` and `<:meta>` are deliberately NOT rendered: the only values
  // left to put in them are the service (already the eyebrow) and the outcome
  // (already the badge), and a slot filled with a value shown elsewhere is the
  // documented failure that survives source review because the repeat only
  // appears at the quanta where both slots happen to be visible.
  static fitted = class Fitted extends Component<typeof AuthenticationRecord> {
    <template>
      <FittedCard
        class='a-fit'
        @imageUrl={{@model.submittedPhotos.primaryUrl}}
        @imageAlt={{@model.itemTitle}}
        @titleTag='h3'
      >
        {{! Rule 2 anchor: tier 1 is the submitted photo; this is the tier-2
            fallback and it is the card's OWN static icon — the same one its
            isolated view and its breadcrumb use, which is what makes it identity
            rather than filler. Never an empty grey square. }}
        <:placeholder>
          <ShieldCheckIcon
            width='max(18px, 34%)'
            height='max(18px, 34%)'
            aria-hidden='true'
          />
        </:placeholder>

        <:eyebrow>{{@model.service}}</:eyebrow>

        <:title>{{if
            @model.itemTitle
            @model.itemTitle
            'Unlinked item'
          }}</:title>

        <:badgeRight>
          {{! Delegated to the status field, whose StatePill derives its colour
              from the option's hue. A hand-rolled per-outcome class list here
              would be a second, drifting definition of the same three colours. }}
          {{#if @model.outcome}}
            <@fields.outcome @format='atom' />
          {{/if}}
        </:badgeRight>

        <:footer>
          {{! Rule 1, data is all-or-nothing: an identifier is never ellipsised,
              so the certificate gets `nowrap` and is hidden WHOLE at the narrow
              quanta below rather than truncated to an unreadable stub. }}
          {{#if @model.certificateId}}
            <span class='a-cert'>{{@model.certificateId}}</span>
          {{/if}}
          {{#if @model.turnaroundDays}}
            <span class='a-turn'>{{@model.turnaroundDays}}</span>
          {{/if}}
        </:footer>
      </FittedCard>

      <style scoped>

        /* NO container-type / container-name here — FittedCard queries the
           HOST's `fitted-card` container, and declaring one would capture those
           queries. Everything below is a --fc-* knob or a visibility change. */
        .a-fit {
          /* Family palette — the same literal values the isolated view uses,
             defined locally again because scoped styles do not share custom
             properties across components. */
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
          --font-display: var(--font-serif, 'Playfair Display', Georgia, serif);
                    --font-mono: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;

          background: var(--ink-800);
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          /* The miniature vault plaque: a 2px gold edge as an INSET SHADOW, not
             a border — the host draws the chrome and a border would fight it. */
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

        /* Rule 2: the eyebrow stays quiet so the title wins by CONTRAST, not
           only by size. Two loud things would mean no anchor. */
        .a-fit :deep(.fc-eyebrow) {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--smoke);
          font-weight: 600;
        }
        .a-fit :deep(.fc-title) {
          font-family: var(--font-display);
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        /* Set here, NOT via a `--fc-footer-line-height` knob — that name does
           not exist, and an invented --fc-* name is valid CSS that silently
           does nothing. */
        .a-fit :deep(.fc-footer) {
          line-height: 1.25;
        }

        /* A certificate id is read aloud and typed into other systems: mono,
           tabular, and never wrapped or ellipsised. */
        .a-cert {
          font-family: var(--font-mono);
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          white-space: nowrap;
        }
        /* Turnaround is the plaque value on this card — serif gold, matching the
           money figures on its siblings. */
        .a-turn {
          font-family: var(--font-display);
          color: var(--gold-ink, var(--gold));
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }

        /* ---- quanta: visibility only, never a shrink-into-a-clip ----
           The type scale itself does not step; these rules hide whole rows. */

        /* Badge tier (h <= 50): the title is usually the only survivor, and it
           must still be the loudest thing. Everything else goes. */
        @container fitted-card (height <= 50px) {
          .a-fit {
            --fc-footer-display: none;
            --fc-badge-right-display: none;
            --fc-title-line-clamp: 1;
            --fc-content-padding: var(--boxel-sp-4xs) var(--boxel-sp-xxs);
          }
          .a-fit :deep(.fc-eyebrow) {
            display: none;
          }
        }

        /* Very narrow strips: the certificate is dropped WHOLE rather than
           truncated, leaving the turnaround — a half-visible id is worse than
           an absent one, and the id is the longer of the two. */
        @container fitted-card (width <= 200px) and (height <= 80px) {
          .a-fit .a-cert {
            display: none;
          }
        }

        /* Narrow tiles: the image would starve the text column below the ~200px
           content-column rule, so it yields width rather than the title
           clipping. */
        @container fitted-card (width <= 150px) {
          .a-fit {
            --fc-image-max-width: 100%;
          }
          .a-fit :deep(.fc-eyebrow) {
            display: none;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof AuthenticationRecord> {
    <template>
      <span class='a-atom'>
        <ShieldCheckIcon width='13' height='13' aria-hidden='true' />
        {{#if @model.outcome}}
          {{! Delegated to the field. The status block already renders a
              StatePill whose colour is DERIVED from the option's hue — a
              hand-rolled `.a-out--passed` colour list here would be a second,
              drifting definition of the same thing. }}
          <@fields.outcome @format='atom' />
        {{else}}
          <span class='a-none'>not submitted</span>
        {{/if}}
      </span>
      <style scoped>
        .a-atom {
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
          gap: var(--boxel-sp-4xs);
        }
        .a-none {
          font-size: var(--boxel-font-size-xs);
          color: var(--smoke);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<
    typeof AuthenticationRecord
  > {
    <template>
      <div class='a-emb'>
        <div class='a-head'>
          <ShieldCheckIcon width='16' height='16' aria-hidden='true' />
          <span class='a-title'>{{@model.itemTitle}}</span>
          <span class='a-state'>
            {{#if @model.outcome}}
              <@fields.outcome @format='embedded' />
            {{else}}
              <span class='a-none'>Not submitted</span>
            {{/if}}
          </span>
        </div>
        <div class='a-meta'>
          <span>{{if @model.service @model.service '—'}}</span>
          <span class='a-cert'>{{if
              @model.certificateId
              @model.certificateId
              '—'
            }}</span>
          <span>{{if @model.turnaroundDays @model.turnaroundDays '—'}}</span>
        </div>
      </div>
      <style scoped>
        /* Own inset — the host's CardContainer adds none. */
        .a-emb {
          --muted: oklch(0.97 0.001 106.42);
          --secondary: oklch(0.923 0.003 48.72);
          --secondary-foreground: oklch(0.216 0.006 56.04);
          --input: oklch(1 0 0);
          --popover: oklch(1 0 0);
          --popover-foreground: oklch(0.147 0.004 49.25);
          --muted-foreground: oklch(0.553 0.013 58.07);
          --smoke: var(--muted-foreground);
          --font-mono: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;
          display: grid;
          gap: var(--boxel-sp-4xs);
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .a-head {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xxs);
          min-width: 0;
        }
        .a-title {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        /* The pill itself is StatePill's, drawn by the status block. This only
           positions it. */
        .a-state {
          flex: none;
          margin-left: auto;
          display: inline-flex;
        }
        .a-none {
          font-size: var(--boxel-font-size-xs);
          color: var(--smoke);
        }
        .a-meta {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-xs);
          color: var(--smoke);
        }
        /* A certificate id is read aloud and typed elsewhere — never ellipsised. */
        .a-cert {
          font-family: var(--font-mono);
          white-space: nowrap;
        }
      </style>
    </template>
  };
}

export default AuthenticationRecord;
