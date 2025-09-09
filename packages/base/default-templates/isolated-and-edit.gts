import { get } from '@ember/helper';
import GlimmerComponent from '@glimmer/component';
import type { CardDef, Format, BaseDef } from '../card-api';
import { FieldContainer, Header } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';
import { startCase } from 'lodash';
import { getFieldIcon, getField } from '@cardstack/runtime-common';
import CardInfo, { CardInfoEditor } from './card-info';

type Fields = Record<
  string,
  new () => GlimmerComponent<{ Args: { format?: Format } }>
>;

export default class DefaultCardDefTemplate extends GlimmerComponent<{
  Args: {
    model: CardDef;
    fields: Fields;
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

  private get headerFieldNames(): string[] | undefined {
    let fields = this.hideTheme
      ? this._headerFields.filter((f) => f !== 'theme')
      : this._headerFields;

    let ownHeaderFields = fields.filter((fieldName) => {
      const field = getField(this.args.model.constructor, fieldName);
      return (
        field?.computeVia == undefined &&
        this.isOwnField(this.args.model.constructor, fieldName)
      );
    });

    return ownHeaderFields.length ? ownHeaderFields : undefined;
  }

  private get hasOwnFields() {
    return Boolean(this.headerFieldNames || this.displayFields);
  }

  <template>
    <div class={{cn 'default-card-template' @format}}>
      <Header @hasBottomBorder={{true}} class='card-info-header'>
        {{#if (eq @format 'isolated')}}
          <CardInfo
            @title={{@model.title}}
            @description={{@model.description}}
            @thumbnailURL={{@model.thumbnailURL}}
            @icon={{@model.constructor.icon}}
          />
        {{else}}
          <CardInfoEditor
            @thumbnailURL={{@model.cardInfo.thumbnailURL}}
            @icon={{@model.constructor.icon}}
          >
            <:thumbnailEditor>
              <FieldContainer
                @label='Thumbnail URL'
                @tag='label'
                @vertical={{true}}
                @labelFontSize='small'
                data-test-field='thumbnail-url'
              >
                {{! @glint-ignore "thumbnailURL" does not exist }}
                <@fields.cardInfo.thumbnailURL />
              </FieldContainer>
            </:thumbnailEditor>
            <:default>
              <@fields.cardInfo @format='edit' />
            </:default>
          </CardInfoEditor>
        {{/if}}
      </Header>
      {{#if this.hasOwnFields}}
        <section class='own-display-fields'>
          {{#if this.headerFieldNames}}
            {{#each this.headerFieldNames as |key|}}
              <FieldContainer
                @label={{startCase key}}
                @icon={{getFieldIcon @model.cardInfo key}}
                data-test-field={{key}}
              >
                {{#let (get @fields key) as |Field|}}
                  <Field />
                {{/let}}
              </FieldContainer>
            {{/each}}
          {{/if}}
          {{#if this.displayFields}}
            {{#each-in this.displayFields as |key Field|}}
              <FieldContainer
                @label={{startCase key}}
                @icon={{getFieldIcon @model key}}
                data-test-field={{key}}
              >
                {{! @glint-ignore: unknown not assignable to type Element }}
                <Field class='in-isolated' />
              </FieldContainer>
            {{/each-in}}
          {{/if}}
        </section>
      {{/if}}
      <footer class='notes-footer'>
        <FieldContainer
          @label='Notes'
          @icon={{getFieldIcon @model.cardInfo 'notes'}}
          data-test-field='notes'
        >
          {{! @glint-ignore "notes" does not exist }}
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
      .card-info-header :deep(.info) {
        align-self: center;
      }
      .card-info-header :deep(.add-button--full-width) {
        border: 1px solid var(--border, var(--boxel-form-control-border-color));
        grid-column: -1 / 1;
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
      .in-isolated.field-component-card.fitted-format {
        min-height: 65px;
      }
    </style>
  </template>
}
