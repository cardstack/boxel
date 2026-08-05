import { get } from '@ember/object';
import Component from '@glimmer/component';

import { eq } from '@cardstack/boxel-ui/helpers';

import type { BoxelRenderRecord } from '@cardstack/runtime-common';

import type { BoxComponent } from '@cardstack/base/card-api';

interface Signature {
  Element: HTMLElement;
  Args: {
    format?: string;
    model?: Record<string, unknown>;
    renderRecord?: BoxelRenderRecord;
    fields?: Record<string, BoxComponent>;
  };
}

/**
 * Host-owned fallback for an authored Boxel that does not provide a format.
 *
 * It intentionally consumes only the cloneable render record. The richer Base
 * templates remain Direct-owned until their field component portals are
 * expressed through the Boxel execution protocol.
 */
export default class TrustedBaseFormat extends Component<Signature> {
  private get format(): string {
    return this.args.format ?? 'isolated';
  }

  private get title(): string {
    return (
      this.args.renderRecord?.presentation.title ??
      this.args.renderRecord?.boxel.presentation.displayName ??
      'Untitled'
    );
  }

  private get summary(): string | null {
    return this.args.renderRecord?.presentation.summary ?? null;
  }

  private get fields() {
    return (this.args.renderRecord?.instance.fields ?? []).map((field) => ({
      ...field,
      label:
        typeof field.presentation.displayName === 'string'
          ? field.presentation.displayName
          : field.fieldName,
      displayValue:
        typeof field.value === 'string' || typeof field.value === 'number'
          ? String(field.value)
          : field.value === null
            ? ''
            : JSON.stringify(field.value),
    }));
  }

  <template>
    {{#if (eq this.format 'atom')}}
      <span class='trusted-base-atom'>{{this.title}}</span>
    {{else if (eq this.format 'head')}}
      {{! template-lint-disable no-forbidden-elements }}
      <title>{{this.title}}</title>
      {{#if this.summary}}
        <meta name='description' content={{this.summary}} />
      {{/if}}
    {{else if (eq this.format 'markdown')}}
      <article class='trusted-base-markdown'>
        <h1>{{this.title}}</h1>
        {{#if this.summary}}<p>{{this.summary}}</p>{{/if}}
      </article>
    {{else}}
      <article class='trusted-base-format' data-format={{this.format}}>
        <header>
          <h2>{{this.title}}</h2>
          {{#if this.summary}}<p>{{this.summary}}</p>{{/if}}
        </header>
        {{#unless (eq this.format 'fitted')}}
          <dl>
            {{#each this.fields as |field|}}
              <div>
                <dt>{{field.label}}</dt>
                <dd>
                  {{#let (get @fields field.fieldName) as |Field|}}
                    {{#if Field}}
                      <Field />
                    {{else}}
                      {{field.displayValue}}
                    {{/if}}
                  {{/let}}
                </dd>
              </div>
            {{/each}}
          </dl>
        {{/unless}}
      </article>
    {{/if}}

    <style scoped>
      .trusted-base-format {
        background: var(--background, white);
        color: var(--foreground, black);
        min-width: 0;
        padding: var(--boxel-sp, 1rem);
      }

      .trusted-base-format header,
      .trusted-base-format dl {
        margin: 0;
      }

      .trusted-base-format h2,
      .trusted-base-format p {
        margin: 0;
      }

      .trusted-base-format dl {
        display: grid;
        gap: var(--boxel-sp-sm, 0.75rem);
        margin-top: var(--boxel-sp, 1rem);
      }

      .trusted-base-format dl > div {
        display: grid;
        gap: var(--boxel-sp-xs, 0.5rem);
        grid-template-columns: minmax(7rem, 0.4fr) 1fr;
      }

      .trusted-base-format dt {
        font-weight: 700;
      }

      .trusted-base-format dd {
        margin: 0;
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .trusted-base-format[data-format='embedded'] {
        border-radius: var(--boxel-border-radius, 0.5rem);
      }

      .trusted-base-format[data-format='fitted'] {
        align-content: center;
        display: grid;
        height: 100%;
      }

      .trusted-base-markdown {
        max-width: 70ch;
      }
    </style>
  </template>
}
