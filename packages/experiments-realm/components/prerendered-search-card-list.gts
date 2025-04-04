import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { type SafeString, htmlSafe } from '@ember/template';

import {
  realmURL,
  type CardContext,
  type CardDef,
  type Format,
} from 'https://cardstack.com/base/card-api';

import {
  type ResolvedCodeRef,
  type Query,
  isValidPrerenderedHtmlFormat,
  FITTED_FORMATS,
} from '@cardstack/runtime-common';

import {
  CardContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { and, bool } from '@cardstack/boxel-ui/helpers';

interface Signature {
  Args: {
    model?: Partial<CardDef>;
    itemRef?: ResolvedCodeRef;
    cardDisplayName?: string;
    format?: string;
    hasOverlay?: boolean;
    context?: CardContext;
    query?: Query;
    realms?: string[];
  };
  Element: HTMLElement;
}

export default class CardList extends GlimmerComponent<Signature> {
  <template>
    {{#if (and (bool this.format) (bool this.query))}}
      <ul class='card-list' ...attributes>
        <@context.prerenderedCardSearchComponent
          @query={{this.query}}
          @format={{this.format.format}}
          @realms={{this.realms}}
        >
          <:loading>
            <LoadingIndicator />
          </:loading>
          <:response as |cards|>
            {{#each cards key='url' as |card|}}
              <li class='card-list-item' style={{this.formatSpecs}}>
                {{#if @hasOverlay}}
                  <CardContainer
                    {{@context.cardComponentModifier
                      cardId=card.url
                      format='data'
                      fieldType=undefined
                      fieldName=undefined
                    }}
                    class='{{this.format.format}}-card'
                    @displayBoundaries={{true}}
                  >
                    <card.component />
                  </CardContainer>
                {{else}}
                  <CardContainer
                    class='{{this.format.format}}-card'
                    @displayBoundaries={{true}}
                  >
                    <card.component @format={{this.format.format}} />
                  </CardContainer>
                {{/if}}
              </li>
            {{else}}
              <p>No results were found</p>
            {{/each}}
          </:response>
        </@context.prerenderedCardSearchComponent>
      </ul>
    {{else if this.error}}
      <div class='error'>Error: {{this.error}}</div>
    {{/if}}
    <style scoped>
      .card-list {
        display: grid;
        gap: var(--boxel-sp);
        list-style-type: none;
        margin-block: 0;
        padding: var(--boxel-sp);
      }
      .card-list-item {
        max-width: 100%;
      }
      .fitted-card {
        container-name: fitted-card;
        container-type: size;
      }
      .atom-card,
      .embedded-card {
        width: max-content;
      }
      .error {
        padding: var(--boxel-sp);
        color: var(--boxel-danger);
      }
    </style>
  </template>

  private fittedFormatSizes = FITTED_FORMATS.map((f) => f.specs).flat();

  private formatError = (format: string) =>
    htmlSafe(`"${format}" an acceptable value for the <code>@format</code> argument. Please select from these options:
        <ul>
          ${['embedded', 'fitted', 'atom']
            .map((f) => htmlSafe(`<li>${f}</li>`))
            .join('')}
        </ul>`);

  private fittedFormatError = (name: string) =>
    htmlSafe(`"${name}" is not an acceptable value for fitted format. Please select from these options:
        <ul>
        ${this.fittedFormatSizes
          .map((f) => htmlSafe(`<li>${f.id}</li>`))
          .join(' ')}
        </ul>`);

  @tracked private error?: SafeString;

  private get format() {
    let format: Format | undefined;
    let specId: string | undefined;

    if (this.args.format?.includes('/')) {
      let [cardFormat, formatSpecName] = this.args.format.split('/');
      if (!isValidPrerenderedHtmlFormat(cardFormat)) {
        this.error = this.formatError(cardFormat);
        return undefined;
      }
      if (!this.fittedFormatSizes.map((f) => f.id).includes(formatSpecName)) {
        this.error = this.fittedFormatError(formatSpecName);
        return undefined;
      }
      format = cardFormat;
      specId = formatSpecName;
    } else if (this.args.format) {
      if (!isValidPrerenderedHtmlFormat(this.args.format)) {
        this.error = this.formatError(this.args.format);
        return undefined;
      }
      format = this.args.format;
    }

    return { format: format ?? 'fitted', specId: specId ?? 'double-strip' };
  }

  private get formatSpecs() {
    if (this.format?.format !== 'fitted') {
      return undefined;
    }
    let specs = this.fittedFormatSizes.find(
      (f) => f.id === this.format?.specId,
    );
    if (!specs) {
      return undefined;
    }
    return `width: ${specs.width}px; height: ${specs.height}px`;
  }

  private get realm() {
    if (!this.args.model) {
      return undefined;
    }
    return this.args.model[realmURL]?.href;
  }

  private get realms() {
    return this.args.realms ?? [this.realm];
  }

  private get query(): Query | undefined {
    if (this.args.query) {
      return this.args.query;
    }

    if (this.args.cardDisplayName) {
      return {
        filter: {
          eq: {
            _cardType: this.args.cardDisplayName,
          },
        },
      };
    }

    this.error = htmlSafe(
      `Please provide either a <code>@query</code> or a <code>@cardDisplayName</code> argument`,
    );
    return undefined;
  }
}
