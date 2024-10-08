import { fn } from '@ember/helper';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import focusTrap from 'ember-focus-trap/modifiers/focus-trap';
import onKeyMod from 'ember-keyboard/modifiers/on-key';

import {
  BoxelButton,
  BoxelInput,
  FieldContainer,
  RadioInput,
  Pill,
} from '@cardstack/boxel-ui/components';
import { bool, cssVar } from '@cardstack/boxel-ui/helpers';

import {
  chooseCard,
  loadCard,
  identifyCard,
  catalogEntryRef,
  CodeRef,
} from '@cardstack/runtime-common';

import type { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import ModalContainer from '@cardstack/host/components/modal-container';
import { FieldOfType, Type } from '@cardstack/host/resources/card-type';

import { Ready } from '@cardstack/host/resources/file';
import LoaderService from '@cardstack/host/services/loader-service';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type RealmService from '@cardstack/host/services/realm';

import { BaseDef, FieldType } from 'https://cardstack.com/base/card-api';

import { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';

interface Signature {
  Args: {
    file: Ready;
    card: typeof BaseDef;
    moduleSyntax: ModuleSyntax;
    field?: FieldOfType;
    onClose: () => void;
  };
}

export default class EditFieldModal extends Component<Signature> {
  @tracked fieldCard: typeof BaseDef | undefined = undefined;
  @tracked fieldModuleURL: URL | undefined = undefined;
  @tracked fieldName: string | undefined = undefined;
  @tracked cardinality: 'one' | 'many' = 'one';
  @tracked isFieldDef: boolean | undefined = undefined;
  @tracked cardURL: URL | undefined = undefined;
  @tracked fieldRef: CodeRef | undefined = undefined;

  @tracked fieldNameErrorMessage: string | undefined;
  @service declare loaderService: LoaderService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;

  cardinalityItems = [
    {
      id: 'one',
      text: 'Limit to one',
    },
    {
      id: 'many',
      text: 'Allow multiple',
    },
  ];

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);

    // This component has 2 flows - adding a new field, and editing an existing field. When adding a new field, this.args.field will be undefined and when editing, it will be present

    this.setInitialValues.perform();
  }

  get isNewField(): boolean {
    return !this.args.field;
  }

  get fieldType(): FieldType {
    if (this.isFieldDef) {
      return this.cardinality === 'one' ? 'contains' : 'containsMany';
    } else {
      return this.cardinality === 'one' ? 'linksTo' : 'linksToMany';
    }
  }

  @action chooseCard() {
    this.chooseCardTask.perform();
  }

  @action onFieldNameInput(value: string) {
    this.fieldName = value;
    this.validateFieldName();
  }

  @action onCardinalityChange(id: 'one' | 'many') {
    this.cardinality = id;
  }

  private setInitialValues = restartableTask(async () => {
    let field = this.args.field;

    // When adding a new field, we want to default to the base string card
    if (!field) {
      let ref = {
        module: 'https://cardstack.com/base/card-api', // This seems fundamental enough to be hardcoded
        name: 'StringField',
      };
      this.isFieldDef = true;

      try {
        this.fieldCard = await loadCard(ref, {
          loader: this.loaderService.loader,
        });
      } catch (error) {
        console.error("Couldn't load default string card (from base realm)");
        throw error;
      }

      this.fieldModuleURL = new URL(ref.module);
      this.cardURL = new URL(ref.module);
      this.fieldRef = ref;
      return;
    }

    this.fieldName = field.name;
    this.cardinality = ['containsMany', 'linksToMany'].includes(field.type)
      ? 'many'
      : 'one';

    let ref: { module: string; name: string };

    let fieldCardType = field.card;
    let isCardType = 'codeRef' in fieldCardType; // To see whether we are dealing with Type or CodeRefType

    if (isCardType) {
      ref = (fieldCardType as Type).codeRef as typeof ref;
    } else {
      ref = fieldCardType as typeof ref;
    }

    this.fieldCard = await loadCard(ref, {
      loader: this.loaderService.loader,
    });

    this.fieldModuleURL = new URL(ref.module);
    this.cardURL = new URL(ref.module);
    this.fieldRef = ref;

    // Field's card can descend from a FieldDef or a CardDef, so we need to determine which one it is. We do this by checking the field's type -
    // contains/containsMany is a FieldDef, and linksTo/linksToMany is a CardDef. When spawning the card chooser, the catalog entry will have the isField property set,
    // which dictates the field type. But at this point where we are editing an existing field, we don't have the catalog entry available, so we need to determine isFieldDef
    // from the field's type
    this.isFieldDef =
      this.determineFieldOrCardFromFieldType(field.type) === 'field';
  });

  private chooseCardTask = restartableTask(async () => {
    let chosenCatalogEntry = await chooseCard<CatalogEntry>({
      filter: {
        type: catalogEntryRef,
      },
    });

    if (chosenCatalogEntry) {
      this.fieldCard = await loadCard(chosenCatalogEntry.ref, {
        loader: this.loaderService.loader,
        relativeTo: new URL(chosenCatalogEntry.id),
      });

      this.isFieldDef = chosenCatalogEntry.isField;
      this.cardURL = new URL(chosenCatalogEntry.id);
      this.fieldRef = chosenCatalogEntry.ref;

      // This transforms relative module paths, such as "../person", to absolute ones -
      // we need that absolute path to load realm info
      this.fieldModuleURL = new URL(
        chosenCatalogEntry.ref.module,
        chosenCatalogEntry.id,
      );
    }
  });

  private determineFieldOrCardFromFieldType(
    fieldType: FieldType,
  ): 'field' | 'card' {
    if (fieldType === 'contains' || fieldType === 'containsMany') {
      return 'field';
    } else {
      return 'card';
    }
  }

  @action saveField() {
    if (!this.args.card || !this.fieldName) {
      throw new Error(
        'bug: cannot save field without a selected card and a name',
      );
    }

    let cardBeingModified = identifyCard(this.args.card)!;
    let addFieldAtIndex = undefined;

    if (!this.isNewField) {
      // We are editing a field, so we need to first remove the old one, and then add the new one
      addFieldAtIndex = this.args.moduleSyntax.removeField(
        cardBeingModified,
        this.args.field!.name,
      );
    }

    let { fieldName, fieldRef, fieldType, cardURL: incomingRelativeTo } = this;
    try {
      this.args.moduleSyntax.addField({
        cardBeingModified,
        fieldName,
        fieldRef: fieldRef as { module: string; name: string },
        fieldType,
        fieldDefinitionType: this.isFieldDef ? 'field' : 'card',
        incomingRelativeTo,
        outgoingRelativeTo: new URL(
          this.operatorModeStateService.state.codePath!,
        ),
        outgoingRealmURL: new URL(this.args.file.realmURL),
        addFieldAtIndex,
      });
    } catch (error) {
      let errorMessage = (error as Error).message;
      if (errorMessage.includes('already exists')) {
        // message example: "the field "firstName" already exists"
        this.fieldNameErrorMessage = errorMessage;
      }
      console.log(error);
      return;
    }

    this.writeTask.perform(this.args.moduleSyntax.code());
  }

  validateFieldName() {
    this.fieldNameErrorMessage = undefined;

    if (/\s/g.test(this.fieldName!)) {
      this.fieldNameErrorMessage = 'Field names cannot contain spaces';
      return;
    }

    if (this.fieldName![0] === this.fieldName![0].toUpperCase()) {
      this.fieldNameErrorMessage =
        'Field names must start with a lowercase letter';
      return;
    }

    if (!/^[a-z0-9_]+$/i.test(this.fieldName!)) {
      this.fieldNameErrorMessage =
        'Field names can only contain letters, numbers, and underscores';
      return;
    }
  }

  get submitDisabled(): boolean {
    return bool(
      !this.fieldName ||
        !this.fieldCard ||
        this.fieldNameErrorMessage ||
        this.writeTask.isRunning,
    );
  }

  private writeTask = restartableTask(async (src: string) => {
    // note that this write will cause the component to rerender, so
    // any code after this write will not be executed since the component will
    // get torn down before subsequent code can execute

    await this.args.file.write(src, true);
    this.args.onClose();
  });

  <template>
    <style scoped>
      .edit-field-modal > :deep(.boxel-modal__inner) {
        display: flex;
      }
      :deep(.edit-field) {
        height: 530px;
      }
      .footer-buttons {
        display: flex;
        height: 100%;
        margin-left: auto;
      }
      .footer-buttons > div {
        margin-top: auto;
        margin-bottom: auto;
        margin-left: auto;
      }

      .card-chooser-area {
        display: flex;
      }

      .card-chooser-area button.pull-right {
        margin-left: auto;
        height: auto;
      }

      :global(.edit-field-modal .boxel-field.horizontal) {
        margin-bottom: var(--boxel-sp-lg);
      }
    </style>

    <ModalContainer
      @title={{if this.isNewField 'Add field' 'Edit field settings'}}
      @onClose={{@onClose}}
      @size='medium'
      @centered={{true}}
      {{focusTrap
        focusTrapOptions=(hash
          initialFocus='.edit-field-modal input' allowOutsideClick=true
        )
      }}
      @cardContainerClass='edit-field'
      class='edit-field-modal'
      data-test-edit-field-modal
    >
      <:content>
        <FieldContainer @label='Field Type'>
          <div class='card-chooser-area'>
            {{#if this.fieldCard}}
              <Pill data-test-selected-field-realm-icon>
                <:icon>
                  {{#if this.fieldModuleURL.href}}
                    {{#let
                      (this.realm.info this.fieldModuleURL.href)
                      as |realmInfo|
                    }}
                      <img
                        src={{realmInfo.iconURL}}
                        alt='Workspace icon'
                        data-test-realm-icon-url={{realmInfo.iconURL}}
                      />
                    {{/let}}
                  {{/if}}
                </:icon>
                <:default>
                  <span data-test-selected-field-display-name>
                    {{this.fieldCard.displayName}}
                  </span>
                </:default>
              </Pill>
            {{/if}}

            <BoxelButton
              @kind='text-only'
              @size='small'
              {{on 'click' this.chooseCard}}
              class='change {{if this.fieldCard "pull-right"}}'
              data-test-choose-card-button
            >
              Change
            </BoxelButton>
          </div>
        </FieldContainer>

        <FieldContainer @label='Field Name'>
          <BoxelInput
            @value={{this.fieldName}}
            @onInput={{this.onFieldNameInput}}
            @errorMessage={{this.fieldNameErrorMessage}}
            @state={{if (bool this.fieldNameErrorMessage) 'invalid' 'none'}}
            data-test-field-name-input
          />
        </FieldContainer>

        <FieldContainer @label=''>
          <RadioInput
            @groupDescription='Field cardinality'
            @items={{this.cardinalityItems}}
            @name='cardinality-radio'
            @checkedId={{this.cardinality}}
            style={{cssVar
              boxel-radio-input-option-padding='1em'
              boxel-radio-input-option-gap='1em'
            }}
            as |item|
          >
            <item.component
              @onChange={{fn this.onCardinalityChange item.data.id}}
            >
              {{item.data.text}}
            </item.component>
          </RadioInput>
        </FieldContainer>
      </:content>

      <:footer>
        <div class='footer-buttons'>
          <div>
            <BoxelButton
              @kind='secondary-light'
              {{on 'click' @onClose}}
              {{onKeyMod 'Escape'}}
              data-test-cancel-adding-field-button
            >
              Cancel
            </BoxelButton>

            <BoxelButton
              @kind='primary'
              {{on 'click' this.saveField}}
              {{onKeyMod 'Enter'}}
              @disabled={{this.submitDisabled}}
              data-test-save-field-button
            >
              {{#if this.writeTask.isRunning}}
                {{#if this.isNewField}}
                  Adding…
                {{else}}
                  Saving…
                {{/if}}
              {{else}}
                {{#if this.isNewField}}
                  Add
                {{else}}
                  Save
                {{/if}}
              {{/if}}
            </BoxelButton>
          </div>
        </div>
      </:footer>
    </ModalContainer>
  </template>
}
