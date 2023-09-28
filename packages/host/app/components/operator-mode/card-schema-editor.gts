import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { internalKeyFor } from '@cardstack/runtime-common';
import { isCodeRef, type CodeRef } from '@cardstack/runtime-common/code-ref';

import type { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import RealmInfoProvider from '@cardstack/host/components/operator-mode/realm-info-provider';
import { type Type } from '@cardstack/host/resources/card-type';

import type { Ready } from '@cardstack/host/resources/file';
import type CardService from '@cardstack/host/services/card-service';
import type LoaderService from '@cardstack/host/services/loader-service';

import type { BaseDef } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    card: typeof BaseDef;
    file: Ready;
    cardType: Type;
    moduleSyntax: ModuleSyntax;
  };
}

export default class CardSchemaEditor extends Component<Signature> {
  <template>
    <style>
      .schema-editor-container {
        padding: var(--boxel-sp-sm);
      }

      .schema-editor-container + .schema-editor-container {
        margin-top: var(--boxel-sp);
      }

      .schema {
        display: grid;
        gap: var(--boxel-sp);
      }

      .pill {
        display: inline-flex;
        padding: 5px var(--boxel-sp-xs);
        background-color: var(--boxel-light);
        border: 1px solid var(--boxel-400);
        border-radius: var(--boxel-border-radius-sm);
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
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

      .card-field + .card-field {
        margin-top: var(--boxel-sp-sm);
      }

      .card-field {
        padding: var(--boxel-sp-xxs) var(--boxel-sp-sm);
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }

      .pill + .card-fields {
        margin-top: var(--boxel-sp-sm);
      }

      .field-name {
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }

      .field-type {
        color: var(--boxel-450);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xs);
      }
    </style>

    <div
      class='schema-editor-container'
      data-test-card-schema={{@cardType.displayName}}
    >
      <div class='pill'>
        <div class='realm-icon'>
          <RealmInfoProvider @fileURL={{@cardType.module}}>
            <:ready as |realmInfo|>
              <img
                src={{realmInfo.iconURL}}
                alt='Realm icon'
                width='20'
                height='20'
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
                <div class='pill'>
                  <div class='realm-icon'>
                    <RealmInfoProvider @fileURL={{this.fieldModuleURL field}}>
                      <:ready as |realmInfo|>
                        <img
                          src={{realmInfo.iconURL}}
                          alt='Realm icon'
                          width='20'
                          height='20'
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
                </div>
              </div>
            </div>
          {{/if}}
        {{/each}}
      </div>
    </div>
  </template>

  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;

  @action
  isOwnField(fieldName: string): boolean {
    return Object.keys(
      Object.getOwnPropertyDescriptors(this.args.card.prototype),
    ).includes(fieldName);
  }

  fieldCardDisplayName(card: Type | CodeRef): string {
    if (isCodeRef(card)) {
      return internalKeyFor(card, undefined);
    }
    return card.displayName;
  }

  fieldModuleURL(field: Type['fields'][0]) {
    return (field.card as Type).module;
  }
}
