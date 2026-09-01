import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class ClinicalResource extends CardDef {
  static displayName = 'Clinical resource';
  static prefersWideFormat = true;

  @field title = contains(StringField);
  @field kind = contains(StringField);
  @field rationale = contains(StringField);
  @field response = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ClinicalResource) {
      return this.title ?? 'Clinical resource';
    },
  });

  static isolated = class extends Component<typeof ClinicalResource> {
    <template>
      <article class='resource'>
        <p>SHARED CLINICAL RESOURCE · {{@model.kind}}</p>
        <h1>{{@model.title}}</h1>
        <section><strong>Why it exists</strong><span
          >{{@model.rationale}}</span></section>
        <section><strong>Recommended response</strong><span
          >{{@model.response}}</span></section>
      </article>
      <style scoped>
        .resource {
          min-height: 100%;
          padding: 3rem;
          background: #f7faf9;
          color: #14242b;
          font-family: var(--font-sans);
        }
        p {
          color: #16756f;
          font: 800 0.72rem var(--font-mono);
          letter-spacing: 0.1em;
        }
        h1 {
          max-width: 48rem;
          margin: 1rem 0 2.5rem;
          font: 600 3.2rem/1 var(--font-serif);
        }
        section {
          display: grid;
          grid-template-columns: 12rem minmax(0, 36rem);
          gap: 2rem;
          padding: 1.2rem 0;
          border-top: 1px solid #cbd6da;
          line-height: 1.6;
        }
        section strong {
          color: #53656c;
          font-size: 0.75rem;
          text-transform: uppercase;
        }
      </style>
    </template>
  };
}
