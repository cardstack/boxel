import GlimmerComponent from '@glimmer/component';
import type { CardDef, FieldsTypeFor, Format } from '../card-api';
import { FieldContainer, Header } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';
import { startCase } from 'lodash-es';
import {
  getFieldIcon,
  getField,
  cardDefComputedFields,
} from '@cardstack/runtime-common';
import CardInfoTemplates from './card-info';

export default class DefaultCardDefTemplate extends GlimmerComponent<{
  Args: {
    model: CardDef;
    fields: FieldsTypeFor<CardDef>;
    format: Format;
  };
}> {
  private standardComputedFields = cardDefComputedFields;
  private excludedFields: string[] = [
    'id',
    'cardInfo',
    ...this.standardComputedFields,
    'theme',
  ];

  // Logic: If standardComputedFields is NOT computed due to user override,
  // then display its edit format alongside other top-level fields.
  private get cardInfoFieldDisplayNames(): string[] | undefined {
    let fieldNames = this.standardComputedFields.filter((fieldName) => {
      const field = getField(this.args.model.constructor, fieldName);
      return field?.computeVia == undefined;
    });

    return fieldNames.length ? fieldNames : undefined;
  }

  // Fields to display in between the cardInfo header and notes footer
  private get displayFields(): FieldsTypeFor<CardDef> | undefined {
    let excludedFields = this.excludedFields.filter(
      (name) => !this.cardInfoFieldDisplayNames?.includes(name),
    );
    let fields = Object.entries(this.args.fields).filter(
      ([key]) => !excludedFields.includes(key),
    );
    if (!fields.length) {
      return;
    }
    return Object.fromEntries(fields) as FieldsTypeFor<CardDef>;
  }

  private get isThemeCard() {
    return Boolean(
      Object.entries(this.args.fields).find(([key]) => key === 'cssVariables'),
    );
  }

  <template>
    <div
      class={{cn 'default-card-template' @format}}
      data-test-base-template={{@format}}
    >
      <div class={{cn 'default-card-template--inner' @format}}>
        <Header @hasBottomBorder={{true}} class='card-info-header'>
          {{#if (eq @format 'isolated')}}
            <CardInfoTemplates.view
              @cardTitle={{@model.cardTitle}}
              @cardDescription={{@model.cardDescription}}
              @cardThumbnailURL={{@model.cardThumbnailURL}}
              @icon={{@model.constructor.icon}}
            />
          {{else}}
            <CardInfoTemplates.edit
              @fields={{@fields}}
              @model={{@model}}
              @hideThemeChooser={{this.isThemeCard}}
            />
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
                <Field class='in-isolated' />
              </FieldContainer>
            {{/each-in}}
          </section>
        {{/if}}
        <footer class='notes-footer'>
          <FieldContainer
            @label='Notes'
            @icon={{getFieldIcon @model.cardInfo 'notes'}}
            data-test-field='cardInfo-notes'
          >
            <@fields.cardInfo.notes />
          </FieldContainer>
        </footer>
      </div>
    </div>
    <style scoped>
      .default-card-template {
        container-name: default-template;
        container-type: inline-size;
      }
      .default-card-template--inner {
        --boxel-default-template-padding: var(--boxel-sp-xl);
        --boxel-default-template-hr-color: rgba(0 0 0 / 10%);
        display: grid;
      }
      .card-info-header {
        --boxel-header-min-height: 9.375rem; /* 150px */
        --boxel-header-padding: var(--boxel-default-template-padding);
        --boxel-header-gap: var(--boxel-sp-lg);
        --boxel-header-border-color: var(--boxel-default-template-hr-color);
        background-color: var(--muted);
      }
      .card-info-header :deep(.info) {
        align-self: center;
      }
      .card-info-header :deep(.add-new) {
        grid-column: -1 / 1;
      }
      .own-display-fields {
        display: grid;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-default-template-padding);
        background-color: var(--background);
      }
      .own-display-fields + .notes-footer {
        border-top: 1px solid var(--boxel-default-template-hr-color);
      }
      .notes-footer {
        padding: var(--boxel-default-template-padding);
      }
      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        margin-top: var(--boxel-sp-xs);
      }
      .default-card-template--inner.edit > .notes-footer {
        background-color: var(--muted);
      }
      /* keep field labels beside their inputs, wrapping the label above the
         input only when the field's content area gets too narrow */
      :deep(.boxel-field.horizontal:not(.theme-field)) {
        display: flex;
        flex-wrap: wrap;
        row-gap: var(--boxel-sp-xs);
        container-name: horizontal-field;
        container-type: inline-size;
      }
      :deep(.boxel-field.horizontal:not(.theme-field) > .label-container) {
        flex: 0 0 25%;
        min-width: 8rem;
      }
      :deep(.boxel-field.horizontal:not(.theme-field) > .content) {
        flex: 1 1 14rem;
        min-width: 0;
      }
      /* isolated fields render text rather than form controls: align the
         label with the top of the content instead of an input's first line */
      .default-card-template.isolated
        :deep(.boxel-field.horizontal:not(.theme-field) > .label-container) {
        padding-top: 0;
      }
      .default-card-template.isolated
        :deep(.boxel-field.horizontal:not(.theme-field) > .content) {
        --boxel-outline-width: 0;
        align-self: start;
      }
      /* below the label min-width (8rem) plus the content flex-basis (14rem)
         the label wraps above the input: give it the full line so its text
         doesn't wrap inside the label column, and drop the padding that
         aligns it with the input's first line */
      @container horizontal-field (width < 22rem) {
        :deep(.boxel-field.horizontal:not(.theme-field) > .label-container) {
          flex-basis: 100%;
          padding-top: 0;
        }
      }
      @container default-template (width < 425px) {
        .default-card-template--inner {
          --boxel-default-template-padding: var(--boxel-sp);
        }
        :deep(.boxel-field.horizontal:not(.theme-field)) {
          min-height: unset;
        }
      }
      /* this aligns edit fields with containsMany, linksTo, and linksToMany fields */
      .default-card-template--inner.edit
        > :is(.own-display-fields, .notes-footer)
        > :deep(
          .boxel-field
            > .content
            > *:not(.links-to-many-editor):not(.contains-many-editor):not(
              .links-to-editor
            )
        ) {
        padding-right: var(--boxel-icon-lg);
      }
      .default-card-template--inner.edit
        > :is(.own-display-fields, .notes-footer)
        > :deep(
          .boxel-field
            > .content
            > *:not(.links-to-many-editor):not(.contains-many-editor)
        ) {
        padding-left: var(--boxel-icon-lg);
      }
      /* Add padding for readonly fields */
      .default-card-template--inner.edit
        > :is(.own-display-fields, .notes-footer)
        > :deep(.boxel-field > .content .read-only) {
        padding-left: var(--boxel-icon-lg);
        padding-right: var(--boxel-icon-lg);
      }
      .in-isolated.field-component-card.fitted-format {
        min-height: 65px;
      }
    </style>
  </template>
}
