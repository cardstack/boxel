import {
  CardDef,
  Component,
  contains,
  containsMany,
  field,
  realmURL,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import MarkdownField from '@cardstack/base/markdown';
import { CaptureDownloadButton } from '@cardstack/base/components/capture-download-button';
import downloadCapture from '@cardstack/base/modifiers/download-capture';

// A printable report in the shape a customer's "parent report" card takes
// once it follows the PDF-export migration notes: the page setup and print
// rules live in the card's own styles, the toolbar hides under print media,
// and the print action is the card's own durable PDF URL. Renders the
// notes' plain link, the same link with the download modifier, and the
// download button so the three can be compared.
class Isolated extends Component<typeof PrintableReport> {
  get pdfURL(): string | undefined {
    let realm = this.args.model[realmURL]?.href;
    let id = this.args.model.id;
    if (!realm || !id) {
      return undefined;
    }
    return `${realm}_screenshot/${id.slice(realm.length)}?type=pdf&media=print`;
  }

  get previewURL(): string | undefined {
    return this.pdfURL?.replace('type=pdf&', '');
  }

  <template>
    <div class='report'>
      <div class='pr-tools' role='toolbar' aria-label='Report actions'>
        <CaptureDownloadButton @url={{this.pdfURL}} @size='small'>
          Save PDF
        </CaptureDownloadButton>
        {{#if this.pdfURL}}
          <a
            class='pr-btn'
            href={{this.pdfURL}}
            target='_blank'
            rel='noopener noreferrer'
          >Download PDF (plain link)</a>
          <a class='pr-btn' href={{this.pdfURL}} {{downloadCapture}}>Download
            PDF (link + modifier)</a>
          <a
            class='pr-btn'
            href={{this.previewURL}}
            target='_blank'
            rel='noopener noreferrer'
          >Preview print layout as PNG</a>
        {{/if}}
      </div>

      <article class='paper'>
        <section class='sheet'>
          <header class='sheet-head'>
            <p class='eyebrow'>{{@model.school}}</p>
            <h1 class='sheet-title'><@fields.cardTitle /></h1>
            <p class='meta'>
              <span>Student: <@fields.student /></span>
              <span>Term: <@fields.term /></span>
            </p>
          </header>
          <div class='body'>
            <@fields.summary />
          </div>
        </section>

        {{#each @fields.sections as |Section|}}
          <section class='sheet page-break'>
            <Section />
          </section>
        {{/each}}

        <footer class='sheet-foot'>
          Prepared for the family of
          <@fields.student />
          ·
          {{@model.school}}
        </footer>
      </article>
    </div>

    <style scoped>
      @page {
        size: letter portrait;
        margin: 0.45in 0.5in 0.5in;
      }

      .report {
        height: 100%;
        overflow-y: auto;
        padding: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      .pr-tools {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .pr-btn {
        font-size: var(--boxel-font-size-sm);
        color: var(--primary);
        text-decoration: underline;
      }
      .paper {
        --paper-width: 8.5in;
        max-width: var(--paper-width);
        margin: 0 auto;
        background: var(--card);
        color: var(--card-foreground);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius-lg);
        box-shadow: var(--boxel-box-shadow);
      }
      .sheet {
        padding: var(--boxel-sp-xl);
      }
      .sheet-head {
        border-bottom: 2px solid var(--primary);
        padding-bottom: var(--boxel-sp);
        margin-bottom: var(--boxel-sp-lg);
      }
      .eyebrow {
        margin: 0;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .sheet-title {
        margin: var(--boxel-sp-4xs) 0;
        font-size: var(--boxel-font-size-xl);
      }
      .meta {
        margin: 0;
        display: flex;
        gap: var(--boxel-sp-lg);
        color: var(--muted-foreground);
      }
      .body {
        line-height: 1.5;
      }
      .sheet-foot {
        padding: var(--boxel-sp) var(--boxel-sp-xl);
        border-top: 1px solid var(--border);
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground);
      }

      @media print {
        .pr-tools {
          display: none;
        }
        .report {
          padding: 0;
          overflow: visible;
          height: auto;
        }
        .paper {
          max-width: none;
          border: 0;
          border-radius: 0;
          box-shadow: none;
        }
        .sheet {
          padding: 0;
          break-inside: avoid;
        }
        .page-break {
          break-before: page;
        }
      }
    </style>
  </template>
}

export class PrintableReport extends CardDef {
  static displayName = 'Printable Report';

  @field school = contains(StringField);
  @field student = contains(StringField);
  @field term = contains(StringField);
  @field summary = contains(MarkdownField);
  @field sections = containsMany(MarkdownField);

  static isolated = Isolated;
}
