import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  realmURL,
} from '@cardstack/base/card-api';
import BooleanField from '@cardstack/base/boolean';
import { CaptureDownloadButton } from '@cardstack/base/components/capture-download-button';

class Isolated extends Component<typeof PdfDownloadDemo> {
  // The durable capture URL of the linked card: served from the media cache,
  // re-captured after the card is edited. Composed against the linked card's
  // own realm, which is where the capture persists.
  get pdfUrl(): string | undefined {
    let card = this.args.model.card;
    let id = card?.id;
    let realm = card?.[realmURL]?.href;
    if (!id || !realm || !id.startsWith(realm)) {
      return undefined;
    }
    let path = id.slice(realm.length);
    let query = this.args.model.printMedia
      ? 'type=pdf&media=print'
      : 'type=pdf';
    return `${realm}_screenshot/${path}?${query}`;
  }

  <template>
    <article class='pdf-download-demo'>
      <header>
        <h2>PDF Download Demo</h2>
        <p>
          Link a card, then save its always-current PDF. The button fetches the
          capture with the realm session and saves the bytes as a file, so a
          private realm's PDF downloads with the right name and type.
        </p>
      </header>

      <section class='field'>
        <label>Card to export</label>
        <@fields.card />
      </section>

      <section class='field'>
        <label>Render under print media</label>
        <@fields.printMedia />
      </section>

      <section class='actions'>
        <CaptureDownloadButton @url={{this.pdfUrl}} @kind='primary'>
          Save PDF
        </CaptureDownloadButton>
        {{#if this.pdfUrl}}
          <a
            class='view-link'
            href={{this.pdfUrl}}
            target='_blank'
            rel='noopener noreferrer'
          >Open in a tab</a>
        {{/if}}
      </section>

      {{#if this.pdfUrl}}
        <section class='result'>
          <p>Capture URL:</p>
          <code class='url'>{{this.pdfUrl}}</code>
        </section>
      {{/if}}
    </article>

    <style scoped>
      .pdf-download-demo {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-lg);
      }
      header p {
        margin: var(--boxel-sp-xs) 0 0;
        color: var(--muted-foreground);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .field label {
        font-weight: 600;
      }
      .actions {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp);
      }
      .view-link {
        color: var(--primary);
      }
      .result {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius-lg);
        background: var(--muted);
        color: var(--muted-foreground);
      }
      .url {
        word-break: break-all;
        font-size: var(--boxel-font-size-sm);
      }
    </style>
  </template>
}

export class PdfDownloadDemo extends CardDef {
  static displayName = 'PDF Download Demo';

  @field card = linksTo(CardDef);
  @field printMedia = contains(BooleanField);

  static isolated = Isolated;
}
