import { get } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import GlimmerComponent from '@glimmer/component';
import { startCase } from 'lodash';

import { FieldContainer } from '@cardstack/boxel-ui/components';
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
    <div class='card-info'>
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
    </div>
    <style scoped>
      @layer {
        .card-info {
          --thumbnail-container-size: 6.25rem;
          display: flex;
          gap: var(--boxel-sp-lg);
          min-height: 9.375rem; /* 150px */
          padding: var(--spacing, var(--boxel-sp-lg));
          background-color: var(--accent-foreground, var(--boxel-100));
          color: var(--primary, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          box-shadow: var(--shadow, 0 1px 0 0 rgba(0 0 0 / 15%));
        }
        .image-container {
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
          letter-spacing: var(--boxel-lsp-sm);
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
    <header>
      {{#if (eq @format 'isolated')}}
        <CardInfo
          @title={{@model.title}}
          @description={{@model.description}}
          @thumbnailURL={{@model.thumbnailURL}}
          @icon={{@model.constructor.icon}}
        />
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
    <div class={{cn 'default-card-template' @format}}>
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
