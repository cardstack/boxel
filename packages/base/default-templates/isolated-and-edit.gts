import GlimmerComponent from '@glimmer/component';
import type { BaseDefConstructor, CardDef, Field, Format } from '../card-api';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';
import { startCase } from 'lodash';
import { getField } from '@cardstack/runtime-common';
import { get } from '@ember/helper';

type Fields = Record<string, new () => GlimmerComponent>;

export default class DefaultCardDefTemplate extends GlimmerComponent<{
  Args: {
    model: CardDef;
    fields: Fields;
    format: Format;
  };
}> {
  private infoFields = ['title', 'description', 'thumbnailURL'];
  private excludedFields = ['id', 'cardInfo', ...this.infoFields];

  private get ownFields() {
    let ownFields = Object.entries(this.args.fields).filter(
      ([key]) => !this.excludedFields.includes(key),
    );
    return Object.fromEntries(ownFields);
  }

  private getField = (key: string) => {
    return getField(this.args.model.constructor, key) as
      | Field<BaseDefConstructor>
      | undefined;
  };

  private isComputed = (key: string) => {
    const field = this.getField(key);
    return Boolean(field?.computeVia);
  };

  private getInfoField = (key: string) => {
    return (this.args.fields?.cardInfo as unknown as Fields)?.[key];
  };

  private getFieldIcon = (key: string) => {
    const field = this.getField(key);
    let fieldInstance = field?.card;
    return fieldInstance?.icon;
  };

  <template>
    <div class={{cn 'default-card-template' @format}}>
      <header>
        {{#if (eq @format 'isolated')}}
          <h2><@fields.title /></h2>
          <p><@fields.description /></p>
        {{else}}
          {{#each this.infoFields as |key|}}
            <FieldContainer
              @label={{startCase key}}
              @icon={{this.getFieldIcon key}}
              data-test-field={{key}}
            >
              {{#if (this.isComputed key)}}
                {{#let (this.getInfoField key) as |Field|}}
                  <Field />
                {{/let}}
              {{else}}
                {{#let (get @fields key) as |Field|}}
                  <Field />
                {{/let}}
              {{/if}}
            </FieldContainer>
          {{/each}}
        {{/if}}
      </header>
      {{#each-in this.ownFields as |key Field|}}
        <FieldContainer
          @label={{startCase key}}
          @icon={{this.getFieldIcon key}}
          data-test-field={{key}}
        >
          <Field />
        </FieldContainer>
      {{/each-in}}
    </div>
    <style scoped>
      .default-card-template {
        display: grid;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
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
        > :deep(.boxel-field > .content > *:not(.links-to-many-editor)) {
        padding-left: var(--boxel-icon-lg);
      }
    </style>
  </template>
}
