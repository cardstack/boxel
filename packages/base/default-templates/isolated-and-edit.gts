import { get } from '@ember/helper';
import GlimmerComponent from '@glimmer/component';
import type { CardDef, Format, BaseDef } from '../card-api';
import { FieldContainer, Header } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';
import { startCase } from 'lodash';
import { getFieldIcon } from '@cardstack/runtime-common';
import CardInfo from './card-info';

type Fields = Record<string, new () => GlimmerComponent>;

export default class DefaultCardDefTemplate extends GlimmerComponent<{
  Args: {
    model: CardDef;
    fields: Fields & { cardInfo: Fields };
    format: Format;
  };
}> {
  private _headerFields: string[] = [
    'title',
    'description',
    'thumbnailURL',
    'theme',
  ];
  private excludedFields: string[] = ['id', 'cardInfo', ...this._headerFields];

  private get displayFields(): Fields | undefined {
    let fields = Object.entries(this.args.fields).filter(
      ([key]) => !this.excludedFields.includes(key),
    );
    if (!fields.length) {
      return;
    }
    return Object.fromEntries(fields) as Fields;
  }

  // this checks whether card is using the base card-def's `cardInfo` fields to compute card's `title`, `description`, or `thumbnail`
  private isOwnField(card: typeof BaseDef, fieldName: string): boolean {
    let prototype = card.prototype;
    let result = false;
    while (Object.getPrototypeOf(prototype).constructor.name !== 'BaseDef') {
      result = Object.keys(
        Object.getOwnPropertyDescriptors(prototype),
      ).includes(fieldName);
      if (result === true) {
        return result;
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    return result;
  }

  // hiding this field from Theme cards and applying its cssVariables to the current card
  private get hideTheme() {
    return Boolean(
      Object.entries(this.args.fields).find(([key]) => key === 'cssVariables'),
    );
  }

  private get headerFields() {
    return this.hideTheme
      ? this._headerFields.filter((f) => f !== 'theme')
      : this._headerFields;
  }

  <template>
    <div class={{cn 'default-card-template' @format}}>
      <Header
        @hasBottomBorder={{true}}
        class={{cn
          'card-info-header'
          card-info-edit-header=(eq @format 'edit')
        }}
      >
        {{#if (eq @format 'isolated')}}
          <CardInfo
            @title={{@model.title}}
            @description={{@model.description}}
            @thumbnailURL={{@model.thumbnailURL}}
            @icon={{@model.constructor.icon}}
          />
        {{else}}
          {{#each this.headerFields as |key|}}
            <FieldContainer
              @label={{startCase key}}
              @icon={{getFieldIcon @model.cardInfo key}}
              data-test-field={{key}}
            >
              {{#if (this.isOwnField @model.constructor key)}}
                {{#let (get @fields key) as |Field|}}
                  <Field />
                {{/let}}
              {{else}}
                {{#let (get @fields.cardInfo key) as |Field|}}
                  <Field />
                {{/let}}
              {{/if}}
            </FieldContainer>
          {{/each}}
        {{/if}}
      </Header>
      {{#if this.displayFields}}
        <section class='own-display-fields'>
          {{#each-in this.displayFields as |key Field|}}
            <FieldContainer
              @label={{startCase key}}
              @icon={{getFieldIcon @model key}}
              data-test-field={{key}}
            >
              <Field />
            </FieldContainer>
          {{/each-in}}
        </section>
      {{/if}}
      <footer class='notes-footer'>
        <FieldContainer
          @label='Notes'
          @icon={{getFieldIcon @model.cardInfo 'notes'}}
          data-test-field='notes'
        >
          <@fields.cardInfo.notes />
        </FieldContainer>
      </footer>
    </div>
    <style scoped>
      .default-card-template {
        --hr-color: rgba(0 0 0 / 10%);
        display: grid;
      }
      .card-info-header {
        --boxel-header-min-height: 9.375rem; /* 150px */
        --boxel-header-padding: var(--boxel-sp-lg);
        --boxel-header-gap: var(--boxel-sp-lg);
        --boxel-header-border-color: var(--hr-color);
        align-items: flex-start;
        background-color: var(--muted, var(--boxel-100));
      }
      .card-info-edit-header {
        display: grid;
      }
      .card-info-header :deep(.info) {
        align-self: center;
      }
      .card-info-header :deep(.add-button--full-width) {
        border: 1px solid var(--border, var(--boxel-form-control-border-color));
        grid-column: -1 / 1;
      }
      .card-info-header :deep(.add-button--full-width:hover),
      .card-info-header :deep(.add-button--full-width:active) {
        border-color: transparent;
        transition:
          border-color var(--boxel-transition),
          background-color var(--boxel-transition),
          box-shadow var(--boxel-transition);
      }
      .own-display-fields {
        display: grid;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
        background-color: var(--background, var(--boxel-light));
      }
      .own-display-fields + .notes-footer {
        border-top: 1px solid var(--hr-color);
      }
      .notes-footer {
        padding: var(--boxel-sp-xl);
      }
      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        margin-top: var(--boxel-sp-xs);
      }
      .default-card-template.edit > .notes-footer {
        background-color: var(--muted, var(--boxel-100));
      }
      /* this aligns edit fields with containsMany, linksTo, and linksToMany fields */
      .default-card-template.edit
        > :deep(
          .boxel-field
            > .content
            > *:not(.links-to-many-editor):not(.contains-many-editor):not(
              .links-to-editor
            )
        ) {
        padding-right: var(--boxel-icon-lg);
      }
      .default-card-template.edit
        > :deep(
          .boxel-field
            > .content
            > *:not(.links-to-many-editor):not(.contains-many-editor)
        ) {
        padding-left: var(--boxel-icon-lg);
      }
      /* Add padding for readonly fields */
      .default-card-template.edit > :deep(.boxel-field > .content .read-only) {
        padding-left: var(--boxel-icon-lg);
        padding-right: var(--boxel-icon-lg);
      }
    </style>
  </template>
}
