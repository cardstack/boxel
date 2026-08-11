import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { MarkdownDef } from 'https://cardstack.com/base/markdown-file-def';
import { FittedCard } from '@cardstack/boxel-ui/components';
import BookOpenIcon from '@cardstack/boxel-icons/book-open';

export class FileEmbeddingFieldGuide extends CardDef {
  static displayName = 'File Embedding Field Guide';
  static icon = BookOpenIcon;
  static prefersWideFormat = true;

  // The document body is a real, typed realm file; its embedded rendering
  // resolves the guide's `::file` references into live FileDef embeds.
  @field file = linksTo(() => MarkdownDef);
  @field deck = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: FileEmbeddingFieldGuide) {
      return this.title ?? 'File Embedding Field Guide';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='document' data-test-file-embedding-field-guide>
        <header class='document-head'>
          <div class='edition'>Format regression review
            <span>·</span>
            embedded format matrix</div>
          <h1>{{@model.cardTitle}}</h1>
          <p>{{@model.deck}}</p>
          <div class='document-index' aria-label='Document coverage'>
            <span><strong>36</strong> file types</span>
            <span><strong>3</strong> fixture tiers per type</span>
            <span><strong>108</strong> licensed fixtures</span>
          </div>
        </header>

        <section class='document-body' aria-label='Embedded FileDef field guide'>
          <@fields.file @format='embedded' @displayContainer={{false}} />
        </section>

        <footer class='document-foot'>
          <span>FileDef format regression harness</span>
          <span>Licensed · manifest-verified fixtures</span>
        </footer>
      </article>

      <style scoped>
        .document {
          width: 100%;
          max-width: 76rem;
          min-width: 0;
          margin: 0 auto;
          padding: clamp(2rem, 5vw, 5rem) clamp(1rem, 5vw, 4rem) 5rem;
          color: var(--foreground);
          background: var(--background);
          font-family: var(--font-sans);
        }
        .document-head {
          max-width: 54rem;
          margin: 0 auto 3rem;
          padding-bottom: 2rem;
          border-bottom: 1px solid var(--border);
        }
        .edition {
          margin-bottom: 1rem;
          color: var(--muted-foreground);
          font-family: var(--font-mono);
          font-weight: 650;
          font-size: 0.68rem;
          line-height: 1.2;
          letter-spacing: 0.13em;
          text-transform: uppercase;
        }
        .edition span {
          color: var(--primary);
        }
        h1 {
          max-width: 15ch;
          margin: 0;
          overflow-wrap: anywhere;
          font-family: var(--font-serif);
          font-weight: 350;
          font-size: clamp(2.5rem, 7vw, 5.1rem);
          line-height: 0.98;
          letter-spacing: -0.05em;
          text-wrap: balance;
        }
        .document-head > p {
          max-width: 48rem;
          margin: 1.4rem 0 0;
          color: var(--muted-foreground);
          font-size: clamp(1rem, 2vw, 1.2rem);
          line-height: 1.65;
          text-wrap: pretty;
        }
        .document-index {
          display: flex;
          flex-wrap: wrap;
          gap: 0.7rem 1.5rem;
          margin-top: 1.6rem;
          color: var(--muted-foreground);
          font-family: var(--font-mono);
          font-weight: 600;
          font-size: 0.68rem;
          line-height: 1.2;
        }
        .document-index strong {
          color: var(--foreground);
          font-size: 0.85rem;
        }
        .document-body {
          display: grid;
          grid-template-columns: minmax(0, 54rem);
          justify-content: center;
          min-width: 0;
        }
        .document-body :deep(.markdown-content),
        .document-body :deep(.markdown-embedded) {
          width: 100%;
          min-width: 0;
          max-width: 54rem;
          margin-inline: auto;
        }
        .document-body :deep(.markdown-embedded) {
          display: block;
          padding: 0;
        }
        .document-body :deep(.markdown-embedded__title),
        .document-body :deep(.markdown-content > h1:first-child) {
          display: none;
        }
        .document-body :deep(.markdown-embedded__content) {
          max-height: none;
          overflow: visible;
          mask-image: none;
          -webkit-mask-image: none;
        }
        .document-body :deep(.markdown-bfm-card-slot--block) {
          width: 100%;
          max-width: 54rem;
          min-width: 0;
          margin: 1.25rem auto 2.25rem;
        }
        .document-body :deep(.markdown-bfm-card-slot--block > *) {
          display: block;
          width: 100%;
          min-width: 0;
          max-width: 100%;
        }
        .document-foot {
          max-width: 54rem;
          margin: 4rem auto 0;
          padding-top: 1rem;
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          border-top: 1px solid var(--border);
          color: var(--muted-foreground);
          font-family: var(--font-mono);
          font-weight: 600;
          font-size: 0.62rem;
          line-height: 1.3;
        }
        @media (max-width: 42rem) {
          .document-foot {
            flex-direction: column;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <article class='embed'>
        <BookOpenIcon width='24' height='24' aria-hidden='true' />
        <div><span>Live MarkdownDef · 36 embedded types</span><strong
          >{{@model.cardTitle}}</strong><p>{{@model.deck}}</p></div>
        <b>Open guide</b>
      </article>
      <style scoped>
        .embed {
          width: 100%;
          min-width: 0;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: 0.85rem;
          padding: 1rem;
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: var(--card);
          color: var(--card-foreground);
        }
        .embed div {
          min-width: 0;
          display: grid;
          gap: 0.2rem;
        }
        span,
        b {
          color: var(--muted-foreground);
          font-family: var(--font-mono);
          font-weight: 650;
          font-size: 0.62rem;
          line-height: 1.2;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        strong,
        p {
          min-width: 0;
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        strong {
          font-family: var(--font-sans);
          font-weight: 700;
          font-size: 0.94rem;
          line-height: 1.25;
        }
        p {
          color: var(--muted-foreground);
          font-family: var(--font-sans);
          font-weight: 500;
          font-size: 0.75rem;
          line-height: 1.3;
        }
        @container embedded-card (max-width: 30rem) {
          p,
          b {
            display: none;
          }
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <FittedCard>
        <:placeholder><BookOpenIcon width='30' height='30' /></:placeholder>
        <:eyebrow>Embedded FileDef QA · 36 types</:eyebrow>
        <:title>{{@model.cardTitle}}</:title>
        <:subtitle>{{@model.deck}}</:subtitle>
        <:meta><span>Media · documents · data · archives · fonts · 3D</span></:meta>
        <:footer><span>108 fixtures</span><span>Licensed</span></:footer>
      </FittedCard>
    </template>
  };
}
