import {
  CardDef,
  Component,
  contains,
  field,
  type CaptureSpec,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { SignedCaptureLink } from '@cardstack/boxel-host/lib/signed-capture';

// Pattern example for declared PDFs. One card, both authoring paths for a
// `type: 'pdf'` declared capture:
//
//   - `statement` sources the card's own `isolated` format. Reach for this
//     when the isolated template already reads like the document.
//   - `letter` sources a dedicated capture-only component. Reach for this
//     when the document's shape differs from any display format.
//
// A declared PDF has no capture box — no width/height — and paginates under
// print media (`@media print`, `@page`, and `break-*` rules). Both PDFs are
// captured eagerly at index time and served at durable `?name=` URLs, which
// `@model.captureURLs` exposes.
//
// Each PDF is saved under a name the card controls: `statement` computes one
// from the instance's fields with a `filename` function, and `letter`
// declares none, so it takes the card's title. `SignedCaptureLink` opens a
// PDF in a new tab, or with `@download` saves it — under the declared name, or
// under `@filename` when the link gives one.

// The custom-component path: a capture-only component that renders the full
// document flow itself. It is referenced only from the `static captures`
// declaration — never a display format — so it renders solely on the
// prerender capture route at index time, under emulated print media.
class CoverLetterDocument extends Component<typeof StatementPdfDemo> {
  <template>
    <article class='cover-letter'>
      <h1>Cover Letter</h1>
      <p>
        Enclosed is the statement of account for
        <@fields.accountName />, covering
        <@fields.period />.
      </p>
      <section class='enclosure'>
        <h2>Enclosure</h2>
        <p>Statement of account — see the following page.</p>
      </section>
    </article>
    <style scoped>
      .cover-letter {
        font-family: Georgia, 'Times New Roman', serif;
        line-height: 1.6;
        padding: 2rem;
      }
      /* A second page, so the captured PDF is unambiguously multi-page. */
      .enclosure {
        break-before: page;
      }
    </style>
  </template>
}

export class StatementPdfDemo extends CardDef {
  static displayName = 'Statement PDF Demo';

  @field accountName = contains(StringField);
  @field period = contains(StringField);

  // Two declared PDFs, one per authoring path. Both are geometry-free
  // (`type: 'pdf'` refuses width/height) and paginate under print media.
  static captures: Record<string, CaptureSpec> = {
    statement: {
      format: 'isolated',
      type: 'pdf',
      filename: (card: StatementPdfDemo) =>
        `Statement ${card.accountName} ${card.period}`,
    },
    letter: { render: CoverLetterDocument, type: 'pdf' },
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      {{! Interactive affordances — hidden from the captured statement PDF by
          the `@media print` rule below, so the printed document is clean. }}
      <nav class='downloads'>
        {{#if @model.captureURLs.statement}}
          <SignedCaptureLink @url={{@model.captureURLs.statement}}>
            Statement PDF (isolated-template path)
          </SignedCaptureLink>
          <SignedCaptureLink
            @url={{@model.captureURLs.statement}}
            @download={{true}}
          >
            Download statement
          </SignedCaptureLink>
        {{/if}}
        {{#if @model.captureURLs.letter}}
          <SignedCaptureLink @url={{@model.captureURLs.letter}}>
            Cover letter PDF (custom-component path)
          </SignedCaptureLink>
          <SignedCaptureLink
            @url={{@model.captureURLs.letter}}
            @download={{true}}
            @filename='Cover letter'
          >
            Download cover letter
          </SignedCaptureLink>
        {{/if}}
      </nav>

      <article class='statement'>
        <header>
          <h1>Statement of Account</h1>
          <p>Account: <@fields.accountName /></p>
          <p>Period: <@fields.period /></p>
        </header>
        <section class='details'>
          <h2>Details</h2>
          <p>Continued on the following page…</p>
        </section>
      </article>

      <style scoped>
        .statement {
          font-family: Georgia, 'Times New Roman', serif;
          line-height: 1.6;
          padding: 2rem;
        }
        .downloads {
          display: flex;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp);
        }
        /* A second page, so the captured PDF is unambiguously multi-page. */
        .details {
          break-before: page;
        }
        @media print {
          .downloads {
            display: none;
          }
        }
      </style>
    </template>
  };
}
