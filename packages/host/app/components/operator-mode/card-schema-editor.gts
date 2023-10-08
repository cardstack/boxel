import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { gt } from '@cardstack/boxel-ui/helpers/truth-helpers';

import { getPlural } from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';

import { internalKeyFor } from '@cardstack/runtime-common';

import type { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import AddFieldModal from '@cardstack/host/components/operator-mode/add-field-modal';
import RealmInfoProvider from '@cardstack/host/components/operator-mode/realm-info-provider';
import {
  type Type,
  type CodeRefType,
} from '@cardstack/host/resources/card-type';

import type { Ready } from '@cardstack/host/resources/file';
import type CardService from '@cardstack/host/services/card-service';
import type LoaderService from '@cardstack/host/services/loader-service';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import {
  isOwnField,
  calculateTotalOwnFields,
} from '@cardstack/host/utils/schema-editor';

import type { BaseDef } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    card: typeof BaseDef;
    file: Ready;
    cardType: Type;
    moduleSyntax: ModuleSyntax;
    allowAddingFields: boolean;
  };
}

export default class CardSchemaEditor extends Component<Signature> {
  <template>
    <style>
      .schema-editor-container {
        margin-top: var(--boxel-sp);
      }

      .schema-editor-container:first-child {
        margin-top: 0;
      }

      .schema {
        display: grid;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp);
      }

      .pill {
        border: 1px solid var(--boxel-400);
        padding: var(--boxel-sp-xxxs) var(--boxel-sp-xs);
        border-radius: 8px;
        background-color: white;
        font-weight: 600;
        display: inline-flex;
      }

      .pill:hover {
        background-color: var(--boxel-100);
      }

      .pill > div {
        display: flex;
      }

      .pill > div > span {
        margin: auto;
      }

      .realm-icon {
        margin-right: var(--boxel-sp-xxxs);
      }

      .card-field {
        background-color: white;
      }

      .card-field {
        margin-bottom: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
        border-radius: var(--boxel-border-radius);
        display: flex;
      }

      .card-fields {
        margin-top: var(--boxel-sp);
      }

      .left {
        display: flex;
        margin-top: auto;
        margin-bottom: auto;
        flex-direction: column;
      }

      .right {
        margin-left: auto;
        margin-top: auto;
        margin-bottom: auto;
      }

      .field-name {
        font-size: var(--boxel-font-size);
      }

      .field-type {
        color: #949494;
      }

      .realm-icon > img {
        height: 20px;
        width: 20px;
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .total-fields {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xxxs);
        margin-left: auto;
      }

      .total-fields > * {
        margin: 0;
      }

      .total-fields-value {
        font: 600 var(--boxel-font);
      }

      .total-fields-label {
        font: var(--boxel-font-sm);
      }

      .add-field-button {
        cursor: pointer;
        color: var(--boxel-highlight);
        font-size: var(--boxel-font-sm);
        font-weight: 600;
      }
    </style>

    <div
      class='schema-editor-container'
      data-test-card-schema={{@cardType.displayName}}
    >
      <div class='header'>
        <button
          class='pill'
          data-test-card-schema-navigational-button
          {{on 'click' (fn this.openCardDefinition @cardType.module)}}
        >
          <div class='realm-icon'>
            <RealmInfoProvider @fileURL={{@cardType.module}}>
              <:ready as |realmInfo|>
                <img
                  src={{realmInfo.iconURL}}
                  alt='Realm icon'
                  data-test-realm-icon-url={{realmInfo.iconURL}}
                />
              </:ready>
            </RealmInfoProvider>
          </div>
          <div>
            <span>
              {{@cardType.displayName}}
            </span>
          </div>
        </button>
        <div class='total-fields' data-test-total-fields>
          {{#if (gt this.totalOwnFields 0)}}
            <span class='total-fields-value'>+ {{this.totalOwnFields}}</span>
            <span class='total-fields-label'>{{getPlural
                'Field'
                this.totalOwnFields
              }}</span>
          {{else}}
            <span class='total-fields-label'>No Fields</span>
          {{/if}}
        </div>
      </div>

      <div class='card-fields'>
        {{#each @cardType.fields as |field|}}
          {{#if (this.isOwnField field.name)}}
            <div class='card-field' data-test-field-name={{field.name}}>
              <div class='left'>
                <div class='field-name'>
                  {{field.name}}
                </div>
                <div class='field-type'>
                  {{field.type}}
                </div>
              </div>
              <div class='right'>
                {{#let (this.fieldModuleURL field) as |moduleUrl|}}
                  <button
                    class='pill'
                    data-test-card-schema-field-navigational-button
                    {{on 'click' (fn this.openCardDefinition moduleUrl)}}
                  >
                    <div class='realm-icon'>
                      <RealmInfoProvider @fileURL={{moduleUrl}}>
                        <:ready as |realmInfo|>
                          <img
                            src={{realmInfo.iconURL}}
                            alt='Realm icon'
                            data-test-realm-icon-url={{realmInfo.iconURL}}
                          />
                        </:ready>
                      </RealmInfoProvider>
                    </div>
                    <div>
                      <span>
                        {{#let
                          (this.fieldCardDisplayName field.card)
                          as |cardDisplayName|
                        }}
                          <span
                            data-test-card-display-name={{cardDisplayName}}
                          >{{cardDisplayName}}</span>
                        {{/let}}
                      </span>
                    </div>
                  </button>
                {{/let}}
              </div>
            </div>
          {{/if}}
        {{/each}}
      </div>

      {{#if @allowAddingFields}}
        <div class='add-field-button' {{on 'click' this.toggleAddFieldModal}}>
          + Add a field
        </div>

        {{#if this.addFieldModalShown}}
          <AddFieldModal
            @file={{@file}}
            @card={{@card}}
            @moduleSyntax={{@moduleSyntax}}
            @onClose={{this.toggleAddFieldModal}}
          />
        {{/if}}
      {{/if}}
    </div>
  </template>

  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @service declare operatorModeStateService: OperatorModeStateService;

  @tracked addFieldModalShown = false;
  @action toggleAddFieldModal() {
    this.addFieldModalShown = !this.addFieldModalShown;
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

  fieldModuleURL(field: Type['fields'][0]) {
    return (field.card as Type).module;
  }
}
