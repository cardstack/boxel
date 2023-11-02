import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';

import { use, resource } from 'ember-resources';
import { TrackedObject } from 'tracked-built-ins';

import { Accordion } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import {
  getPlural,
  loadCard,
  isCardDocumentString,
} from '@cardstack/runtime-common';
import { type ResolvedCodeRef } from '@cardstack/runtime-common/code-ref';

import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import CardAdoptionChain from '@cardstack/host/components/operator-mode/card-adoption-chain';
import { Type } from '@cardstack/host/resources/card-type';
import { Ready } from '@cardstack/host/resources/file';
import LoaderService from '@cardstack/host/services/loader-service';
import { calculateTotalOwnFields } from '@cardstack/host/utils/schema-editor';

import {
  isCardOrFieldDeclaration,
  ModuleDeclaration,
} from '@cardstack/host/resources/module-contents';

interface Signature {
  Element: HTMLElement;
  Args: {
    file: Ready;
    selectedDeclaration: ModuleDeclaration | undefined;
    openDefinition: (
      moduleHref: string,
      codeRef: ResolvedCodeRef | undefined,
    ) => void;
  };
}

type SelectedItem = 'schema-editor' | null;

export type CardInheritance = {
  cardType: Type;
  card: any;
};

export default class SchemaEditorColumn extends Component<Signature> {
  @tracked selectedItem: SelectedItem = 'schema-editor';

  @service declare loaderService: LoaderService;

  @action selectItem(item: SelectedItem) {
    if (this.selectedItem === item) {
      this.selectedItem = null;
      return;
    }

    this.selectedItem = item;
  }

  @use cardInheritanceChain = resource(() => {
    const state: {
      isLoading: boolean;
      value: CardInheritance[];
      error: Error | undefined;
      load: () => Promise<void>;
    } = new TrackedObject({
      isLoading: true,
      value: [],
      error: undefined,
      load: async () => {
        state.isLoading = true;
        let fileUrl = this.args.file.url;
        if (this.selectedCardOrField === undefined) {
          state.value = [];
          return;
        }
        let { cardOrField: card, cardType: cardTypeResource } =
          this.selectedCardOrField;

        try {
          await cardTypeResource!.ready;
          let cardType = cardTypeResource!.type;

          if (!cardType) {
            throw new Error('Card type not found');
          }

          // Chain goes from most specific to least specific
          let cardInheritanceChain = [
            {
              cardType,
              card,
            },
          ];

          while (cardType.super) {
            cardType = cardType.super;

            let superCard = await loadCard(cardType.codeRef, {
              loader: this.loaderService.loader,
              relativeTo: new URL(fileUrl), // because the module can be relative
            });

            cardInheritanceChain.push({
              cardType,
              card: superCard,
            });
          }
          state.value = cardInheritanceChain;
        } catch (error: any) {
          state.error = error;
        } finally {
          state.isLoading = false;
        }
      },
    });

    state.load();
    return state;
  });

  get totalFields() {
    return this.cardInheritanceChain.value.reduce(
      (total: number, data: CardInheritance) => {
        return total + calculateTotalOwnFields(data.card, data.cardType);
      },
      0,
    );
  }

  @cached
  get moduleSyntax() {
    return new ModuleSyntax(this.args.file.content);
  }

  private get isSelectedItemIncompatibleWithSchemaEditor() {
    if (!this.args.selectedDeclaration) {
      return;
    }
    return !isCardOrFieldDeclaration(this.args.selectedDeclaration);
  }

  private get isFileIncompatibleWithSchemaEditor() {
    return this.args.file.isBinary || this.isNonCardJson;
  }

  private get isNonCardJson() {
    return (
      this.args.file.name.endsWith('.json') &&
      !isCardDocumentString(this.args.file.content)
    );
  }

  private get selectedCardOrField() {
    if (
      this.args.selectedDeclaration !== undefined &&
      isCardOrFieldDeclaration(this.args.selectedDeclaration)
    ) {
      return this.args.selectedDeclaration;
    }
    return;
  }

  <template>
    <Accordion class='accordion' as |A|>
      <A.Item
        class='accordion-item'
        @contentClass='accordion-item-content'
        @onClick={{fn this.selectItem 'schema-editor'}}
        @isOpen={{eq this.selectedItem 'schema-editor'}}
      >
        <:title>
          Schema Editor
          <div class='total-fields' data-test-total-fields>
            <span class='total-fields-value'>{{this.totalFields}}</span>
            <span class='total-fields-label'>{{getPlural
                'Field'
                this.totalFields
              }}</span>
          </div>
        </:title>
        <:content>

          {{#if this.isFileIncompatibleWithSchemaEditor}}
            <div
              class='incompatible-schema-editor'
              data-test-schema-editor-incompatible-file
            >
              Schema Editor cannot be used with this file type.
            </div>
          {{else if this.isSelectedItemIncompatibleWithSchemaEditor}}
            <div
              class='incompatible-schema-editor'
              data-test-schema-editor-incompatible-item
            >
              Schema Editor cannot be used for selected
              {{@selectedDeclaration.type}}
              "{{@selectedDeclaration.localName}}".</div>
          {{else}}
            <CardAdoptionChain
              class='accordion-content'
              @file={{@file}}
              @moduleSyntax={{this.moduleSyntax}}
              @cardInheritanceChain={{this.cardInheritanceChain.value}}
              @openDefinition={{@openDefinition}}
            />
          {{/if}}
        </:content>
      </A.Item>
    </Accordion>

    <style>
      :global(.accordion-item-content) {
        overflow-y: auto;
      }

      .accordion-item:last-child {
        border-bottom: var(--boxel-border);
      }
      .accordion-content {
        padding: var(--boxel-sp-sm);
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

      .incompatible-schema-editor {
        display: flex;
        flex-wrap: wrap;
        align-content: center;
        justify-content: center;
        text-align: center;
        height: 100%;
        background-color: var(--boxel-200);
        font: var(--boxel-font-sm);
        color: var(--boxel-450);
        font-weight: 500;
        padding: var(--boxel-sp-xl);
      }
    </style>
  </template>
}
