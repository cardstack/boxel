import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import ToElsewhere from 'ember-elsewhere/components/to-elsewhere';

import {
  BoxelButton,
  Tooltip,
  Pill,
  RealmIcon,
} from '@cardstack/boxel-ui/components';
import { and, bool, gt } from '@cardstack/boxel-ui/helpers';

import { ArrowTopLeft, IconLink, IconPlus } from '@cardstack/boxel-ui/icons';

import { getPlural } from '@cardstack/runtime-common';

import { type ResolvedCodeRef } from '@cardstack/runtime-common/code-ref';
import type { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import EditFieldModal from '@cardstack/host/components/operator-mode/edit-field-modal';
import RemoveFieldModal from '@cardstack/host/components/operator-mode/remove-field-modal';
import {
  type Type,
  type CodeRefType,
  type FieldOfType,
  getCodeRef,
} from '@cardstack/host/resources/card-type';

import type { Ready } from '@cardstack/host/resources/file';
import type CardService from '@cardstack/host/services/card-service';
import type LoaderService from '@cardstack/host/services/loader-service';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import RealmService from '@cardstack/host/services/realm';
import {
  isOwnField,
  calculateTotalOwnFields,
} from '@cardstack/host/utils/schema-editor';

import type { BaseDef } from 'https://cardstack.com/base/card-api';

import ContextMenuButton from './context-menu-button';

interface Signature {
  Args: {
    card: typeof BaseDef;
    file: Ready;
    cardType: Type;
    moduleSyntax: ModuleSyntax;
    allowFieldManipulation: boolean;
    childFields: string[];
    parentFields: string[];
    goToDefinition: (
      codeRef: ResolvedCodeRef | undefined,
      localName: string | undefined,
    ) => void;
  };
}

export default class CardSchemaEditor extends Component<Signature> {
  <template>
    <style scoped>
      .schema-editor-container > * + * {
        margin-top: var(--boxel-sp-xs);
      }

      .schema-editor-container:first-child {
        margin-top: 0;
      }

      .schema {
        display: grid;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp);
      }

      .card-field {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--boxel-sp-5xs);
        padding: var(--boxel-sp-xxs);
        border: 2px solid transparent;
        border-radius: var(--code-mode-container-border-radius);
        background-color: var(--boxel-light);
        overflow: hidden;
      }
      .card-field + .card-field {
        margin-top: var(--boxel-sp-xxs);
      }

      .card-field--with-context-menu-button {
        padding-right: 0;
      }

      .left {
        display: flex;
        flex-direction: column;
        max-width: 100%;
      }
      .right {
        display: flex;
        align-items: center;
        max-width: 100%;
      }
      .right > * {
        flex-shrink: 0;
      }
      .right > :deep(.trigger) {
        max-width: 100%;
      }

      .computed-icon {
        display: inline-flex;
        font: 600 var(--boxel-font);
        line-height: 20px;
        padding: var(--boxel-sp-5xs) var(--boxel-sp-xxs);
        background-color: var(--boxel-200);
        border-top-left-radius: var(--boxel-border-radius-sm);
        border-bottom-left-radius: var(--boxel-border-radius-sm);
        margin-bottom: calc(var(--boxel-sp-5xs) * -2);
        transform: translate(
          calc(var(--boxel-sp-xxxs) * -1),
          calc(var(--boxel-sp-5xs) * -1)
        );
        height: 100%;
      }

      .linked-icon {
        display: flex;
        align-items: center;
        height: 20px;
        margin-right: var(--boxel-sp-5xs);
      }

      .field-pill {
        --pill-gap: var(--boxel-sp-xxxs);
        --pill-icon-size: var(--code-mode-realm-icon-size);
        height: 1.625rem;
        max-width: 100%;
        white-space: nowrap;
        overflow: hidden;
      }
      .field-pill > * {
        display: inline-block;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .realm-icon {
        --boxel-realm-icon-border: none;
        --boxel-realm-icon-border-radius: var(
          --code-mode-realm-icon-border-radius
        );
        flex-shrink: 0;
        min-width: var(--code-mode-realm-icon-size);
        min-height: var(--code-mode-realm-icon-size);
      }

      .display-name {
        display: contents;
      }

      .field-name {
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .overridden-field {
        text-decoration: line-through;
      }

      .overridden-field-link {
        --boxel-button-min-height: 1.5rem;
        --boxel-button-padding: var(--boxel-sp-4xs);
        --boxel-button-font: 600 var(--boxel-font-xs);
        justify-content: flex-start;
        gap: var(--boxel-sp-4xs);
        align-self: flex-start;
      }

      .jump-icon {
        flex-shrink: 0;
      }

      .field-types {
        color: var(--boxel-450);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xs);
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--boxel-sp-4xs);
      }

      .total-fields {
        color: var(--boxel-450);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xl);
        text-transform: uppercase;
      }

      .add-field-button {
        --boxel-button-padding: 0 var(--boxel-sp-4xs);
        gap: var(--boxel-sp-xxs);
      }

      .card-field--overriding {
        transition: border 1s;
      }

      .show-overriding-field-border {
        border: 2px solid var(--boxel-highlight);
      }

      @keyframes pulse {
        0% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.2);
        }
        100% {
          transform: scale(1);
        }
      }

      .overriding-field .show-overriding-field-border {
        animation: pulse 1s;
      }
    </style>

    <div
      class='schema-editor-container'
      data-test-card-schema={{@cardType.displayName}}
    >
      {{#let (getCodeRef @cardType) as |codeRef|}}
        <div class='header'>
          <Tooltip @placement='bottom'>
            <:trigger>
              <Pill
                class='field-pill'
                @kind='button'
                {{on 'click' (fn @goToDefinition codeRef @cardType.localName)}}
                data-test-card-schema-navigational-button
              >
                <:icon>
                  <RealmIcon
                    @realmInfo={{this.realm.info @cardType.module}}
                    class='realm-icon'
                  />
                </:icon>
                <:default>
                  {{@cardType.displayName}}
                </:default>
              </Pill>
            </:trigger>
            <:content>
              {{@cardType.module}}
              {{#if codeRef.name}}
                ({{codeRef.name}})
              {{else}}
                ({{@cardType.localName}})
              {{/if}}
            </:content>
          </Tooltip>
          <div class='total-fields' data-test-total-fields>
            {{#if (gt this.totalOwnFields 0)}}
              +
              {{this.totalOwnFields}}
              {{getPlural 'Field' this.totalOwnFields}}
            {{else}}
              No Fields
            {{/if}}
          </div>
        </div>
      {{/let}}

      <div class='card-fields'>
        {{#each @cardType.fields as |field|}}
          {{#if (this.isOwnField field.name)}}
            <div
              class='card-field
                {{if (this.isOverriding field) "card-field--overriding"}}
                {{if
                  @allowFieldManipulation
                  "card-field--with-context-menu-button"
                }}'
              data-field-name={{field.name}}
              data-test-field-name={{field.name}}
            >
              <div class='left'>
                <div
                  class={{if
                    (this.isOverridden field)
                    'field-name overridden-field'
                    'field-name'
                  }}
                >
                  {{field.name}}
                </div>
                <div class='field-types' data-test-field-types>
                  {{this.fieldTypes field}}
                </div>
              </div>
              <div class='right'>
                {{#let (this.fieldModuleURL field) as |moduleUrl|}}
                  {{#let (getCodeRef field) as |codeRef|}}
                    {{#if (this.isOverridden field)}}
                      <BoxelButton
                        @kind='text-only'
                        @size='extra-small'
                        class='overridden-field-link'
                        data-test-overridden-field-link
                        {{on 'click' (fn this.scrollIntoOveridingField field)}}
                      >
                        Jump to active field definition
                        <ArrowTopLeft
                          class='jump-icon'
                          width='13'
                          height='13'
                          role='presentation'
                        />
                      </BoxelButton>
                    {{else}}
                      <Tooltip @placement='bottom'>
                        <:trigger>
                          <Pill
                            class='field-pill'
                            @kind='button'
                            {{on
                              'click'
                              (fn @goToDefinition codeRef field.card.localName)
                            }}
                            data-test-card-schema-field-navigational-button
                          >
                            <:icon>
                              {{#if field.isComputed}}
                                <span
                                  class='computed-icon'
                                  data-test-computed-icon
                                >
                                  =
                                </span>
                              {{/if}}
                              {{#if (this.isLinkedField field)}}
                                <span class='linked-icon' data-test-linked-icon>
                                  <IconLink width='16px' height='16px' />
                                </span>
                              {{/if}}
                              <RealmIcon
                                @realmInfo={{this.realm.info moduleUrl}}
                                class='realm-icon'
                              />
                            </:icon>
                            <:default>
                              {{#let
                                (this.fieldCardDisplayName field.card)
                                as |cardDisplayName|
                              }}
                                <span
                                  class='display-name'
                                  data-test-card-display-name={{cardDisplayName}}
                                >
                                  {{cardDisplayName}}
                                </span>
                              {{/let}}
                            </:default>
                          </Pill>
                        </:trigger>
                        <:content>
                          {{moduleUrl}}
                          {{#if codeRef.name}}
                            ({{codeRef.name}})
                          {{/if}}
                        </:content>
                      </Tooltip>

                      {{#if @allowFieldManipulation}}
                        <ContextMenuButton
                          @toggleSettings={{fn this.toggleEditFieldModal field}}
                          @toggleRemoveModal={{fn
                            this.toggleRemoveFieldModalShown
                            field
                          }}
                          data-test-schema-editor-field-contextual-button
                        />
                      {{/if}}
                    {{/if}}
                  {{/let}}
                {{/let}}
              </div>
            </div>
          {{/if}}
        {{/each}}
      </div>

      {{#if @allowFieldManipulation}}
        <BoxelButton
          @kind='text-only'
          @size='small'
          class='add-field-button'
          {{on 'click' (fn this.toggleEditFieldModal undefined)}}
          data-test-add-field-button
        >
          <IconPlus width='13px' height='13px' role='presentation' />
          Add a field
        </BoxelButton>

        {{#if this.editFieldModalShown}}
          <ToElsewhere
            @named='schema-editor-modal'
            @send={{component
              EditFieldModal
              file=@file
              card=@card
              moduleSyntax=@moduleSyntax
              onClose=(fn this.toggleEditFieldModal undefined)
              field=this.fieldBeingEdited
            }}
          />
        {{/if}}

        {{#if (and this.removeFieldModalShown (bool this.fieldForRemoval))}}
          <ToElsewhere
            @named='schema-editor-modal'
            @send={{component
              RemoveFieldModal
              file=@file
              card=@card
              moduleSyntax=@moduleSyntax
              onClose=(fn this.toggleRemoveFieldModalShown undefined)
              field=this.fieldForRemoval
            }}
          />
        {{/if}}
      {{/if}}
    </div>
  </template>

  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;

  @tracked editFieldModalShown = false;
  @tracked removeFieldModalShown = false;
  @tracked private fieldForRemoval?: FieldOfType = undefined;
  @tracked private fieldBeingEdited?: FieldOfType = undefined;

  @action toggleEditFieldModal(field?: FieldOfType) {
    this.fieldBeingEdited = field;
    this.editFieldModalShown = !this.editFieldModalShown;
  }

  @action toggleRemoveFieldModalShown(field?: FieldOfType) {
    this.fieldForRemoval = field;
    this.removeFieldModalShown = !this.removeFieldModalShown;
  }

  @action openCardDefinition(moduleURL: string) {
    this.operatorModeStateService.updateCodePath(new URL(moduleURL));
  }

  @action
  isOwnField(fieldName: string): boolean {
    return isOwnField(this.args.card, fieldName);
  }

  get totalOwnFields() {
    return calculateTotalOwnFields(this.args.card, this.args.cardType);
  }

  fieldCardDisplayName(fieldCard: Type | CodeRefType): string {
    return fieldCard.displayName;
  }

  fieldModuleURL(field: FieldOfType) {
    return (field.card as Type).module;
  }

  @action
  fieldTypes(field: FieldOfType) {
    let types = [];

    if (this.isOverridden(field)) {
      types.push('Overridden');
    }

    if (this.isOverriding(field)) {
      types.push('Override');
    }

    if (this.isLinkedField(field)) {
      types.push('Link');
    }

    if (field.type === 'containsMany' || field.type === 'linksToMany') {
      types.push('Collection');
    }

    if (field.isComputed) {
      types.push('Computed');
    }

    return types.join(', ');
  }

  @action
  isOverriding(field: FieldOfType) {
    return this.args.parentFields.includes(field.name);
  }

  @action
  isOverridden(field: FieldOfType) {
    return this.args.childFields.includes(field.name);
  }

  isLinkedField(field: FieldOfType) {
    return field.type === 'linksTo' || field.type === 'linksToMany';
  }

  @action
  scrollIntoOveridingField(field: FieldOfType) {
    if (!this.isOverridden(field)) {
      return;
    }

    // This code assumes that the overriding field
    // is always located in the top result returned by the query selector.
    let element = document.querySelector(`[data-field-name='${field.name}']`);
    element?.classList.add('show-overriding-field-border');
    setTimeout(() => {
      element?.classList.remove('show-overriding-field-border');
    }, 1000);
    element?.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
      inline: 'nearest',
    });
  }
}
