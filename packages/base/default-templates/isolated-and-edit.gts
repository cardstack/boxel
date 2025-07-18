import { get } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import GlimmerComponent from '@glimmer/component';
import { startCase } from 'lodash';

import { FieldContainer, Header } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import { getField, sanitizeHtml } from '@cardstack/runtime-common';

import type {
  BaseDefConstructor,
  CardDef,
  Field,
  Format,
  CardOrFieldTypeIcon,
} from '../card-api';

const setBackgroundImage = (backgroundURL?: string | null) => {
  if (!backgroundURL) {
    return;
  }
  return htmlSafe(sanitizeHtml(`background-image: url(${backgroundURL});`));
};

class CardInfo extends GlimmerComponent<{
  Args: {
    title?: string;
    description?: string;
    thumbnailURL?: string;
    icon?: CardOrFieldTypeIcon;
  };
}> {
  <template>
    {{#if @thumbnailURL}}
      <div
        class='image-container thumbnail'
        style={{setBackgroundImage @thumbnailURL}}
        role='presentation'
      />
    {{else if @icon}}
      <div class='image-container'>
        <@icon class='icon' width='50' height='40' />
      </div>
    {{/if}}
    <div class='info'>
      <h2 class='card-info-title'>{{@title}}</h2>
      <p class='card-info-description'>{{@description}}</p>
    </div>
    <style scoped>
      @layer {
        .image-container {
          --thumbnail-container-size: 6.25rem;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          width: var(--thumbnail-container-size);
          height: var(--thumbnail-container-size);
          min-width: var(--thumbnail-container-size);
          min-height: var(--thumbnail-container-size);
          border-radius: var(--radius, var(--boxel-border-radius-xl));
          background-color: var(--background, var(--boxel-light));
        }
        .thumbnail {
          background-position: center;
          background-repeat: no-repeat;
          background-size: cover;
        }
        .card-info-title {
          margin-block: 0;
          font-size: var(--boxel-font-size);
          font-weight: 600;
          letter-spacing: var(--boxel-lsp-sm);
          line-height: calc(22 / 16);
        }
        .card-info-description {
          margin-block: 0;
          font-size: var(--boxel-font-size-sm);
          font-weight: 400;
          letter-spacing: var(--boxel-lsp-sm);
          line-height: calc(18 / 13);
        }
        .info > * + * {
          margin-top: var(--boxel-sp-xs);
        }
      }
    </style>
  </template>
}

type Fields = Record<string, new () => GlimmerComponent>;

export default class DefaultCardDefTemplate extends GlimmerComponent<{
  Args: {
    model: CardDef;
    fields: Fields;
    format: Format;
  };
}> {
  private headerFields = ['title', 'description', 'thumbnailURL'];
  private excludedFields = ['id', 'cardInfo', ...this.headerFields, 'notes'];

  private get ownFieldsArr() {
    return Object.entries(this.args.fields).filter(
      ([key]) => !this.excludedFields.includes(key),
    );
  }

  private get ownFields() {
    return Object.fromEntries(this.ownFieldsArr);
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

  private getCardInfoField = (key: string) => {
    return (this.args.fields?.cardInfo as unknown as Fields)?.[key];
  };

  private getFieldIcon = (key: string) => {
    const field = this.getField(key);
    let fieldInstance = field?.card;
    return fieldInstance?.icon;
  };

  <template>
    <div class={{cn 'default-card-template' @format}}>
      <Header
        @hasBackground={{true}}
        @hasShadow={{true}}
        class='card-info-header'
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
              @icon={{this.getFieldIcon key}}
              data-test-field={{key}}
            >
              {{#if (this.isComputed key)}}
                {{#let (this.getCardInfoField key) as |Field|}}
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
      </Header>
      {{#if this.ownFieldsArr.length}}
        <section class='own-fields'>
          {{#each-in this.ownFields as |key Field|}}
            {{! TODO: fix icon }}
            <FieldContainer
              @label={{startCase key}}
              @icon={{this.getFieldIcon key}}
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
          @icon={{this.getFieldIcon 'notes'}}
          data-test-field='notes'
        >
          <@fields.cardInfo.notes />
        </FieldContainer>
      </footer>
    </div>
    <style scoped>
      .default-card-template {
        display: grid;
      }
      .card-info-header {
        --boxel-header-min-height: 9.375rem; /* 150px */
        --boxel-header-padding: var(--boxel-sp-lg);
        --boxel-header-gap: var(--boxel-sp-lg);
      }
      .own-fields {
        display: grid;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
      }
      .own-fields + .notes-footer {
        border-top: var(--boxel-border);
      }
      .notes-footer {
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
