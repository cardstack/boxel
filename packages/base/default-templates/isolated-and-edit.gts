import GlimmerComponent from '@glimmer/component';
import type { CardDef, FieldsTypeFor, Format } from '../card-api';
import { FieldContainer, Header } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';
import { startCase } from 'lodash';
import { getFieldIcon, getField } from '@cardstack/runtime-common';
import CardInfoTemplates from './card-info';

export default class DefaultCardDefTemplate extends GlimmerComponent<{
  Args: {
    model: CardDef;
    fields: FieldsTypeFor<CardDef>;
    format: Format;
  };
}> {
  private specialFields: string[] = ['title', 'description', 'thumbnailURL'];
  private excludedFields: string[] = [
    'id',
    'cardInfo',
    ...this.specialFields,
    'theme',
  ];

  // Logic: If special field (title,description,thumbnailUrl) is NOT computed,
  // then display its edit format alongside other top-level fields.
  private get specialDisplayFieldNames(): string[] | undefined {
    let fieldNames = this.specialFields.filter((fieldName) => {
      const field = getField(this.args.model.constructor, fieldName);
      return field?.computeVia == undefined;
    });

    return fieldNames.length ? fieldNames : undefined;
  }

  // Fields to display in between the cardInfo header and notes footer
  private get displayFields(): FieldsTypeFor<CardDef> | undefined {
    let excludedFields = this.excludedFields.filter(
      (name) => !this.specialDisplayFieldNames?.includes(name),
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
    <div class={{cn 'default-card-template' @format}}>
      <Header @hasBottomBorder={{true}} class='card-info-header'>
        {{#if (eq @format 'isolated')}}
          <CardInfoTemplates.view
            @title={{@model.title}}
            @description={{@model.description}}
            @thumbnailURL={{@model.thumbnailURL}}
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
    <style scoped>
      .default-card-template {
        --hr-color: rgba(0 0 0 / 10%);
        display: grid;
      }
      .card-info-header {
        --boxel-header-min-height: 9.375rem; /* 150px */
        --boxel-header-padding: var(--boxel-sp-xxl) var(--boxel-sp-xl)
          var(--boxel-sp-xl);
        --boxel-header-gap: var(--boxel-sp-lg);
        --boxel-header-border-color: var(--hr-color);
        align-items: flex-start;
        background-color: var(--muted, var(--boxel-100));
      }
      .card-info-header :deep(.info) {
        align-self: center;
      }
      .card-info-header :deep(.add-new) {
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
